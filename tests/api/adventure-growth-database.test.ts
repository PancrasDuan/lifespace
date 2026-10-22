import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import { growthPageSchema, rewardSourceSchema } from '../../src/shared/adventure-growth'
import { planningPageSchema, planningPreviewSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

const rpcOrigin = process.env.ADVENTURE_LOCAL_RPC_URL
const nativeFetch = globalThis.fetch
const env = {
  SUPABASE_URL: 'https://planning-local-test.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only',
  AUTH_ALLOWED_EMAILS: 'lifecycle@example.invalid',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const request = (owner: string, path = '/api/adventure', body?: unknown) => app.request(path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test` },
  body: body === undefined ? undefined : JSON.stringify(body),
}, env)
const read = async (owner: string, query = '') => {
  const response = await request(owner, `/api/adventure${query}`)
  expect(response.status).toBe(200)
  return planningPageSchema.parse(await response.json())
}
const envelope = (version: number, command: PlanningCommand) => ({ requestId: crypto.randomUUID(), expectedVersion: version, command })
const send = (owner: string, value: ReturnType<typeof envelope>) => request(owner, '/api/adventure/commands', value)
const command = async (owner: string, value: PlanningCommand) => {
  const response = await send(owner, envelope((await read(owner)).version, value))
  expect(response.status).toBe(200)
  return planningReceiptSchema.parse(await response.json())
}

describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 成长记录', () => {
  beforeEach(() => {
    const target = new URL(rpcOrigin!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('仅允许独立本机 RPC 验收')
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== env.SUPABASE_URL) throw new Error('禁止非验收请求')
      if (url.pathname === '/auth/v1/user') {
        const token = new Headers(init.headers).get('Authorization')!.split('.')[1]
        const identity: { sub: string } = JSON.parse(atob(token))
        return Response.json({ id: identity.sub, email: 'lifecycle@example.invalid', email_confirmed_at: '2026-10-21', is_anonymous: false })
      }
      if (!url.pathname.startsWith('/rest/v1/rpc/adventure_')) throw new Error('禁止非 RPC 请求')
      return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  let owner: string
  beforeEach(() => { owner = crypto.randomUUID() })

  it('成长页从全账户事实返回七项实时成就、等级和空流水，读取不增加版本', async () => {
    const before = await read(owner)
    const response = await request(owner, '/api/adventure/growth')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ version: 0, pageSize: 10, total: 0, items: [], nextCursor: null,
      growth: { level: 1, totalXp: 0, progress: 0, needed: 20, remaining: 20, actions: 0, achievedGoals: 0,
        achievements: [
          { id: 'actions_1', count: 0, remaining: 1, unlocked: false },
          { id: 'actions_10', remaining: 10 }, { id: 'actions_50', remaining: 50 }, { id: 'actions_100', remaining: 100 },
          { id: 'goals_1', remaining: 1 }, { id: 'goals_3', remaining: 3 }, { id: 'goals_10', remaining: 10 },
        ] } })
    expect(await read(owner)).toEqual(before)
  })
  it('任务与目标奖励仅投影冻结事件，迁移、改名和结束后来源仍可读，零行动固定保底', async () => {
    const main = (await command(owner, { type: 'createMainline', name: '发生时主线' })).result.entityId
    const goal = (await command(owner, { type: 'createGoal', destination: main, title: '发生时目标', standards: ['原标准'] })).result.entityId
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '发生时任务', description: '冻结说明', plannedOn: today, destination: goal })).result.entityId
    const done = await command(owner, { type: 'completeTask', id: task })
    await command(owner, { type: 'migrateTask', id: task, destination: '' })
    const achieved = await command(owner, { type: 'achieveGoal', id: goal, coefficient: 3, reflection: '完成时感想' })
    await command(owner, { type: 'renameMainline', id: main, name: '现在主线' })
    await command(owner, { type: 'endMainline', id: main })
    const fallback = (await command(owner, { type: 'createGoal', destination: '', title: '无行动成果', standards: ['标准'] })).result.entityId
    const fallbackReceipt = await command(owner, { type: 'achieveGoal', id: fallback, coefficient: 3, reflection: '' })
    const response = await request(owner, '/api/adventure/growth')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 3, nextCursor: null, growth: { totalXp: 5, actions: 1, achievedGoals: 2 }, items: [
      { id: fallbackReceipt.result.achievementId, kind: 'goal_achieved', title: '无行动成果', amount: 1, calculation: { count: 0, coefficient: 3, fallback: true } },
      { id: achieved.result.achievementId, title: '发生时目标', amount: 3, calculation: { count: 1, coefficient: 3, fallback: false } },
      { id: done.result.completionId, title: '发生时任务', goalId: goal, mainlineId: main, mainlineName: '发生时主线', goalTitle: '发生时目标', amount: 1 },
    ] })
    const taskSource = await request(owner, `/api/adventure/reward-source?id=${done.result.completionId}`)
    expect(taskSource.status).toBe(200)
    expect(await taskSource.json()).toMatchObject({ event: { id: done.result.completionId, entityId: task }, description: '冻结说明', plannedOn: today, standards: ['原标准'], actionSources: [], totalSources: 0 })
    const goalSource = await request(owner, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)
    expect(goalSource.status).toBe(200)
    expect(await goalSource.json()).toMatchObject({ reflection: '完成时感想', standards: ['原标准'], totalSources: 1,
      actionSources: [{ taskId: task, completionId: done.result.completionId, title: '发生时任务', description: '冻结说明', goalId: goal, mainlineId: main }] })
    expect((await read(owner)).goals.some(g => g.id === goal)).toBe(false)
    expect((await request(crypto.randomUUID(), `/api/adventure/reward-source?id=${done.result.completionId}`)).status).toBe(404)
  })

  const growth = async (owner: string, query = '') => {
    const response = await request(owner, '/api/adventure/growth' + query)
    expect(response.status).toBe(200)
    return growthPageSchema.parse(await response.json())
  }
  const complete = async (owner: string, title: string, destination = '', description = '') => {
    const id = (await command(owner, { type: 'createTask', title, description, plannedOn: (await read(owner)).today, destination })).result.entityId
    const value = envelope((await read(owner)).version, { type: 'completeTask', id })
    const response = await send(owner, value)
    expect(response.status).toBe(200)
    return { id, value, receipt: planningReceiptSchema.parse(await response.json()) }
  }
  it('19→20→19→20 经验等级边界、取消失效和新完成身份；历史 requestId 不再入账', async () => {
    for (let i = 0; i < 19; i++) await complete(owner, `行动 ${i}`)
    expect((await growth(owner)).growth).toMatchObject({ totalXp: 19, level: 1, progress: 19, remaining: 1, actions: 19 })
    const twentieth = await complete(owner, '临界行动')
    let page = await growth(owner)
    expect(page.growth).toMatchObject({ totalXp: 20, level: 2, progress: 0, needed: 25, remaining: 25, actions: 20 })
    expect(page.items[0].id).toBe(twentieth.receipt.result.completionId)
    const cancel = await command(owner, { type: 'cancelTaskCompletion', completionId: twentieth.receipt.result.completionId! })
    page = await growth(owner)
    expect(page.total).toBe(19)
    expect(page.growth).toMatchObject({ totalXp: 19, level: 1, progress: 19, remaining: 1, actions: 19 })
    expect((await request(owner, `/api/adventure/reward-source?id=${twentieth.receipt.result.completionId}`)).status).toBe(404)
    expect(await (await send(owner, twentieth.value)).json()).toEqual(twentieth.receipt)
    expect(await growth(owner)).toEqual(page)
    const fresh = await command(owner, { type: 'completeTask', id: twentieth.id })
    expect(fresh.result.completionId).not.toBe(twentieth.receipt.result.completionId)
    page = await growth(owner)
    expect(page.total).toBe(20)
    expect(page.items[0].id).toBe(fresh.result.completionId)
    expect(page.growth).toMatchObject({ totalXp: 20, level: 2, actions: 20 })
    const staleCancel = await send(owner, envelope(page.version, { type: 'cancelTaskCompletion', completionId: twentieth.receipt.result.completionId! }))
    expect(staleCancel.status).toBe(409)
    expect(await growth(owner)).toEqual(page)
    expect(cancel.result.growthChange?.xpDelta).toBe(-1)
  })

  it('游标按账户版本分页，全量统计不随页变化；无重复缺漏、越权游标和无效参数被拒绝', async () => {
    const ids: string[] = []
    for (let i = 0; i < 23; i++) ids.unshift((await complete(owner, `分页奖励 ${i}`)).receipt.result.completionId!)
    const first = await growth(owner)
    expect(first.items).toHaveLength(10)
    expect(first).toMatchObject({ total: 23, growth: { totalXp: 23, actions: 23 } })
    const second = await growth(owner, `?version=${first.version}&cursor=${first.nextCursor}`)
    const third = await growth(owner, `?version=${first.version}&cursor=${second.nextCursor}`)
    expect(second.items).toHaveLength(10)
    expect(third.items).toHaveLength(3)
    expect(third.nextCursor).toBeNull()
    expect(second.growth).toEqual(first.growth)
    expect(third.growth).toEqual(first.growth)
    expect([...first.items, ...second.items, ...third.items].map(item => item.id)).toEqual(ids)
    const other = crypto.randomUUID()
    expect(await growth(other)).toMatchObject({ version: 0, total: 0, items: [], growth: { totalXp: 0 } })
    expect((await request(other, `/api/adventure/growth?version=0&cursor=${first.nextCursor}`)).status).toBe(404)
    for (const query of ['?cursor=bad', `?cursor=${first.nextCursor}`, '?version=-1', '?version=1.2', '?version=9007199254740992', `?owner=${other}`, '?page=2']) {
      expect((await request(owner, '/api/adventure/growth' + query)).status).toBe(400)
    }
    await command(owner, { type: 'createGoal', destination: '', title: '只改规划也使旧游标失效', standards: ['标准'] })
    expect((await request(owner, `/api/adventure/growth?version=${first.version}&cursor=${first.nextCursor}`)).status).toBe(409)
    expect((await request(owner, `/api/adventure/reward-source?id=${ids[0]}&version=${first.version}`)).status).toBe(409)
    expect((await growth(owner)).growth).toEqual(first.growth)
  })

  it('七个成就均按全部有效事实实时点亮，100 次行动和 10 个目标不额外发经验，取消可熄灭', async () => {
    let last: Awaited<ReturnType<typeof complete>> | undefined
    for (let i = 0; i < 100; i++) last = await complete(owner, `里程碑 ${i}`)
    for (let i = 0; i < 10; i++) {
      const goal = (await command(owner, { type: 'createGoal', destination: '', title: `成果 ${i}`, standards: ['完成标准'] })).result.entityId
      await command(owner, { type: 'achieveGoal', id: goal, coefficient: 3, reflection: '' })
    }
    const page = await growth(owner)
    expect(page).toMatchObject({ total: 110, growth: { totalXp: 110, actions: 100, achievedGoals: 10, level: 5, progress: 0, needed: 40 } })
    expect(page.growth.achievements).toHaveLength(7)
    expect(page.growth.achievements.every(item => item.unlocked && item.remaining === 0)).toBe(true)
    await command(owner, { type: 'cancelTaskCompletion', completionId: last!.receipt.result.completionId! })
    const after = await growth(owner)
    expect(after.growth).toMatchObject({ totalXp: 109, actions: 99, achievedGoals: 10, level: 4, progress: 34, remaining: 1 })
    expect(after.growth.achievements.find(item => item.id === 'actions_100')).toMatchObject({ unlocked: false, remaining: 1, count: 99 })
    expect(after.growth.achievements.filter(item => item.unlocked)).toHaveLength(6)
  }, 20_000)

  it('大内容目标的计奖来源独立分页，保留冻结行动身份和说明，不随流水页重复膨胀', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '多行动目标', standards: ['历史标准'] })).result.entityId
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push((await complete(owner, `长来源 ${i}`, goal, '冻结内容'.repeat(1000))).id)
    const receipt = await command(owner, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '保留感想' })
    const page = await growth(owner)
    expect(page).toMatchObject({ total: 13, growth: { totalXp: 36, actions: 12, achievedGoals: 1 } })
    expect(page.items[0]).toMatchObject({ amount: 24, calculation: { count: 12, coefficient: 2, fallback: false } })
    expect(page.items[0].calculation).not.toHaveProperty('actionIds')
    const sources = []
    for (let n = 1; n <= 3; n++) {
      const response = await request(owner, `/api/adventure/reward-source?id=${receipt.result.achievementId}&page=${n}&version=${page.version}`)
      expect(response.status).toBe(200)
      const detail = rewardSourceSchema.parse(await response.json())
      expect(detail).toMatchObject({ version: page.version, page: n, pageSize: 5, totalSources: 12, reflection: '保留感想' })
      expect(detail.actionSources).toHaveLength(n === 3 ? 2 : 5)
      sources.push(...detail.actionSources)
    }
    expect(sources.map(item => item.taskId).sort()).toEqual(ids.sort())
    expect(sources.every(item => item.description === '冻结内容'.repeat(1000))).toBe(true)
    expect(new Set(sources.map(item => item.completionId)).size).toBe(12)
    expect((await request(owner, `/api/adventure/reward-source?id=${receipt.result.achievementId}&page=0`)).status).toBe(400)
  })

  it('完成、取消、重试及读取并发只观察同版本的经验、行动、成就和流水', async () => {
    const done = await complete(owner, '并发读取')
    const before = await growth(owner)
    const cancel = envelope(before.version, { type: 'cancelTaskCompletion', completionId: done.receipt.result.completionId! })
    const [a, b, ...pages] = await Promise.all([send(owner, cancel), send(owner, done.value), ...Array.from({ length: 8 }, () => growth(owner))])
    expect(a.status).toBe(200); expect(b.status).toBe(200)
    expect(await b.json()).toEqual(done.receipt)
    for (const page of pages) {
      if (page.version === before.version) expect(page).toEqual(before)
      else expect(page).toMatchObject({ version: before.version + 1, total: 0, items: [], growth: { totalXp: 0, actions: 0, achievements: [{ id: 'actions_1', unlocked: false }] } })
    }
    const after = await growth(owner)
    expect(after).toMatchObject({ version: before.version + 1, total: 0, items: [], growth: { totalXp: 0, actions: 0 } })
    expect(await (await send(owner, cancel)).json()).toMatchObject({ version: after.version })
    expect(await growth(owner)).toEqual(after)
  })

})
