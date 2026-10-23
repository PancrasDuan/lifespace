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

  it('迁移任务保持身份、安排、冻结历史奖励，迁入不补记计奖且原目标达成后锁定', async () => {
    const owner = crypto.randomUUID()
    const a = (await command(owner, { type: 'createGoal', destination: '', title: '原目标', standards: ['标准'] })).result.entityId
    const b = (await command(owner, { type: 'createGoal', destination: '', title: '新目标', standards: ['标准'] })).result.entityId
    const task = (await createTask(owner, '迁移行动', undefined, a)).result.entityId
    await command(owner, { type: 'completeTask', id: task })
    const before = (await read(owner)).tasks[0]
    const move = envelope((await read(owner)).version, { type: 'migrateTask', id: task, destination: b })
    const response = await send(owner, move)
    expect(response.status).toBe(200)
    const receipt = await response.json()
    expect((await read(owner)).tasks[0]).toMatchObject({ id: task, goalId: b, plannedOn: before.plannedOn, status: 'completed', completionId: before.completionId, reward: before.reward,
      completionOrigin: { goalId: a, goalTitle: '原目标', title: '迁移行动' } })
    expect(await (await send(owner, move)).json()).toEqual(receipt)
    const preview = async (id: string) => (await request(owner, '/api/adventure/preview', { expectedVersion: (await read(owner)).version, command: { type: 'achieveGoal', id } })).json()
    expect(await preview(a)).toMatchObject({ rewards: [{ calculation: { count: 1, actionIds: [task] } }, {}, {}] })
    expect(await preview(b)).toMatchObject({ rewards: [{ calculation: { count: 0, fallback: true } }, {}, {}] })
    await command(owner, { type: 'achieveGoal', id: a, coefficient: 2, reflection: '' })
    const locked = await read(owner)
    expect(locked.tasks[0].capabilities.migrate.allowed).toBe(false)
    expect((await send(owner, envelope(locked.version, { type: 'migrateTask', id: task, destination: '' }))).status).toBe(400)
    expect((await send(owner, envelope(locked.version, { type: 'cancelTaskCompletion', completionId: before.completionId! }))).status).toBe(400)
    expect(await read(owner)).toEqual(locked)
    expect(locked.growth).toMatchObject({ totalXp: 3, actions: 1, achievedGoals: 1 })
  })


  it('目标跨主线与独立归属迁移保留聚焦、任务身份，按同类组末尾落位且幂等', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const a = (await command(owner, { type: 'createMainline', name: '来源主线' })).result.entityId
    const b = (await command(owner, { type: 'createMainline', name: '目的主线' })).result.entityId
    const goal = (await command(owner, { type: 'createGoal', destination: a, title: '随行成果', standards: ['原标准'] })).result.entityId
    const peers: string[] = []
    for (let i = 0; i < 3; i++) peers.push((await command(owner, { type: 'createGoal', destination: b, title: `目的目标 ${i}`, standards: ['标准'] })).result.entityId)
    await command(owner, { type: 'focusGoal', id: goal, focused: true })
    await command(owner, { type: 'focusGoal', id: peers[0], focused: true })
    const task = (await createTask(owner, '跟随任务', undefined, goal)).result.entityId
    await command(owner, { type: 'completeTask', id: task })
    const before = await read(owner)
    const move = envelope(before.version, { type: 'migrateGoal', id: goal, destination: b })
    const options = await request(owner, `/api/adventure/migration-options?kind=goal&id=${goal}`)
    expect(options.status).toBe(200)
    expect(await options.json()).toMatchObject({ version: before.version, options: expect.arrayContaining([
      expect.objectContaining({ id: a, capability: { allowed: false, reason: '当前归属，无需迁移' } }),
      expect.objectContaining({ id: b, capability: { allowed: true } }),
    ]) })
    expect(await read(owner)).toEqual(before)
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: move.command })
    expect(preview.status).toBe(200)
    expect(planningPreviewSchema.parse(await preview.json())).toMatchObject({ version: before.version, requiresConfirmation: false })
    expect(await read(owner)).toEqual(before)
    const responses = await Promise.all([send(owner, move), send(owner, move)])
    expect(responses.map(value => value.status)).toEqual([200, 200])
    const receipt = await responses[0].json()
    expect(await responses[1].json()).toEqual(receipt)
    const after = await read(owner)
    expect(after.goals.map(g => g.id)).toEqual([peers[0], goal, peers[1], peers[2]])
    expect(after.tasks[0]).toMatchObject({ id: task, goalId: goal, mainlineName: '目的主线', completionOrigin: { mainlineId: a, mainlineName: '来源主线' }, reward: before.tasks[0].reward })
    expect(after.goals.find(g => g.id === goal)).toMatchObject({ focused: true, title: '随行成果', standards: ['原标准'] })
    expect(after.growth).toEqual(before.growth)
    await command(owner, { type: 'migrateGoal', id: goal, destination: '' })
    expect((await read(owner)).goals.find(g => g.id === goal)).toMatchObject({ independent: true, focused: true })
    expect(await (await send(owner, move)).json()).toEqual(receipt)
    expect((await send(other, envelope(0, move.command))).status).toBe(404)
    expect((await request(other, `/api/adventure/migration-options?kind=goal&id=${goal}`)).status).toBe(404)
    expect((await send(owner, { ...move, command: { type: 'migrateGoal', id: goal, destination: a } })).status).toBe(409)
    await command(owner, { type: 'migrateGoal', id: goal, destination: a })
    const final = await read(owner)
    expect(final.mainlines).toHaveLength(2)
    expect(final.totalGoals).toBe(4)
    expect(final.goals.find(g => g.id === goal)).toMatchObject({ mainlineId: a, focused: true })
  })

  it('聚焦迁移竞争最后名额，满额候选和旧编辑入口均不能超额，失败无变化', async () => {
    const owner = crypto.randomUUID()
    const main = (await command(owner, { type: 'createMainline', name: '配额目的' })).result.entityId
    for (let i = 0; i < 2; i++) {
      const id = (await command(owner, { type: 'createGoal', destination: main, title: `已有 ${i}`, standards: ['标准'] })).result.entityId
      await command(owner, { type: 'focusGoal', id, focused: true })
    }
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const id = (await command(owner, { type: 'createGoal', destination: '', title: `迁移 ${i}`, standards: ['标准'] })).result.entityId
      ids.push(id)
      await command(owner, { type: 'focusGoal', id, focused: true })
    }
    const before = await read(owner)
    const inputs = ids.map(id => envelope(before.version, { type: 'migrateGoal', id, destination: main }))
    const responses = await Promise.all(inputs.map(value => send(owner, value)))
    expect(responses.map(value => value.status).sort()).toEqual([200, 409])
    const loser = responses.findIndex(value => value.status === 409)
    const after = await read(owner)
    expect(after.goals.filter(g => g.focused && g.mainlineId === main)).toHaveLength(3)
    const options = await (await request(owner, `/api/adventure/migration-options?kind=goal&id=${ids[loser]}`)).json()
    expect(options).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ id: main, capability: { allowed: false, reason: expect.stringContaining('3') } })]) })
    const blocked = await send(owner, { ...inputs[loser], expectedVersion: after.version })
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toMatchObject({ error: { code: 'FOCUS_LIMIT' } })
    expect((await send(owner, envelope(after.version, { type: 'editGoal', id: ids[loser], destination: main, title: '旧入口', standards: ['标准'] }))).status).toBe(400)
    expect(await read(owner)).toEqual(after)
  })

  it('任务候选分页包含当前和终态原因，跨账户及主线目的拒绝，独立任务往返保留安排与状态', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const main = (await command(owner, { type: 'createMainline', name: '不是任务容器' })).result.entityId
    const goals: string[] = []
    for (let i = 0; i < 23; i++) goals.push((await command(owner, { type: 'createGoal', destination: '', title: `候选 ${String(i).padStart(2, '0')}`, standards: ['标准'] })).result.entityId)
    await command(owner, { type: 'achieveGoal', id: goals[1], coefficient: 1, reflection: '' })
    const foreign = (await command(other, { type: 'createGoal', destination: '', title: '其他账户', standards: ['标准'] })).result.entityId
    const day = Temporal.PlainDate.from((await read(owner)).today).add({ days: 5 }).toString()
    const task = (await createTask(owner, '未来独立任务', day)).result.entityId
    const options = async (page: number) => (await (await request(owner, `/api/adventure/migration-options?kind=task&id=${task}&page=${page}`)).json()) as { total: number; options: { id: string; capability: { allowed: boolean; reason?: string } }[] }
    const a = await options(1), b = await options(2)
    expect(a.total).toBe(24)
    expect(a.options).toHaveLength(20)
    expect(b.options).toHaveLength(4)
    expect(new Set([...a.options, ...b.options].map(o => o.id)).size).toBe(24)
    expect(a.options.find(o => o.id === goals[1])?.capability.allowed).toBe(false)
    expect([...a.options, ...b.options].some(o => o.id === foreign || o.id === main)).toBe(false)
    const before = await read(owner, '?taskRange=future')
    for (const destination of [main, foreign, goals[1]]) expect((await send(owner, envelope(before.version, { type: 'migrateTask', id: task, destination }))).status).toBe(destination === goals[1] ? 400 : 404)
    expect(await read(owner, '?taskRange=future')).toEqual(before)
    const target = b.options[0].id
    await command(owner, { type: 'migrateTask', id: task, destination: target })
    expect((await read(owner, '?taskRange=future')).tasks[0]).toMatchObject({ id: task, goalId: target, plannedOn: day, status: 'pending' })
    await command(owner, { type: 'migrateTask', id: task, destination: '' })
    expect((await read(owner, '?taskRange=future')).tasks[0]).toMatchObject({ id: task, independent: true, plannedOn: day, status: 'pending' })
  })

  it('迁移、完成、取消及达成并发仅一个新命令提交，回执重试不改变终态或奖励', async () => {
    const owner = crypto.randomUUID()
    const a = (await command(owner, { type: 'createGoal', destination: '', title: '竞争来源', standards: ['标准'] })).result.entityId
    const b = (await command(owner, { type: 'createGoal', destination: '', title: '竞争目的', standards: ['标准'] })).result.entityId
    const task = (await createTask(owner, '竞争任务', undefined, a)).result.entityId
    const before = await read(owner)
    const move = envelope(before.version, { type: 'migrateTask', id: task, destination: b })
    const finish = envelope(before.version, { type: 'completeTask', id: task })
    const race = await Promise.all([send(owner, move), send(owner, finish)])
    expect(race.map(r => r.status).sort()).toEqual([200, 409])
    await command(owner, race[0].status === 200 ? finish.command : move.command)
    const done = await read(owner), completionId = done.tasks[0].completionId!
    const requests = [envelope(done.version, { type: 'migrateTask', id: task, destination: '' }), envelope(done.version, { type: 'cancelTaskCompletion', completionId }), envelope(done.version, { type: 'achieveGoal', id: b, coefficient: 1, reflection: '' })]
    const finalRace = await Promise.all(requests.map(value => send(owner, value)))
    expect(finalRace.map(r => r.status).sort()).toEqual([200, 409, 409])
    const winner = finalRace.findIndex(r => r.status === 200), receipt = await finalRace[winner].json()
    const final = await read(owner)
    expect(final.version).toBe(done.version + 1)
    expect(await (await send(owner, requests[winner])).json()).toEqual(receipt)
    expect(await read(owner)).toEqual(final)
  })

  it('取消旧完成后在新归属完成，原目标不展示新归属的完成与奖励', async () => {
    const owner = crypto.randomUUID()
    const a = (await command(owner, { type: 'createGoal', title: '取消来源', standards: ['标准'], destination: '' })).result.entityId
    const b = (await command(owner, { type: 'createGoal', title: '再次完成归属', standards: ['标准'], destination: '' })).result.entityId
    const id = (await createTask(owner, '取消后迁出', undefined, a)).result.entityId
    await command(owner, { type: 'completeTask', id })
    const old = (await read(owner)).tasks[0].completionId!
    await command(owner, { type: 'cancelTaskCompletion', completionId: old })
    await command(owner, { type: 'migrateTask', id, destination: b })
    await command(owner, { type: 'completeTask', id })
    expect((await read(owner, `?goalId=${a}`)).goalDetail).toMatchObject({ totalTasks: 0, tasks: [] })
    expect((await read(owner, `?goalId=${b}`)).goalDetail).toMatchObject({ totalTasks: 1, tasks: [{ completionOrigin: { goalId: b, goalTitle: '再次完成归属' }, reward: { amount: 1 } }] })
    expect((await read(owner)).growth).toMatchObject({ totalXp: 1, actions: 1 })
  })

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
    expect((await read(owner, '?taskRange=past')).tasks).toEqual([expect.objectContaining({ id: past, overdue: true, status: 'pending', capabilities: { complete: { allowed: false, reason: expect.any(String) }, edit: { allowed: true }, cancel: expect.any(Object), reschedule: expect.any(Object), migrate: expect.any(Object), end: expect.any(Object), delete: { allowed: false, reason: expect.any(String) } } })])
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
  it('聚焦配额按归属独立计数，并发争最后名额、幂等与跨账户拒绝均保持原子', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const main = (await command(owner, { type: 'createMainline', name: '普通主线' })).result.entityId
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await command(owner, { type: 'createGoal', destination: main, title: `目标 ${i}`, standards: ['标准'] })).result.entityId)
    for (const id of ids.slice(0, 2)) await command(owner, { type: 'focusGoal', id, focused: true })
    const before = await read(owner)
    const requests = ids.slice(2).map(id => envelope(before.version, { type: 'focusGoal', id, focused: true }))
    const race = await Promise.all(requests.map(value => send(owner, value)))
    expect(race.map(response => response.status).sort()).toEqual([200, 409])
    const winner = race.findIndex(response => response.status === 200), loser = 1 - winner
    const receipt = await race[winner].json()
    expect(await (await send(owner, requests[winner])).json()).toEqual(receipt)
    const full = await read(owner)
    expect(full.goals.filter(goal => goal.focused)).toHaveLength(3)
    const failure = await send(owner, envelope(full.version, requests[loser].command))
    expect(failure.status).toBe(400)
    expect(await failure.json()).toMatchObject({ error: { code: 'FOCUS_LIMIT' } })
    expect(await read(owner)).toEqual(full)
    expect((await send(owner, { ...requests[winner], command: { type: 'focusGoal', id: ids[0], focused: false } })).status).toBe(409)
    expect((await send(other, envelope(0, { type: 'focusGoal', id: ids[0], focused: true }))).status).toBe(404)
    expect((await send(other, envelope(0, { type: 'reorderGoals', mainlineId: main, id: ids[0], direction: 'up' }))).status).toBe(404)
    // No account-wide cap: independent goals have their own three slots.
    const independents: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = (await command(owner, { type: 'createGoal', destination: '', title: `独立目标 ${i}`, standards: ['标准'] })).result.entityId
      independents.push(id)
      if (i < 3) await command(owner, { type: 'focusGoal', id, focused: true })
    }
    expect((await read(owner)).goals.filter(goal => goal.focused)).toHaveLength(6)
    const version = (await read(owner)).version
    expect((await send(owner, envelope(version, { type: 'focusGoal', id: independents[3], focused: true }))).status).toBe(400)
    // Existing destination editing must not bypass the focus quota.
    expect((await send(owner, envelope(version, { type: 'editGoal', id: ids[0], destination: '', title: '不能超额迁入', standards: ['标准'] }))).status).toBe(400)
    expect((await read(owner)).version).toBe(version)
    await command(owner, { type: 'focusGoal', id: independents[0], focused: false })
    await command(owner, { type: 'focusGoal', id: independents[3], focused: true })
  })

  it('同归属同聚焦组排序支持相邻移动与拖动目标，非法排序回滚并保留稳定回执', async () => {
    const owner = crypto.randomUUID()
    const ids: string[] = []
    const destination = (await command(owner, { type: 'createMainline', name: '排序主线' })).result.entityId
    for (let i = 0; i < 4; i++) ids.push((await command(owner, { type: 'createGoal', destination, title: `顺序 ${i}`, standards: ['标准'] })).result.entityId)
    const initial = await read(owner), mainlineId = initial.goals[0].mainlineId
    const original = envelope(initial.version, { type: 'reorderGoals', id: ids[3], mainlineId, direction: 'up', targetId: ids[0] })
    const receipt = await (await send(owner, original)).json()
    expect((await read(owner)).goals.map(goal => goal.id)).toEqual([ids[3], ids[0], ids[1], ids[2]])
    await command(owner, { type: 'reorderGoals', id: ids[3], mainlineId, direction: 'down' })
    expect((await read(owner)).goals.map(goal => goal.id)).toEqual([ids[0], ids[3], ids[1], ids[2]])
    expect(await (await send(owner, original)).json()).toEqual(receipt)
    await command(owner, { type: 'focusGoal', id: ids[2], focused: true })
    const before = await read(owner)
    expect(before.goals[0].id).toBe(ids[2])
    const invalid = await send(owner, envelope(before.version, { type: 'reorderGoals', id: ids[0], mainlineId, direction: 'down', targetId: ids[2] }))
    expect(invalid.status).toBe(400)
    expect(await read(owner)).toEqual(before)
    const otherMain = (await command(owner, { type: 'createMainline', name: '其他组' })).result.entityId
    const wrong = await read(owner)
    expect((await send(owner, envelope(wrong.version, { type: 'reorderGoals', id: ids[0], mainlineId: otherMain, direction: 'up' }))).status).toBe(404)
    expect(await read(owner)).toEqual(wrong)
    const paged = await read(owner, '?pageSize=1&page=2')
    expect(paged.goals[0].id).toBe(ids[0])
    expect(paged.mainlines.find(item => item.id === mainlineId)?.activeGoalCount).toBe(4)
    expect((await read(owner, `?mainlineId=${mainlineId}&pageSize=1`)).mainlineDetail?.activeGoalCount).toBe(4)
    const focusedPage = await read(owner, '?goalScope=focus&pageSize=1')
    expect(focusedPage.totalGoals).toBe(1)
    expect(focusedPage.goals.map(goal => goal.id)).toEqual([ids[2]])
    expect(focusedPage.mainlines.find(item => item.id === mainlineId)?.activeGoalCount).toBe(4)
    await createTask(owner, '主线今天行动', focusedPage.today, ids[0])
    const main = (await read(owner, '?taskRange=future&search=无匹配')).mainlines.find(item => item.id === mainlineId)!
    expect(main.todayTaskCount).toBe(1)
    expect((await read(owner, `?mainlineId=${mainlineId}`)).mainlineDetail?.todayTaskCount).toBe(1)
  })

  it('搜索和日期与双视图组合，分页不截断进度，取消后重算但不自动达成', async () => {
    const owner = crypto.randomUUID()
    const focused = (await command(owner, { type: 'createGoal', destination: '', title: '聚焦结果', standards: ['标准'] })).result.entityId
    const unfocused = (await command(owner, { type: 'createGoal', destination: '', title: '普通结果', standards: ['标准'] })).result.entityId
    await command(owner, { type: 'focusGoal', id: focused, focused: true })
    const today = Temporal.PlainDate.from((await read(owner)).today)
    const a = (await createTask(owner, '检索行动 A', today.toString(), focused)).result.entityId
    const b = (await createTask(owner, '检索行动 B', today.toString(), focused)).result.entityId
    await createTask(owner, '检索待完成', today.toString(), focused)
    await createTask(owner, '检索独立', today.toString())
    const outside = (await createTask(owner, '检索未聚焦', today.toString(), unfocused)).result.entityId
    await createTask(owner, '检索未来', today.add({ days: 1 }).toString(), focused)
    await createTask(owner, '检索过去', today.subtract({ days: 1 }).toString(), focused)
    await createTask(owner, '含 %_ 字面符号', today.toString(), focused)
    await command(owner, { type: 'completeTask', id: a })
    await command(owner, { type: 'completeTask', id: b })
    let page = await read(owner, '?pageSize=1&taskScope=focus&search=检索')
    expect(page).toMatchObject({ totalTasks: 4, taskProgress: { completed: 2, total: 4, ratio: 0.5 } })
    expect(page.todayTaskProgress).toEqual({ completed: 2, total: 6, ratio: 2 / 6 })
    expect(page.tasks).toHaveLength(1)
    expect(page.goals[0].progress).toMatchObject({ completed: 2, total: 6 })
    expect((await read(owner, '?taskScope=all&search=检索')).totalTasks).toBe(5)
    expect((await read(owner, '?taskScope=focus&search=检索&taskRange=future'))).toMatchObject({ totalTasks: 1, todayTaskProgress: { completed: 2, total: 6 }, taskProgress: { completed: 0, total: 1, ratio: 0 } })
    expect((await read(owner, '?taskScope=focus&search=检索&taskRange=past'))).toMatchObject({ totalTasks: 1, taskProgress: { completed: 0, total: 1 } })
    expect((await read(owner, '?search=%25_')).totalTasks).toBe(1)
    expect((await read(owner, '?search=行动说明')).totalTasks).toBe(6)
    const full = await read(owner)
    const completionId = full.tasks.find(task => task.id === a)!.completionId!
    await command(owner, { type: 'cancelTaskCompletion', completionId })
    page = await read(owner, '?taskScope=focus&search=检索')
    expect(page.taskProgress).toMatchObject({ completed: 1, total: 4, ratio: 0.25 })
    const noMatches = await read(owner, '?search=没有匹配')
    expect(noMatches.taskProgress).toEqual({ completed: 0, total: 0, ratio: null })
    expect(noMatches.todayTaskProgress).toMatchObject({ completed: 1, total: 6 })
    // Unfocused tasks remain executable.
    await command(owner, { type: 'completeTask', id: outside })
    expect((await read(owner)).totalGoals).toBe(2)
    expect((await read(owner)).growth.achievedGoals).toBe(0)
  })

  it('目标八次行动选系数二：额外入账16、总经验24、pending结束并保留completed', async () => {
    const owner = crypto.randomUUID()
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '八次行动成果', standards: ['按标准确认结果'] })).result.entityId
    await command(owner, { type: 'focusGoal', id: goal, focused: true })
    const ids: string[] = []
    for (let i = 0; i < 8; i++) {
      const id = (await createTask(owner, `计奖行动 ${i}`, undefined, goal)).result.entityId
      ids.push(id)
      await command(owner, { type: 'completeTask', id })
    }
    const pending = (await createTask(owner, '停止的安排', undefined, goal)).result.entityId
    const before = await read(owner)
    expect(before).toMatchObject({ totalGoals: 1, growth: { totalXp: 8, actions: 8, achievedGoals: 0 } })
    const achieve = envelope(before.version, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '有明确成果' })
    const response = await send(owner, achieve)
    expect(response.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await response.json())
    expect(receipt.result.reward).toMatchObject({ amount: 16, calculation: { type: 'goal_actions', count: 8, coefficient: 2, fallback: false } })
    expect(new Set(receipt.result.reward && 'actionIds' in receipt.result.reward.calculation ? receipt.result.reward.calculation.actionIds : [])).toEqual(new Set(ids))
    const after = await read(owner)
    expect(after).toMatchObject({ totalGoals: 0, growth: { totalXp: 24, level: 2, progress: 4, actions: 8, achievedGoals: 1 } })
    expect(after.tasks.find(task => task.id === pending)).toMatchObject({ status: 'ended', capabilities: { edit: { allowed: false }, complete: { allowed: false } } })
    expect(after.tasks.filter(task => task.status === 'completed')).toHaveLength(8)
    for (const task of after.tasks.filter(task => task.status === 'completed')) expect(task.capabilities.cancel.allowed).toBe(false)
    expect(await (await send(owner, achieve)).json()).toEqual(receipt)
    expect((await send(owner, envelope(after.version, achieve.command))).status).toBe(400)
    expect((await read(owner)).growth.totalXp).toBe(24)
  })

  it('零行动三种系数均保底1，预览无写入，默认评价与感想可省略', async () => {
    for (const coefficient of [1, 2, 3]) {
      const owner = crypto.randomUUID()
      const id = (await command(owner, { type: 'createGoal', destination: '', title: '无行动成果', standards: ['独立成果'] })).result.entityId
      const before = await read(owner)
      const previewResponse = await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: { type: 'achieveGoal', id } })
      expect(previewResponse.status).toBe(200)
      const preview = planningPreviewSchema.parse(await previewResponse.json())
      expect(preview).toMatchObject({ requiresConfirmation: true, operation: 'achieveGoal', version: before.version, goalId: id, standards: ['独立成果'], stoppingTasks: [] })
      if (!('rewards' in preview)) throw new Error('Missing achievement preview')
      expect(preview.rewards.map(reward => reward.amount)).toEqual([1, 1, 1])
      expect(await read(owner)).toEqual(before)
      const response = await request(owner, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: before.version,
        command: coefficient === 1 ? { type: 'achieveGoal', id } : { type: 'achieveGoal', id, coefficient } })
      expect(response.status).toBe(200)
      const receipt = planningReceiptSchema.parse(await response.json())
      expect(receipt.result.reward).toEqual({ amount: 1, calculation: { type: 'goal_actions', actionIds: [], count: 0, coefficient, fallback: true } })
      expect(receipt.result.growthChange).toMatchObject({ xpDelta: 1, unlocked: ['首个成果'], after: { totalXp: 1, actions: 0, achievedGoals: 1 } })
      const detail = (await read(owner, `?goalId=${id}`)).goalDetail!
      expect(detail.goal).toMatchObject({ id, status: 'achieved', focused: false, achievement: { reflection: '', reward: receipt.result.reward } })
      expect(detail.tasks).toEqual([])
    }
  })

  it('达成预览冻结全量影响、默认隐藏终态，稳定ID详情分页与终态能力均正确', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const id = (await command(owner, { type: 'createGoal', destination: '', title: '有待完成的成果', standards: ['最终标准'] })).result.entityId
    const completed = (await createTask(owner, '已完成保留', undefined, id)).result.entityId
    await command(owner, { type: 'completeTask', id: completed })
    const pending = (await createTask(owner, '等待结束', undefined, id)).result.entityId
    const before = await read(owner)
    const completionId = before.tasks.find(task => task.id === completed)!.completionId!
    const input = { type: 'achieveGoal', id, coefficient: 3, reflection: '冻结感想' } as const
    const response = await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: input })
    expect(response.status).toBe(200)
    const preview = planningPreviewSchema.parse(await response.json())
    expect(preview).toMatchObject({ stoppingTasks: [{ id: pending, title: '等待结束' }], rewards: [{ amount: 1 }, { amount: 2 }, { amount: 3 }] })
    expect(await read(owner)).toEqual(before)
    await command(owner, input)
    const after = await read(owner)
    expect(after.goals).toEqual([])
    const detail = await read(owner, `?goalId=${id}&pageSize=1&goalTaskPage=2`)
    expect(detail.goalDetail).toMatchObject({ totalTasks: 2, taskPage: 2, goal: { id, status: 'achieved', achievement: { reflection: '冻结感想', reward: { amount: 3, calculation: { count: 1, coefficient: 3 } } } }, tasks: [{ id: pending, status: 'ended' }] })
    for (const operation of ['edit', 'focus', 'reorder', 'achieve', 'createTask']) expect(detail.goalDetail!.goal.capabilities[operation].allowed).toBe(false)
    for (const cmd of [
      { type: 'editGoal', id, destination: '', title: '非法改名', standards: ['标准'] },
      { type: 'focusGoal', id, focused: true },
      { type: 'reorderGoals', id, mainlineId: detail.goalDetail!.goal.mainlineId, direction: 'up' },
      { type: 'createTask', destination: id, title: '非法新增', description: '', plannedOn: after.today },
      { type: 'completeTask', id: pending }, { type: 'editTask', id: pending, title: '非法编辑', description: '' },
      { type: 'cancelTaskCompletion', completionId },
    ] satisfies PlanningCommand[]) expect((await send(owner, envelope(after.version, cmd))).status).toBe(400)
    expect(await read(owner)).toEqual(after)
    expect((await request(other, `/api/adventure?goalId=${id}`)).status).toBe(404)
    expect((await send(other, envelope(0, input))).status).toBe(404)
  })

  it('达成预览后版本改变拒绝旧确认，重新预览才采用新的N与奖励', async () => {
    const owner = crypto.randomUUID()
    const id = (await command(owner, { type: 'createGoal', destination: '', title: '版本成果', standards: ['标准'] })).result.entityId
    const task = (await createTask(owner, '预览后执行', undefined, id)).result.entityId
    const before = await read(owner)
    const input = { type: 'achieveGoal', id, coefficient: 3, reflection: '' } as const
    expect((await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: input })).status).toBe(200)
    await command(owner, { type: 'completeTask', id: task })
    const current = await read(owner)
    expect((await send(owner, envelope(before.version, input))).status).toBe(409)
    expect((await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: input })).status).toBe(409)
    expect(await read(owner)).toEqual(current)
    const renewed = await request(owner, '/api/adventure/preview', { expectedVersion: current.version, command: input })
    expect(planningPreviewSchema.parse(await renewed.json())).toMatchObject({ rewards: [{ amount: 1 }, { amount: 2 }, { amount: 3 }] })
    await command(owner, input)
    expect((await read(owner)).growth).toMatchObject({ totalXp: 4, actions: 1, achievedGoals: 1 })
  })

  it('取消与达成竞争只一方提交；同key并发达成只入账一次，旧回执不复活完成', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const owner = crypto.randomUUID()
      const id = (await command(owner, { type: 'createGoal', destination: '', title: '并发成果', standards: ['标准'] })).result.entityId
      const task = (await createTask(owner, '竞争行动', undefined, id)).result.entityId
      const complete = envelope((await read(owner)).version, { type: 'completeTask', id: task })
      const original = await (await send(owner, complete)).json()
      const before = await read(owner), completionId = before.tasks[0].completionId!
      const achieve = envelope(before.version, { type: 'achieveGoal', id, coefficient: 2, reflection: '' })
      const cancel = envelope(before.version, { type: 'cancelTaskCompletion', completionId })
      const race = await Promise.all(attempt % 2 ? [send(owner, cancel), send(owner, achieve)] : [send(owner, achieve), send(owner, cancel)])
      expect(race.map(result => result.status).sort()).toEqual([200, 409])
      const current = await read(owner)
      if (current.growth.achievedGoals === 0) {
        expect(current.growth).toMatchObject({ totalXp: 0, actions: 0 })
        const retry = { ...achieve, expectedVersion: current.version }
        const duplicate = await Promise.all([send(owner, retry), send(owner, retry)])
        expect(duplicate.map(result => result.status)).toEqual([200, 200])
        expect(await duplicate[0].json()).toEqual(await duplicate[1].json())
        expect((await read(owner)).growth).toMatchObject({ totalXp: 1, actions: 0, achievedGoals: 1 })
      } else {
        expect(current.growth).toMatchObject({ totalXp: 3, actions: 1, achievedGoals: 1 })
        expect((await send(owner, { ...cancel, expectedVersion: current.version })).status).toBe(400)
      }
      const final = await read(owner)
      expect(await (await send(owner, complete)).json()).toEqual(original)
      expect(await read(owner)).toEqual(final)
      expect((await send(owner, { ...complete, command: achieve.command })).status).toBe(409)
    }
  })

  it('相同key并发达成只返回同一成功回执，后续账户变化不重复入账', async () => {
    const owner = crypto.randomUUID()
    const id = (await command(owner, { type: 'createGoal', destination: '', title: '唯一成果', standards: ['标准'] })).result.entityId
    const input = envelope(1, { type: 'achieveGoal', id, coefficient: 3, reflection: '同一确认' })
    const responses = await Promise.all([send(owner, input), send(owner, input)])
    expect(responses.map(result => result.status)).toEqual([200, 200])
    const receipt = await responses[0].json()
    expect(await responses[1].json()).toEqual(receipt)
    await createTask(owner, '达成后的其他操作')
    const current = await read(owner)
    expect(current.growth).toMatchObject({ totalXp: 1, actions: 0, achievedGoals: 1 })
    expect(await (await send(owner, input)).json()).toEqual(receipt)
    expect(await read(owner)).toEqual(current)
    expect((await send(owner, { ...input, command: { ...input.command, type: 'achieveGoal', id, coefficient: 1, reflection: '' } })).status).toBe(409)
  })

})
