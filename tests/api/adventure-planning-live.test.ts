import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { liveEnabled, livePlanning, type LivePlanning } from '../support/planning-live'

describe.skipIf(!liveEnabled)('正式 HTTP → 在线身份核验 → 隔离真实五表事务', () => {
  let live: LivePlanning
  beforeAll(async () => { live = await livePlanning() }, 60_000)
  afterAll(async () => { if (live) await live.cleanup() }, 30_000)

  it('首次预览不写账户、事件或版本；并发初始化只有一个零状态账户', async () => {
    const preview = await live.request(0, '/api/adventure/preview', { expectedVersion: 0, command: { type: 'createMainline', name: '健康' } })
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ version: 0, allowed: true })
    const initial = await live.database(`adventure_accounts?owner_id=eq.${live.users[0].id}&select=revision`)
    expect(await initial.json()).toEqual([])
    const pages = await Promise.all([live.read(), live.read(), live.read()])
    for (const page of pages) expect(page).toMatchObject({ version: 0, goals: [], mainlines: [], destinations: [{ id: 'independent' }], growth: { level: 1, totalXp: 0 } })
    const accounts = await live.database(`adventure_accounts?owner_id=eq.${live.users[0].id}&select=revision`)
    expect(await accounts.json()).toEqual([{ revision: 0 }])
  }, 30_000)

  it('创建、改名、目标创建编辑后从新请求持久读取，其他账户保持空状态', async () => {
    const main = await live.command({ type: 'createMainline', name: '健康' })
    const goal = await live.command({ type: 'createGoal', destination: main.result.entityId, title: '五公里', standard: '连续跑完五公里' })
    await live.command({ type: 'renameMainline', id: main.result.entityId, name: '健康与活力' })
    await live.command({ type: 'editGoal', id: goal.result.entityId, title: '首次五公里', standard: '户外连续跑完五公里' })
    expect(await live.read()).toMatchObject({ version: 4, mainlines: [{ name: '健康与活力' }], goals: [{ title: '首次五公里', standard: '户外连续跑完五公里', mainlineName: '健康与活力' }], growth: { totalXp: 0, actions: 0, achievedGoals: 0 } })
    expect(await live.read(1)).toMatchObject({ version: 0, mainlines: [], goals: [] })
    const response = await live.request(1, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: 0, command: { type: 'editGoal', id: goal.result.entityId, title: '偷改', standard: '无效' } })
    expect(response.status).toBe(404)
    expect((await live.read()).goals[0].title).toBe('首次五公里')
  }, 30_000)

  it('同 key 并发与未知结果重试只提交一次；异命令拒绝，历史回执保持稳定', async () => {
    const page = await live.read()
    const envelope = { requestId: crypto.randomUUID(), expectedVersion: page.version, command: { type: 'createGoal', destination: 'independent', title: '阅读', standard: '读完一本书' } }
    const responses = await Promise.all([live.request(0, '/api/adventure/commands', envelope), live.request(0, '/api/adventure/commands', envelope)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const receipt = await responses[0].json()
    expect(await responses[1].json()).toEqual(receipt)
    await live.command({ type: 'createGoal', destination: 'independent', title: '创作', standard: '完成一幅画' })
    // The caller ignores the first response, then retries after a newer operation.
    expect(await (await live.request(0, '/api/adventure/commands', envelope)).json()).toEqual(receipt)
    expect((await live.request(0, '/api/adventure/commands', { ...envelope, command: { ...envelope.command, title: '不同命令' } })).status).toBe(409)
    const state = await live.read()
    expect(state.goals.filter(goal => goal.title === '阅读')).toHaveLength(1)
    expect(state.mainlines).toHaveLength(1)
    const structures = await live.database(`adventure_mainlines?owner_id=eq.${live.users[0].id}&kind=eq.independent&select=id`)
    expect(await structures.json()).toHaveLength(1)
    const inboxes = await live.database(`adventure_goals?owner_id=eq.${live.users[0].id}&kind=eq.inbox&select=id,focused`)
    expect(await inboxes.json()).toEqual([expect.objectContaining({ focused: false })])
  }, 30_000)

  it('主线配额并发遵守账户版本，满额不写第六条；独立目标不占名额', async () => {
    for (const name of ['学习', '工作', '家庭']) await live.command({ type: 'createMainline', name })
    const page = await live.read()
    const responses = await Promise.all(['兴趣', '旅行'].map(name => live.request(0, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: page.version, command: { type: 'createMainline', name } })))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const full = await live.read()
    expect(full.mainlines).toHaveLength(5)
    expect(full.capabilities.createMainline).toMatchObject({ allowed: false })
    expect((await live.request(0, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: full.version, command: { type: 'createMainline', name: '第六条' } })).status).toBe(400)
    await live.command({ type: 'createGoal', destination: 'independent', title: '独立探索', standard: '进行一次独立探索' })
    expect((await live.read()).mainlines).toHaveLength(5)
  }, 30_000)

  it('分页总量保持完整，收纳目标不可见；浏览器角色不能访问表和 RPC', async () => {
    const page = await live.read(0, 1, 2)
    expect(page.totalGoals).toBe(4)
    expect(page.goals).toHaveLength(2)
    const second = await live.read(0, 2, 2)
    expect(second.totalGoals).toBe(4)
    expect(second.goals).toHaveLength(2)
    expect(new Set([...page.goals, ...second.goals].map(goal => goal.id)).size).toBe(4)
    for (const key of [live.env.SUPABASE_PUBLISHABLE_KEY, undefined]) {
      const headers: Record<string, string> = { apikey: live.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }
      if (!key) headers.Authorization = `Bearer ${live.users[0].token}`
      for (const table of ['adventure_accounts', 'adventure_mainlines', 'adventure_goals', 'adventure_tasks', 'adventure_events']) {
        const response = await fetch(`${live.env.SUPABASE_URL}/rest/v1/${table}?select=*`, { headers })
        expect([401, 403]).toContain(response.status)
      }
      const response = await fetch(`${live.env.SUPABASE_URL}/rest/v1/rpc/adventure_planning_read`, { method: 'POST', headers, body: JSON.stringify({ p_owner: live.users[0].id }) })
      expect([401, 403]).toContain(response.status)
    }
  }, 30_000)

  it('中途事件之后的校验失败回滚实体、事件、版本和回执；同 owner 外键阻止串户', async () => {
    const page = await live.read(1)
    const main = (await live.read()).mainlines[0]
    const invalidGoal = await live.database('adventure_goals', { method: 'POST', body: JSON.stringify({ owner_id: live.users[1].id, mainline_id: main.id, title: '串户', standard: '错误外键' }) })
    expect(invalidGoal.status).toBe(409)
    const poisoned = await live.database(`adventure_accounts?owner_id=eq.${live.users[1].id}`, { method: 'PATCH', body: JSON.stringify({ total_xp: 1 }) })
    expect(poisoned.ok).toBe(true)
    const requestId = crypto.randomUUID()
    try {
      const failed = await live.request(1, '/api/adventure/commands', { requestId, expectedVersion: page.version, command: { type: 'createMainline', name: '必须回滚' } })
      expect(failed.status).toBe(503)
      expect(await failed.text()).not.toMatch(/INCONSISTENT_REWARDS|sb_secret/)
    } finally {
      const repaired = await live.database(`adventure_accounts?owner_id=eq.${live.users[1].id}`, { method: 'PATCH', body: JSON.stringify({ total_xp: 0 }) })
      expect(repaired.ok).toBe(true)
    }
    expect(await live.read(1)).toMatchObject({ version: 0, mainlines: [], goals: [], growth: { totalXp: 0 } })
    const events = await live.database(`adventure_events?owner_id=eq.${live.users[1].id}&select=id,request_id`)
    expect(await events.json()).toEqual([])
  }, 30_000)
})
