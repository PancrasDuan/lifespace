import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { liveEnabled, livePlanning, type LivePlanning } from '../support/planning-live'

describe.skipIf(!liveEnabled)('正式 HTTP → 在线身份核验 → 隔离四表事务', () => {
  let live: LivePlanning
  beforeAll(async () => { live = await livePlanning() }, 60_000)
  afterAll(async () => { if (live) await live.cleanup() }, 30_000)

  it('预览不写账户；并发初始化只有一个零状态账户', async () => {
    const preview = await live.request(0, '/api/adventure/preview', { expectedVersion: 0, command: { type: 'createGoal', title: '健康', standards: ['标准'] } })
    expect(preview.status).toBe(200)
    expect(await (await live.database(`adventure_accounts?owner_id=eq.${live.users[0].id}&select=revision`)).json()).toEqual([])
    const pages = await Promise.all([live.read(), live.read(), live.read()])
    for (const page of pages) expect(page).toMatchObject({ version: 0, goals: [], growth: { totalXp: 0 } })
    expect(await (await live.database(`adventure_accounts?owner_id=eq.${live.users[0].id}&select=revision`)).json()).toEqual([{ revision: 0 }])
  }, 30_000)

  it('创建编辑目标保留身份，标签独立且隔离其他账户', async () => {
    const goal = await live.command({ type: 'createGoal', title: '五公里', standards: ['连续跑完五公里'], categoryLabel: '健康' })
    await live.command({ type: 'editGoal', id: goal.result.entityId, title: '首次五公里', standards: ['户外连续跑完五公里'], categoryLabel: '运动' })
    expect(await live.read()).toMatchObject({ version: 2, goals: [{ id: goal.result.entityId, title: '首次五公里', categoryLabel: '运动' }], growth: { totalXp: 0 } })
    expect((await live.read(1)).goals).toEqual([])
    expect((await live.request(1, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: 0, command: { type: 'editGoal', id: goal.result.entityId, title: '偷改', standards: ['无效'] } })).status).toBe(404)
  }, 30_000)

  it('同一封套并发及重试只提交一次，不同摘要冲突', async () => {
    const page = await live.read()
    const envelope = { requestId: crypto.randomUUID(), expectedVersion: page.version, command: { type: 'createGoal', title: '阅读', standards: ['读完一本书'] } }
    const responses = await Promise.all([live.request(0, '/api/adventure/commands', envelope), live.request(0, '/api/adventure/commands', envelope)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const receipt = await responses[0].json()
    expect(await responses[1].json()).toEqual(receipt)
    await live.command({ type: 'createGoal', title: '创作', standards: ['完成一幅画'] })
    expect(await (await live.request(0, '/api/adventure/commands', envelope)).json()).toEqual(receipt)
    expect((await live.request(0, '/api/adventure/commands', { ...envelope, command: { ...envelope.command, title: '不同命令' } })).status).toBe(409)
    expect((await live.read()).goals.filter(goal => goal.title === '阅读')).toHaveLength(1)
  }, 30_000)

  it('分页总量完整，浏览器角色不能访问四表和事务 RPC', async () => {
    const first = await live.read(0, 1, 2), second = await live.read(0, 2, 2)
    expect(first.totalGoals).toBe(3)
    expect(second.totalGoals).toBe(3)
    expect(new Set([...first.goals, ...second.goals].map(goal => goal.id)).size).toBe(3)
    for (const token of [live.env.SUPABASE_PUBLISHABLE_KEY, live.users[0].token]) {
      const headers = { apikey: live.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      for (const table of ['adventure_accounts', 'adventure_goals', 'adventure_tasks', 'adventure_events'])
        expect([401, 403]).toContain((await fetch(`${live.env.SUPABASE_URL}/rest/v1/${table}?select=*`, { headers })).status)
      expect([401, 403]).toContain((await fetch(`${live.env.SUPABASE_URL}/rest/v1/rpc/adventure_planning_read`, { method: 'POST', headers, body: JSON.stringify({ p_owner: live.users[0].id }) })).status)
    }
  }, 30_000)
  it('异常总经验阻断写入并回滚目标、事件和版本', async () => {
    const page = await live.read(1)
    expect((await live.database(`adventure_accounts?owner_id=eq.${live.users[1].id}`, { method: 'PATCH', body: JSON.stringify({ total_xp: 1 }) })).ok).toBe(true)
    try {
      const failed = await live.request(1, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: page.version, command: { type: 'createGoal', title: '必须回滚', standards: ['标准'] } })
      expect(failed.status).toBe(503)
      expect(await failed.text()).not.toMatch(/INCONSISTENT_REWARDS|sb_secret/)
    } finally {
      expect((await live.database(`adventure_accounts?owner_id=eq.${live.users[1].id}`, { method: 'PATCH', body: JSON.stringify({ total_xp: 0 }) })).ok).toBe(true)
    }
    expect(await live.read(1)).toMatchObject({ version: 0, goals: [], growth: { totalXp: 0 } })
    expect(await (await live.database(`adventure_events?owner_id=eq.${live.users[1].id}&select=id,request_id`)).json()).toEqual([])
  }, 30_000)

})
