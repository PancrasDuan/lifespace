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

describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 跨功能集成', () => {
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

  it('改期完成后迁出、迁移原目标并达成：按发生时归属计奖，终态锁定和隐藏来源一致', async () => {
    const source = (await command(owner, { type: 'createMainline', name: '原主线' })).result.entityId
    const target = (await command(owner, { type: 'createMainline', name: '新主线' })).result.entityId
    const original = (await command(owner, { type: 'createGoal', title: '原成果', standards: ['原标准'], destination: source })).result.entityId
    const recipient = (await command(owner, { type: 'createGoal', title: '接收目标', standards: ['标准'], destination: target })).result.entityId
    const task = (await command(owner, { type: 'createTask', title: '联动行动', description: '冻结说明', plannedOn: '2020-01-01', destination: original })).result.entityId
    await command(owner, { type: 'rescheduleTask', id: task, plannedOn: (await read(owner)).today })
    const doneEnvelope = envelope((await read(owner)).version, { type: 'completeTask', id: task })
    const completed = planningReceiptSchema.parse(await (await send(owner, doneEnvelope)).json())
    await command(owner, { type: 'migrateTask', id: task, destination: recipient })
    await command(owner, { type: 'migrateGoal', id: original, destination: target })
    let page = await read(owner)
    expect(page.goals.find(g => g.id === original)?.progress).toMatchObject({ completed: 0, total: 0 })
    expect(page.goals.find(g => g.id === recipient)?.progress).toMatchObject({ completed: 1, total: 1 })
    const before = page
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: page.version, command: { type: 'achieveGoal', id: original, coefficient: 3 } })
    expect(preview.status).toBe(200)
    const value = planningPreviewSchema.parse(await preview.json())
    expect('rewards' in value && value.rewards[2]).toMatchObject({ amount: 3, calculation: { count: 1, coefficient: 3 } })
    expect(await read(owner)).toEqual(before)
    const achieved = await command(owner, { type: 'achieveGoal', id: original, coefficient: 3, reflection: '跨功能成果' })
    page = await read(owner)
    expect(page.tasks.find(t => t.id === task)).toMatchObject({ id: task, goalId: recipient, status: 'completed', capabilities: { cancel: { allowed: false } }, completionOrigin: { goalId: original, mainlineId: source } })
    expect((await send(owner, envelope(page.version, { type: 'cancelTaskCompletion', completionId: completed.result.completionId! }))).status).toBe(400)
    expect(await (await send(owner, doneEnvelope)).json()).toEqual(completed)
    await command(owner, { type: 'endMainline', id: source })
    await command(owner, { type: 'endMainline', id: target })
    expect((await read(owner)).goals).toEqual([])
    const detail = await read(owner, `?goalId=${original}`)
    expect(detail.goalDetail?.goal).toMatchObject({ status: 'achieved', title: '原成果' })
    expect(detail.goalDetail?.tasks).toHaveLength(1)
    const growth = growthPageSchema.parse(await (await request(owner, '/api/adventure/growth')).json())
    expect(growth).toMatchObject({ total: 2, growth: { totalXp: 4, actions: 1, achievedGoals: 1 } })
    const reward = rewardSourceSchema.parse(await (await request(owner, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)).json())
    expect(reward).toMatchObject({ event: { mainlineId: target, amount: 3 }, actionSources: [{ taskId: task, completionId: completed.result.completionId, mainlineId: source, goalId: original, title: '联动行动' }] })
    expect((await request(crypto.randomUUID(), `/api/adventure/reward-source?id=${achieved.result.achievementId}`)).status).toBe(404)
  })

  it('聚焦迁入和本地聚焦争最后名额，只有一个新版本提交；失败者不能挤占名额', async () => {
    const main = (await command(owner, { type: 'createMainline', name: '名额目的' })).result.entityId
    for (let i = 0; i < 2; i++) {
      const id = (await command(owner, { type: 'createGoal', title: `已有聚焦 ${i}`, standards: ['标准'], destination: main })).result.entityId
      await command(owner, { type: 'focusGoal', id, focused: true })
    }
    const incoming = (await command(owner, { type: 'createGoal', title: '迁入聚焦', standards: ['标准'], destination: '' })).result.entityId
    await command(owner, { type: 'focusGoal', id: incoming, focused: true })
    const local = (await command(owner, { type: 'createGoal', title: '本地聚焦', standards: ['标准'], destination: main })).result.entityId
    const before = await read(owner)
    const inputs = [envelope(before.version, { type: 'migrateGoal', id: incoming, destination: main }), envelope(before.version, { type: 'focusGoal', id: local, focused: true })]
    const responses = await Promise.all(inputs.map(value => send(owner, value)))
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    const winner = responses.findIndex(r => r.status === 200)
    const receipt = await responses[winner].json()
    expect(await (await send(owner, inputs[winner])).json()).toEqual(receipt)
    const after = await read(owner)
    expect(after.version).toBe(before.version + 1)
    expect(after.goals.filter(g => g.mainlineId === main && g.focused)).toHaveLength(3)
    const loser = inputs[1 - winner].command
    expect((await send(owner, envelope(after.version, loser))).status).toBe(400)
    expect(await read(owner)).toEqual(after)
    expect(after.growth).toEqual(before.growth)
  })

  it('未来任务改期再迁移仍失去误建删除资格，停止后零分母且保留完整原安排', async () => {
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '未来行动', description: '', plannedOn: '2099-01-01', destination: '' })).result.entityId
    await command(owner, { type: 'rescheduleTask', id: task, plannedOn: '2099-01-02' })
    const goal = (await command(owner, { type: 'createGoal', title: '接收安排', standards: ['标准'], destination: '' })).result.entityId
    await command(owner, { type: 'migrateTask', id: task, destination: goal })
    const before = await read(owner, '?taskRange=future')
    expect(before.tasks[0]).toMatchObject({ id: task, plannedOn: '2099-01-02', capabilities: { delete: { allowed: false } } })
    expect((await send(owner, envelope(before.version, { type: 'deleteTask', id: task }))).status).toBe(400)
    expect(await read(owner, '?taskRange=future')).toEqual(before)
    await command(owner, { type: 'endGoal', id: goal })
    const after = await read(owner, `?taskRange=future&goalId=${goal}`)
    expect(after.goalDetail?.goal.progress).toMatchObject({ completed: 0, total: 0 })
    expect(after.goalDetail?.tasks[0]).toMatchObject({ id: task, status: 'ended', arrangements: [{ newPlannedOn: '2099-01-01' }, { oldPlannedOn: '2099-01-01', newPlannedOn: '2099-01-02' }] })
    expect(after.growth).toMatchObject({ totalXp: 0, actions: 0 })
    expect(after.today).toBe(today)
  })
})
