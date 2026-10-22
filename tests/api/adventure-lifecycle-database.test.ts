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

describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 生命周期事务', () => {
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

  it('结束目标前预览影响，确认后停止待办并保留完成记录与经验', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '阶段成果', standards: ['达到结果'] })).result.entityId
    const today = (await read(owner)).today
    const completed = (await command(owner, { type: 'createTask', title: '已经完成', description: '', plannedOn: today, destination: goal })).result.entityId
    await command(owner, { type: 'completeTask', id: completed })
    const pending = (await command(owner, { type: 'createTask', title: '将会停止', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await read(owner)

    const previewResponse = await request(owner, '/api/adventure/preview', {
      expectedVersion: before.version,
      command: { type: 'endGoal', id: goal } as PlanningCommand,
    })
    expect(previewResponse.status).toBe(200)
    const preview = planningPreviewSchema.parse(await previewResponse.json())
    expect(preview).toMatchObject({
      operation: 'endGoal', entityId: goal, requiresConfirmation: true,
      stoppingTasks: [{ id: pending, title: '将会停止', plannedOn: today }],
      preservedCompletedTasks: 1,
    })
    expect(await read(owner)).toEqual(before)

    const end = envelope(before.version, { type: 'endGoal', id: goal } as PlanningCommand)
    const endedResponse = await send(owner, end)
    expect(endedResponse.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await endedResponse.json())
    expect(await (await send(owner, end)).json()).toEqual(receipt)

    const after = await read(owner, '?includeTerminal=true&goalId=' + goal)
    expect(after.goals.find(item => item.id === goal)).toMatchObject({ status: 'ended', focused: false, terminatedAt: expect.any(String) })
    expect(after.tasks.find(item => item.id === completed)).toMatchObject({ status: 'completed', reward: { amount: 1 } })
    expect(after.tasks.find(item => item.id === pending)).toMatchObject({ status: 'ended' })
    expect(after.growth).toMatchObject({ totalXp: before.growth.totalXp, actions: before.growth.actions })
    expect((await read(owner)).goals.some(item => item.id === goal)).toBe(false)
  })

  it('结束目标立即释放聚焦并锁定取消，结束事件不可重复', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '结束锁定', standards: ['标准'] })).result.entityId
    await command(owner, { type: 'focusGoal', id: goal, focused: true })
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '今天完成', description: '', plannedOn: today, destination: goal })).result.entityId
    const completion = await command(owner, { type: 'completeTask', id: task })
    const before = await read(owner)
    const end = envelope(before.version, { type: 'endGoal', id: goal } as PlanningCommand)
    expect((await send(owner, end)).status).toBe(200)
    const ended = await read(owner, '?includeTerminal=true&goalId=' + goal)
    expect(ended.goals.find(item => item.id === goal)).toMatchObject({ status: 'ended', focused: false })
    expect(ended.goalDetail!.goal.capabilities.end.allowed).toBe(false)
    expect((await send(owner, envelope(ended.version, { type: 'endGoal', id: goal } as PlanningCommand))).status).toBe(400)
    const cancel = await send(owner, envelope(ended.version, { type: 'cancelTaskCompletion', completionId: completion.result.completionId! }))
    expect(cancel.status).toBe(400)
    expect(await cancel.json()).toMatchObject({ error: { code: 'READ_ONLY' } })
    expect(await read(owner, '?includeTerminal=true&goalId=' + goal)).toMatchObject({ version: ended.version, growth: { totalXp: 1, actions: 1 } })
  })

  it('结束主线只结束进行中目标，保留达成结果并释放在用名额', async () => {
    const main = (await command(owner, { type: 'createMainline', name: '将结束主线' })).result.entityId
    const active = (await command(owner, { type: 'createGoal', destination: main, title: '进行中目标', standards: ['标准'] })).result.entityId
    const achieved = (await command(owner, { type: 'createGoal', destination: main, title: '已达成目标', standards: ['标准'] })).result.entityId
    await command(owner, { type: 'achieveGoal', id: achieved, coefficient: 1, reflection: '' })
    await command(owner, { type: 'focusGoal', id: active, focused: true })
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '主线待办', description: '', plannedOn: today, destination: active })).result.entityId
    const before = await read(owner)
    const preview = planningPreviewSchema.parse(await (await request(owner, '/api/adventure/preview', {
      expectedVersion: before.version, command: { type: 'endMainline', id: main } as PlanningCommand,
    })).json())
    expect(preview).toMatchObject({
      operation: 'endMainline', entityId: main, requiresConfirmation: true,
      stoppingGoals: [{ id: active, title: '进行中目标' }],
      stoppingTasks: [{ id: task, title: '主线待办', plannedOn: today }],
      preservedAchievedGoals: 1,
    })
    expect(await read(owner)).toEqual(before)
    const end = envelope(before.version, { type: 'endMainline', id: main } as PlanningCommand)
    const receipt = planningReceiptSchema.parse(await (await send(owner, end)).json())
    expect(await (await send(owner, end)).json()).toEqual(receipt)
    const after = await read(owner, '?includeTerminal=true')
    expect(after.mainlines.find(item => item.id === main)).toMatchObject({ status: 'ended', endedAt: expect.any(String) })
    expect(after.goals.find(item => item.id === achieved)?.mainlineName).toBe('将结束主线')
    expect(after.goals.find(item => item.id === active)).toMatchObject({ status: 'ended', focused: false })
    expect(after.goals.find(item => item.id === achieved)).toMatchObject({ status: 'achieved' })
    expect(after.tasks.find(item => item.id === task)).toMatchObject({ status: 'ended' })
    expect(after.growth).toMatchObject({ totalXp: before.growth.totalXp, achievedGoals: before.growth.achievedGoals })
    expect(after.capabilities.createMainline.allowed).toBe(true)
  })

  it('结束待完成任务立即只读且不回退经验；已完成任务不能改为结束', async () => {
    const today = (await read(owner)).today
    const pending = (await command(owner, { type: 'createTask', title: '待结束任务', description: '', plannedOn: today, destination: '' })).result.entityId
    const done = (await command(owner, { type: 'createTask', title: '已完成任务', description: '', plannedOn: today, destination: '' })).result.entityId
    await command(owner, { type: 'completeTask', id: done })
    const before = await read(owner)
    const taskPreview = planningPreviewSchema.parse(await (await request(owner, '/api/adventure/preview', {
      expectedVersion: before.version, command: { type: 'endTask', id: pending } as PlanningCommand,
    })).json())
    expect(taskPreview).toMatchObject({ operation: 'endTask', entityId: pending, stoppingTasks: [{ id: pending, title: '待结束任务' }] })
    expect(await read(owner)).toEqual(before)
    const end = envelope(before.version, { type: 'endTask', id: pending } as PlanningCommand)
    expect((await send(owner, end)).status).toBe(200)
    const after = await read(owner)
    expect(after.tasks.find(item => item.id === pending)).toMatchObject({ status: 'ended', capabilities: { edit: { allowed: false }, complete: { allowed: false } } })
    expect(after.tasks.find(item => item.id === done)).toMatchObject({ status: 'completed', reward: { amount: 1 } })
    expect(after.growth).toMatchObject({ totalXp: before.growth.totalXp, actions: before.growth.actions })
    expect((await send(owner, envelope(after.version, { type: 'endTask', id: done } as PlanningCommand))).status).toBe(400)
    expect((await send(owner, envelope(after.version, { type: 'endTask', id: pending } as PlanningCommand))).status).toBe(400)
    expect(await read(owner)).toEqual(after)
  })

  it('误建任务仅限未来未开始且无完成历史，删除逻辑隐藏且同请求幂等', async () => {
    const today = Temporal.PlainDate.from((await read(owner)).today)
    const future = today.add({ days: 2 }).toString()
    const accidental = (await command(owner, { type: 'createTask', title: '误建任务', description: '', plannedOn: future, destination: '' })).result.entityId
    const keep = (await command(owner, { type: 'createTask', title: '保留任务', description: '', plannedOn: future, destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=future')
    const preview = planningPreviewSchema.parse(await (await request(owner, '/api/adventure/preview', {
      expectedVersion: before.version, command: { type: 'deleteTask', id: accidental } as PlanningCommand,
    })).json())
    expect(preview).toMatchObject({ operation: 'deleteTask', entityId: accidental })
    expect(preview).toMatchObject({ historicalArrangements: 0, plannedOn: future })
    expect(await read(owner, '?taskRange=future')).toEqual(before)
    const remove = envelope(before.version, { type: 'deleteTask', id: accidental } as PlanningCommand)
    const receipt = planningReceiptSchema.parse(await (await send(owner, remove)).json())
    expect(await (await send(owner, remove)).json()).toEqual(receipt)
    const after = await read(owner, '?taskRange=future')
    expect(after.tasks.map(item => item.id)).toEqual([keep])
    expect(after.version).toBe(before.version + 1)
    expect((await send(owner, envelope(after.version, { type: 'deleteTask', id: accidental } as PlanningCommand))).status).toBe(404)
    expect((await send(owner, envelope(after.version, { type: 'deleteTask', id: keep } as PlanningCommand))).status).toBe(200)
  })

  it('并发结束同一目标仅一个请求提交，另一请求版本冲突且不产生第二终态事件', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '并发结束', standards: ['标准'] })).result.entityId
    const before = await read(owner)
    const requests = [envelope(before.version, { type: 'endGoal', id: goal } as PlanningCommand), envelope(before.version, { type: 'endGoal', id: goal } as PlanningCommand)]
    const responses = await Promise.all(requests.map(value => send(owner, value)))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const winner = responses.findIndex(response => response.status === 200)
    const receipt = planningReceiptSchema.parse(await responses[winner].json())
    expect(await (await send(owner, requests[winner])).json()).toEqual(receipt)
    const after = await read(owner, '?includeTerminal=true&goalId=' + goal)
    expect(after.version).toBe(before.version + 1)
    expect(after.goalDetail!.goal).toMatchObject({ status: 'ended' })
    expect(after.growth).toEqual(before.growth)
  })

  it('历史主线超过五条仍可读取，终态倒序且稳定主线详情独立分页并隔离账户', async () => {
    const ended: string[] = []
    for (let i = 0; i < 6; i++) {
      const main = (await command(owner, { type: 'createMainline', name: `历史主线 ${i}` })).result.entityId
      await command(owner, { type: 'endMainline', id: main })
      ended.push(main)
    }
    const main = (await command(owner, { type: 'createMainline', name: '当前主线' })).result.entityId
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await command(owner, { type: 'createGoal', title: `主线历史 ${i}`, standards: ['标准'], destination: main })).result.entityId)
    await command(owner, { type: 'endGoal', id: ids[0] })
    await command(owner, { type: 'achieveGoal', id: ids[1], coefficient: 1, reflection: '' })
    expect((await read(owner, '?includeTerminal=true')).goals.map(item => item.id)).toEqual([ids[2], ids[1], ids[0]])
    await command(owner, { type: 'endMainline', id: main })
    const visible = await read(owner, '?includeTerminal=true')
    expect(visible.mainlines.map(item => item.id)).toEqual([main, ...[...ended].reverse()])
    expect((await read(owner)).mainlines).toEqual([])
    const detail = await read(owner, `?mainlineId=${main}&pageSize=2`)
    expect(detail.mainlineDetail).toMatchObject({ id: main, status: 'ended' })
    expect(detail.totalGoals).toBe(3)
    expect(detail.goals.map(item => item.id)).toEqual([ids[2], ids[1]])
    expect((await read(owner, `?mainlineId=${main}&pageSize=2&page=2`)).goals.map(item => item.id)).toEqual([ids[0]])
    const response = await request(crypto.randomUUID(), `/api/adventure?mainlineId=${main}`)
    // The real Worker endpoint must not disclose another owner's terminal content.
    expect(response.status).toBe(404)
  })

  it('未来任务仅编辑内容仍可删除，不把普通修改当作历史安排', async () => {
    const today = Temporal.PlainDate.from((await read(owner)).today)
    const first = today.add({ days: 1 }).toString()
    const task = (await command(owner, { type: 'createTask', title: '曾改期任务', description: '', plannedOn: first, destination: '' })).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '曾改期任务', description: '更新说明' })
    const current = await read(owner, '?taskRange=future')
    const response = await send(owner, envelope(current.version, { type: 'deleteTask', id: task } as PlanningCommand))
    expect(response.status).toBe(200)
    expect((await read(owner, '?taskRange=future')).tasks.find(item => item.id === task)).toBeUndefined()
  })

  it('目标结束影响超过二百条任务仍完整返回，不按客户端条数截断', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '全量确认', standards: ['标准'] })).result.entityId
    const today = (await read(owner)).today
    let version = (await read(owner)).version
    for (let i = 0; i < 201; i++) {
      const response = await send(owner, envelope(version, { type: 'createTask', title: `全量待办 ${i}`, description: '', plannedOn: today, destination: goal }))
      expect(response.status).toBe(200)
      version = planningReceiptSchema.parse(await response.json()).version
    }
    const response = await request(owner, '/api/adventure/preview', { expectedVersion: version, command: { type: 'endGoal', id: goal } })
    expect(response.status).toBe(200)
    const preview = planningPreviewSchema.parse(await response.json())
    expect('stoppingTasks' in preview && preview.stoppingTasks.length).toBe(201)
    expect((await read(owner)).version).toBe(version)
  }, 20000)

  it('主线结束与完成竞争同版本只提交一次，迁出完成仍受历史主线锁定', async () => {
    const main = (await command(owner, { type: 'createMainline', name: '历史锁来源' })).result.entityId
    const goal = (await command(owner, { type: 'createGoal', destination: main, title: '当前归属', standards: ['标准'] })).result.entityId
    const today = (await read(owner)).today
    const moved = (await command(owner, { type: 'createTask', title: '迁出完成', description: '', plannedOn: today, destination: goal })).result.entityId
    const finish = envelope((await read(owner)).version, { type: 'completeTask', id: moved })
    const completion = planningReceiptSchema.parse(await (await send(owner, finish)).json())
    await command(owner, { type: 'migrateTask', id: moved, destination: '' })
    const pending = (await command(owner, { type: 'createTask', title: '竞争任务', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await read(owner)
    const end = envelope(before.version, { type: 'endMainline', id: main })
    const complete = envelope(before.version, { type: 'completeTask', id: pending })
    const responses = await Promise.all([send(owner, end), send(owner, complete)])
    expect(responses.map(item => item.status).sort()).toEqual([200, 409])
    if (responses[0].status !== 200) await command(owner, end.command)
    const after = await read(owner)
    expect(after.tasks.find(item => item.id === moved)).toMatchObject({ status: 'completed', independent: true, capabilities: { cancel: { allowed: false }, migrate: { allowed: false } } })
    expect((await send(owner, envelope(after.version, { type: 'cancelTaskCompletion', completionId: completion.result.completionId! }))).status).toBe(400)
    expect(await (await send(owner, finish)).json()).toEqual(completion)
    expect((await read(owner)).version).toBe(after.version)
  })

  it('五条在用主线结束释放名额，独立区和 inbox 禁止结束，生命周期隔离账户', async () => {
    const mains: string[] = []
    for (let i = 0; i < 5; i++) mains.push((await command(owner, { type: 'createMainline', name: `名额 ${i}` })).result.entityId)
    expect((await read(owner)).capabilities.createMainline.allowed).toBe(false)
    await command(owner, { type: 'endMainline', id: mains[0] })
    await command(owner, { type: 'createMainline', name: '释放后创建' })
    const goal = (await command(owner, { type: 'createGoal', title: '独立结构', standards: ['标准'], destination: '' })).result.entityId
    const independentId = (await read(owner)).goals.find(item => item.id === goal)!.mainlineId
    const future = Temporal.PlainDate.from((await read(owner)).today).add({ days: 1 }).toString()
    const task = (await command(owner, { type: 'createTask', title: '其他账户不可动', description: '', plannedOn: future, destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=future')
    const other = crypto.randomUUID()
    for (const input of [
      { type: 'endMainline', id: mains[1] }, { type: 'endGoal', id: goal }, { type: 'endTask', id: task }, { type: 'deleteTask', id: task },
    ] as PlanningCommand[]) {
      expect((await send(other, envelope(0, input))).status).toBe(404)
      expect((await request(other, '/api/adventure/preview', { expectedVersion: 0, command: input })).status).toBe(404)
    }
    expect((await send(owner, envelope(before.version, { type: 'endMainline', id: independentId }))).status).toBe(404)
    expect(await read(owner, '?taskRange=future')).toEqual(before)
  })

  it('今天、曾完成和已结束任务均不能删除；目标结束后未来待办仍不可删除', async () => {
    const today = Temporal.PlainDate.from((await read(owner)).today)
    const todayTask = (await command(owner, { type: 'createTask', title: '今天任务', description: '', plannedOn: today.toString(), destination: '' })).result.entityId
    const future = today.add({ days: 1 }).toString()
    const onceDone = (await command(owner, { type: 'createTask', title: '曾完成', description: '', plannedOn: today.toString(), destination: '' })).result.entityId
    await command(owner, { type: 'completeTask', id: onceDone })
    await command(owner, { type: 'cancelTaskCompletion', completionId: (await read(owner)).tasks.find(item => item.id === onceDone)!.completionId! })
    const ended = (await command(owner, { type: 'createTask', title: '已结束', description: '', plannedOn: future, destination: '' })).result.entityId
    await command(owner, { type: 'endTask', id: ended })
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '结束目标', standards: ['标准'] })).result.entityId
    const child = (await command(owner, { type: 'createTask', title: '目标未来待办', description: '', plannedOn: future, destination: goal })).result.entityId
    await command(owner, { type: 'endGoal', id: goal })
    const current = await read(owner, `?taskRange=future&includeTerminal=true&goalId=${goal}`)
    for (const id of [todayTask, onceDone, ended, child]) {
      const response = await send(owner, envelope(current.version, { type: 'deleteTask', id } as PlanningCommand))
      expect(response.status, id).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: expect.stringMatching(/READ_ONLY|TASK_NOT_PENDING|HISTORY_LOCKED|DATE_STARTED/) } })
    }
    expect((await read(owner, `?taskRange=future&includeTerminal=true&goalId=${goal}`)).version).toBe(current.version)
  })
})
