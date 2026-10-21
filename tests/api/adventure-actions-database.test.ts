import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Temporal } from '@js-temporal/polyfill'
import app from '../../worker/index'
import { planningPageSchema, planningPreviewSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

const rpcOrigin = process.env.ADVENTURE_LOCAL_RPC_URL
const nativeFetch = globalThis.fetch
const env = {
  SUPABASE_URL: 'https://planning-local-test.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only',
  AUTH_ALLOWED_EMAILS: 'actions@example.invalid',
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
const createTask = async (owner: string, title = '完整行动', plannedOn?: string, destination = '') => {
  const today = (await read(owner)).today
  return command(owner, { type: 'createTask', title, description: '行动说明', destination, plannedOn: plannedOn ?? today })
}

describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 任务事务', () => {
  beforeEach(() => {
    const target = new URL(rpcOrigin!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('仅允许独立本机 RPC 验收')
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== env.SUPABASE_URL) throw new Error('禁止非验收请求')
      if (url.pathname === '/auth/v1/user') {
        const token = new Headers(init.headers).get('Authorization')!.split('.')[1]
        const identity: { sub: string } = JSON.parse(atob(token))
        return Response.json({ id: identity.sub, email: 'actions@example.invalid', email_confirmed_at: '2026-10-21', is_anonymous: false })
      }
      if (!url.pathname.startsWith('/rest/v1/rpc/adventure_')) throw new Error('禁止非 RPC 请求')
      return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('空账户创建独立任务、编辑、完成和刷新回读，其他账户不能操作', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const task = (await createTask(owner)).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '改名后的行动', description: '新的说明' })
    expect((await read(owner)).tasks[0]).toMatchObject({ id: task, title: '改名后的行动', description: '新的说明', independent: true, goalId: null })
    if ((await send(owner, envelope(3, { type: 'createTask', title: '旧协议', description: '', plannedOn: (await read(owner)).today, destination: 'independent' as never }))).status !== 400) throw new Error('Explicit independent token must be rejected')
    const blocked = await send(other, envelope(0, { type: 'completeTask', id: task }))
    expect(blocked.status).toBe(404)
    const completed = await command(owner, { type: 'completeTask', id: task })
    expect(completed.result.reward).toEqual({ amount: 1, calculation: { type: 'fixed_task', completionId: completed.result.completionId, count: 1, coefficient: 1 } })
    expect((await read(owner)).tasks[0]).toMatchObject({ completionId: completed.result.completionId, reward: completed.result.reward })
    expect(completed.result.growthChange).toMatchObject({ xpDelta: 1, unlocked: ['迈出第一步'] })
    expect(await read(owner)).toMatchObject({ totalGoals: 0, mainlines: [], growth: { totalXp: 1, actions: 1 }, tasks: [{ status: 'completed' }] })
    expect(await read(other)).toMatchObject({ tasks: [], growth: { totalXp: 0 } })
  })

  it('目标任务保留真实目标归属；只返回当前日期范围的任务', async () => {
    const owner = crypto.randomUUID()
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '成果', standards: ['明确标准'] })).result.entityId
    const today = Temporal.PlainDate.from((await read(owner)).today)
    await createTask(owner, '今天', today.toString(), goal)
    const past = (await createTask(owner, '漏做', today.subtract({ days: 1 }).toString())).result.entityId
    const future = (await createTask(owner, '未来', today.add({ days: 1 }).toString())).result.entityId
    expect((await read(owner)).tasks).toEqual([expect.objectContaining({ title: '今天', goalId: goal, goalTitle: '成果', independent: false })])
    expect((await read(owner, '?taskRange=past')).tasks).toEqual([expect.objectContaining({ id: past, overdue: true, status: 'pending', capabilities: { complete: { allowed: false, reason: expect.any(String) }, edit: { allowed: true }, cancel: expect.any(Object), reschedule: expect.any(Object), migrate: expect.any(Object), end: expect.any(Object) } })])
    expect((await read(owner, '?taskRange=future')).tasks[0].id).toBe(future)
    for (const id of [past, future]) expect((await send(owner, envelope((await read(owner)).version, { type: 'completeTask', id }))).status).toBe(400)
    expect((await read(owner)).growth.totalXp).toBe(0)
  })

  it('取消预览无写入；取消、再完成后旧成功请求只回放，旧事件不能取消新完成', async () => {
    const owner = crypto.randomUUID()
    const id = (await createTask(owner)).result.entityId
    const completeA = envelope(1, { type: 'completeTask', id })
    const receiptA = planningReceiptSchema.parse(await (await send(owner, completeA)).json())
    const completed = await read(owner)
    const completionId = completed.tasks[0].completionId!
    const cancelA = envelope(2, { type: 'cancelTaskCompletion', completionId })
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: 2, command: cancelA.command })
    expect(preview.status).toBe(200)
    expect(planningPreviewSchema.parse(await preview.json())).toMatchObject({ version: 2, requiresConfirmation: true, reward: receiptA.result.reward, growthBefore: { totalXp: 1, actions: 1 }, growthAfter: { totalXp: 0, actions: 0 } })
    expect(await read(owner)).toEqual(completed)
    const cancelled = planningReceiptSchema.parse(await (await send(owner, cancelA)).json())
    expect(cancelled.result).toMatchObject({ completionId, reward: receiptA.result.reward, growthChange: { xpDelta: -1, lost: ['迈出第一步'] } })
    expect((await read(owner)).tasks[0]).toMatchObject({ completionId: null, reward: null })
    await command(owner, { type: 'completeTask', id })
    const newDone = (await read(owner)).tasks[0].completionId
    expect(newDone).not.toBe(completionId)
    expect(await (await send(owner, completeA)).json()).toEqual(receiptA)
    expect(await (await send(owner, cancelA)).json()).toEqual(cancelled)
    expect((await send(owner, envelope(4, cancelA.command))).status).toBe(409)
    expect(await read(owner)).toMatchObject({ version: 4, growth: { totalXp: 1, actions: 1 }, tasks: [{ completionId: newDone, status: 'completed' }] })
  })

  it('同 key 并发只完成一次，异 key 同版本仅一条成功', async () => {
    const owner = crypto.randomUUID()
    const id = (await createTask(owner)).result.entityId
    const same = envelope(1, { type: 'completeTask', id })
    const responses = await Promise.all([send(owner, same), send(owner, same)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(await responses[0].json()).toEqual(await responses[1].json())
    const completionId = (await read(owner)).tasks[0].completionId!
    const cancelled = await Promise.all([send(owner, envelope(2, { type: 'cancelTaskCompletion', completionId })), send(owner, envelope(2, { type: 'cancelTaskCompletion', completionId }))])
    expect(cancelled.map(response => response.status).sort()).toEqual([200, 409])
    expect((await read(owner)).growth).toMatchObject({ totalXp: 0, actions: 0 })
  })

  it('完成、取消和历史回执并发竞争后，按新版本执行剩余动作只保留一份有效奖励', async () => {
    const owner = crypto.randomUUID()
    const first = (await createTask(owner, '先完成')).result.entityId
    const original = envelope(1, { type: 'completeTask', id: first })
    const originalReceipt = await (await send(owner, original)).json()
    const completionId = (await read(owner)).tasks[0].completionId!
    const second = (await createTask(owner, '竞争完成')).result.entityId
    const cancel = envelope(3, { type: 'cancelTaskCompletion', completionId })
    const complete = envelope(3, { type: 'completeTask', id: second })
    const [a, b, retry] = await Promise.all([send(owner, cancel), send(owner, complete), send(owner, original)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(originalReceipt)
    const winning = a.status === 200 ? cancel : complete
    const winnerReceipt = await (a.status === 200 ? a : b).json()
    const afterRace = await read(owner)
    expect(afterRace.version).toBe(4)
    expect(afterRace.growth).toMatchObject(a.status === 200 ? { totalXp: 0, actions: 0 } : { totalXp: 2, actions: 2 })
    const losing = a.status === 200 ? complete : cancel
    await command(owner, losing.command)
    expect(await (await send(owner, winning)).json()).toEqual(winnerReceipt)
    const final = await read(owner)
    expect(final).toMatchObject({ version: 5, growth: { totalXp: 1, actions: 1 } })
    expect(final.tasks.find(task => task.id === first)).toMatchObject({ status: 'pending', reward: null, completionId: null })
    expect(final.tasks.find(task => task.id === second)).toMatchObject({ status: 'completed', reward: { amount: 1 } })
  })

  it('取消预览过期后不执行旧确认，不影响已经完成的事实', async () => {
    const owner = crypto.randomUUID()
    const id = (await createTask(owner)).result.entityId
    await command(owner, { type: 'completeTask', id })
    const completionId = (await read(owner)).tasks[0].completionId!
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: 2, command: { type: 'cancelTaskCompletion', completionId } })
    expect(preview.status).toBe(200)
    await createTask(owner, '另一个设备的新增')
    expect((await send(owner, envelope(2, { type: 'cancelTaskCompletion', completionId }))).status).toBe(409)
    expect((await read(owner)).growth).toMatchObject({ totalXp: 1, actions: 1 })
  })

  it('19→20→19→20 实时升级回退，七个成就依据有效事实重新计算', async () => {
    const owner = crypto.randomUUID()
    let last = ''
    for (let i = 1; i <= 20; i++) {
      last = (await createTask(owner, `行动 ${i}`)).result.entityId
      if (i < 20) await command(owner, { type: 'completeTask', id: last })
    }
    expect((await read(owner)).growth).toMatchObject({ totalXp: 19, level: 1, progress: 19, needed: 20, actions: 19 })
    await command(owner, { type: 'completeTask', id: last })
    const page = await read(owner)
    expect(page.growth).toMatchObject({ totalXp: 20, level: 2, progress: 0, needed: 25, actions: 20 })
    const task = page.tasks.find(task => task.id === last)!
    await command(owner, { type: 'cancelTaskCompletion', completionId: task.completionId! })
    expect((await read(owner)).growth).toMatchObject({ totalXp: 19, level: 1, progress: 19, actions: 19 })
    await command(owner, { type: 'completeTask', id: last })
    expect((await read(owner)).growth).toMatchObject({ totalXp: 20, level: 2, progress: 0, actions: 20 })
  }, 30_000)
})
