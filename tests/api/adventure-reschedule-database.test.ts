import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Temporal } from '@js-temporal/polyfill'
import app from '../../worker/index'
import { taskHistorySchema, planningPageSchema, planningPreviewSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

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

describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 改期事务', () => {
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

  it('漏做任务改到今天，预览无写入并保留原安排和行动身份', async () => {
    const id = (await command(owner, { type: 'createTask', title: '继续原行动', description: '原始内容', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=past')
    const change = { type: 'rescheduleTask', id, plannedOn: before.today }
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: change })
    expect(preview.status).toBe(200)
    expect(planningPreviewSchema.parse(await preview.json())).toMatchObject({ operation: 'rescheduleTask', taskId: id, oldPlannedOn: '2020-01-01', newPlannedOn: before.today, requiresConfirmation: true })
    expect(await read(owner, '?taskRange=past')).toEqual(before)
    const value = { requestId: crypto.randomUUID(), expectedVersion: before.version, command: change }
    const response = await request(owner, '/api/adventure/commands', value)
    expect(response.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await response.json())
    expect(receipt.result).toMatchObject({ entityId: id, growthChange: { xpDelta: 0 } })
    expect(await (await request(owner, '/api/adventure/commands', value)).json()).toEqual(receipt)
    const after = await read(owner)
    expect(after.tasks).toHaveLength(1)
    expect(after.tasks[0]).toMatchObject({ id, plannedOn: before.today, status: 'pending', reward: null, arrangements: [
      { kind: 'task_created', newPlannedOn: '2020-01-01' },
      { kind: 'task_rescheduled', oldPlannedOn: '2020-01-01', newPlannedOn: before.today },
    ] })
    expect(after.growth).toEqual(before.growth)
    expect((await read(owner, '?taskRange=past')).tasks).toHaveLength(0)
  })
  it('连续改期保留完整来源链，编辑和迁移不改写历史，旧 requestId 只返回旧回执', async () => {
    const g = (await command(owner, { type: 'createGoal', destination: '', title: '原目标', standards: ['标准'] })).result.entityId
    const id = (await command(owner, { type: 'createTask', title: '原名称', description: '原说明', plannedOn: '2020-01-01', destination: g })).result.entityId
    const before = await read(owner)
    const first = envelope(before.version, { type: 'rescheduleTask', id, plannedOn: before.today })
    const receipt = planningReceiptSchema.parse(await (await send(owner, first)).json())
    await command(owner, { type: 'editTask', id, title: '新名称', description: '新说明' })
    await command(owner, { type: 'migrateTask', id, destination: '' })
    await command(owner, { type: 'rescheduleTask', id, plannedOn: '2099-01-01' })
    const after = await read(owner, '?taskRange=future')
    const chain = taskHistorySchema.parse(await (await request(owner, `/api/adventure/task-history?id=${id}`)).json()).items
    expect(chain).toHaveLength(3)
    expect(chain[1]).toMatchObject({ sourceEventId: chain[0].id, oldPlannedOn: '2020-01-01', newPlannedOn: before.today, goalId: g, title: '原名称', description: '原说明', goalTitle: '原目标' })
    expect(chain[2]).toMatchObject({ sourceEventId: chain[1].id, oldPlannedOn: before.today, newPlannedOn: '2099-01-01', goalId: null, title: '新名称', description: '新说明' })
    expect(await (await send(owner, first)).json()).toEqual(receipt)
    expect(await read(owner, '?taskRange=future')).toEqual(after)
    const collision = await send(owner, { ...first, command: { type: 'endTask', id } })
    expect(collision.status).toBe(409)
    expect(await collision.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    expect((await send(owner, envelope(after.version, { type: 'deleteTask', id }))).status).toBe(400)
    expect(after.growth).toEqual(before.growth)
  })

  it('改到今天后完成只计一次行动；完成须先合法取消再改期，原重试不撤回新安排', async () => {
    const id = (await command(owner, { type: 'createTask', title: '唯一行动', description: '', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner)
    const move = envelope(before.version, { type: 'rescheduleTask', id, plannedOn: before.today })
    const oldReceipt = await (await send(owner, move)).json()
    const completion = await command(owner, { type: 'completeTask', id })
    let state = await read(owner)
    expect(state.growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect(state.tasks[0].capabilities.reschedule.allowed).toBe(false)
    expect((await send(owner, envelope(state.version, { type: 'rescheduleTask', id, plannedOn: '2099-01-01' }))).status).toBe(400)
    await command(owner, { type: 'cancelTaskCompletion', completionId: completion.result.completionId! })
    await command(owner, { type: 'rescheduleTask', id, plannedOn: '2099-01-01' })
    state = await read(owner, '?taskRange=future')
    expect(state.growth).toMatchObject({ totalXp: 0, actions: 0 })
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id, reward: null, plannedOn: '2099-01-01', status: 'pending' })
    expect(await (await send(owner, move)).json()).toEqual(oldReceipt)
    expect(await read(owner, '?taskRange=future')).toEqual(state)
  })

  it('服务端拒绝过去、同日、非法日期及越权；失败均不写入', async () => {
    const id = (await command(owner, { type: 'createTask', title: '日期边界', description: '', plannedOn: '2099-01-01', destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=future')
    for (const [date, code] of [['2020-01-01', 'RESCHEDULE_PAST'], ['2099-01-01', 'SAME_DATE'], ['2026-02-30', 'INVALID_COMMAND']]) {
      const response = await request(owner, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: before.version, command: { type: 'rescheduleTask', id, plannedOn: date } })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code } })
      expect(await read(owner, '?taskRange=future')).toEqual(before)
    }
    const other = crypto.randomUUID()
    expect((await send(other, envelope(0, { type: 'rescheduleTask', id, plannedOn: before.today }))).status).toBe(404)
    expect(await read(owner, '?taskRange=future')).toEqual(before)
  })

  it('任务与上级终态拒绝改期，历史安排冻结在原归属', async () => {
    for (const terminal of ['endTask', 'endGoal', 'achieveGoal', 'endMainline'] as const) {
      const m = (await command(owner, { type: 'createMainline', name: terminal })).result.entityId
      const g = (await command(owner, { type: 'createGoal', destination: m, title: terminal, standards: ['标准'] })).result.entityId
      const id = (await command(owner, { type: 'createTask', title: terminal, description: '', plannedOn: '2099-01-01', destination: g })).result.entityId
      await command(owner, terminal === 'achieveGoal' ? { type: terminal, id: g, coefficient: 1, reflection: '' } : { type: terminal, id: terminal === 'endMainline' ? m : terminal === 'endGoal' ? g : id })
      const state = await read(owner, '?taskRange=future&includeTerminal=true')
      const response = await send(owner, envelope(state.version, { type: 'rescheduleTask', id, plannedOn: state.today }))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'READ_ONLY' } })
      expect(await read(owner, '?taskRange=future&includeTerminal=true')).toEqual(state)
    }
  })

  it('并发改期和同 key 重试只执行一次；与完成竞争保持版本、安排和奖励一致', async () => {
    const id = (await command(owner, { type: 'createTask', title: '竞争安排', description: '', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner)
    const value = envelope(before.version, { type: 'rescheduleTask', id, plannedOn: before.today })
    const responses = await Promise.all([send(owner, value), send(owner, value)])
    expect(responses.map(item => item.status)).toEqual([200, 200])
    expect(await responses[0].json()).toEqual(await responses[1].json())
    const state = await read(owner)
    expect(state.version).toBe(before.version + 1)
    expect(state.tasks[0].arrangements).toHaveLength(2)
    const contenders = await Promise.all([
      send(owner, envelope(state.version, { type: 'rescheduleTask', id, plannedOn: '2099-01-01' })),
      send(owner, envelope(state.version, { type: 'completeTask', id })),
    ])
    expect(contenders.map(item => item.status).sort()).toEqual([200, 409])
    const today = await read(owner)
    const future = await read(owner, '?taskRange=future')
    expect(today.version).toBe(state.version + 1)
    const tasks = [...today.tasks, ...future.tasks]
    expect(tasks).toHaveLength(1)
    const completed = tasks[0].status === 'completed'
    expect(today.growth).toMatchObject({ totalXp: completed ? 1 : 0, actions: completed ? 1 : 0 })
    expect(tasks[0].arrangements).toHaveLength(completed ? 2 : 3)
  })

  it('改期与结束／取消竞争只允许一个版本获胜', async () => {
    for (const contender of ['endTask', 'cancelTaskCompletion'] as const) {
      const today = (await read(owner)).today
      const id = (await command(owner, { type: 'createTask', title: contender, description: '', plannedOn: today, destination: '' })).result.entityId
      const completed = contender === 'cancelTaskCompletion' ? await command(owner, { type: 'completeTask', id }) : undefined
      const state = await read(owner)
      const results = await Promise.all([
        send(owner, envelope(state.version, { type: 'rescheduleTask', id, plannedOn: '2099-01-01' })),
        send(owner, envelope(state.version, completed ? { type: 'cancelTaskCompletion', completionId: completed.result.completionId! } : { type: 'endTask', id })),
      ])
      expect(results.filter(result => result.status === 200)).toHaveLength(1)
      expect(results.filter(result => result.status !== 200)).toHaveLength(1)
      expect((await read(owner)).version).toBe(state.version + 1)
    }
  })
  it('正式 HTTP 在日期更新后的事件写入失败整笔回滚，未知结果原封套重试仍无半安排', async () => {
    const id = (await command(owner, { type: 'createTask', title: 'reschedule-http-failpoint', description: '', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=past')
    const value = envelope(before.version, { type: 'rescheduleTask', id, plannedOn: before.today })
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await send(owner, value)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'ADVENTURE_UNAVAILABLE' } })
      expect(await read(owner, '?taskRange=past')).toEqual(before)
      expect((await read(owner)).tasks).toHaveLength(0)
    }
  })

  it('连续大内容改期的安排链分页完整、不重复，任务列表保持可读且历史查询账户隔离', async () => {
    const id = (await command(owner, { type: 'createTask', title: '分页历史', description: '原始说明'.repeat(1000), plannedOn: '2020-01-01', destination: '' })).result.entityId
    const today = (await read(owner)).today
    for (let i = 0; i < 100; i++) await command(owner, { type: 'rescheduleTask', id, plannedOn: i % 2 === 0 ? today : '2099-01-01' })
    const state = await read(owner, '?taskRange=future')
    expect(state.tasks[0]).toMatchObject({ id, totalArrangements: 101 })
    expect(state.tasks[0].arrangements).toHaveLength(5)
    const items = []
    for (let page = 1; page <= 21; page++) {
      const response = await request(owner, `/api/adventure/task-history?id=${id}&page=${page}`)
      expect(response.status).toBe(200)
      const history = taskHistorySchema.parse(await response.json())
      expect(history).toMatchObject({ version: state.version, taskId: id, total: 101, pageSize: 5, page })
      items.push(...history.items)
    }
    expect(items).toHaveLength(101)
    expect(new Set(items.map(item => item.id)).size).toBe(101)
    expect(items[0]).toMatchObject({ kind: 'task_created', newPlannedOn: '2020-01-01', sourceEventId: null })
    for (let i = 1; i < items.length; i++) expect(items[i]).toMatchObject({ sourceEventId: items[i - 1].id, oldPlannedOn: items[i - 1].newPlannedOn })
    expect((await request(crypto.randomUUID(), `/api/adventure/task-history?id=${id}`)).status).toBe(404)
    expect((await request(owner, `/api/adventure/task-history?id=${id}&page=0`)).status).toBe(400)
    expect(await read(owner, '?taskRange=future')).toEqual(state)
  })

})
