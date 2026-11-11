import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Temporal } from '@js-temporal/polyfill'
import { planningPreviewSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'
import { localPlanningRpc as rpcOrigin, planningDatabase } from '../support/planning-database'

const database = planningDatabase('lifecycle@example.invalid')
const { request, readFourTable: read, envelope, send } = database
const command = async (owner: string, value: PlanningCommand | { type: 'createGoal'; destination: ''; title: string; standards: string[] }) => {
  if (value.type === 'createGoal') {
    if ('destination' in value && value.destination !== '') throw new Error('旧主线归属不再可用于目标准备')
    return database.fixtureGoal(owner, (await read(owner)).version, { type: 'createGoal', title: value.title, standards: value.standards })
  }
  return database.commandFourTable(owner, value)
}
describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 生命周期事务', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  let owner: string
  beforeEach(() => { owner = crypto.randomUUID() })

  it('其他账户不能结束目标或删除独立任务', async () => {
    const goal = (await command(owner, { type: 'createGoal', title: '账户目标', standards: ['标准'], destination: '' })).result.entityId
    const task = (await command(owner, { type: 'createTask', title: '账户任务', description: '', plannedOn: (await read(owner)).today, destination: '' })).result.entityId
    const before = await read(owner)
    const other = crypto.randomUUID()
    for (const input of [{ type: 'endGoal', id: goal }, { type: 'deleteTask', id: task }] as PlanningCommand[]) {
      expect((await send(other, envelope(0, input))).status).toBe(404)
      expect((await request(other, '/api/adventure/preview', { expectedVersion: 0, command: input })).status).toBe(404)
    }
    expect(await read(owner)).toEqual(before)
  })

  it('处理待办后结束目标，保留完成记录与经验', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '阶段成果', standards: ['达到结果'] })).result.entityId
    const today = (await read(owner)).today
    const completed = (await command(owner, { type: 'createTask', title: '已经完成', description: '', plannedOn: today, destination: goal })).result.entityId
    await command(owner, { type: 'completeTask', id: completed })
    const pending = (await command(owner, { type: 'createTask', title: '将会停止', description: '', plannedOn: today, destination: goal })).result.entityId
    await command(owner, { type: 'deleteTask', id: pending })
    const before = await read(owner)

    const previewResponse = await request(owner, '/api/adventure/preview', {
      expectedVersion: before.version,
      command: { type: 'endGoal', id: goal } as PlanningCommand,
    })
    expect(previewResponse.status).toBe(200)
    const preview = planningPreviewSchema.parse(await previewResponse.json())
    expect(preview).toMatchObject({
      operation: 'endGoal', entityId: goal, requiresConfirmation: true,
      stoppingTasks: [],
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
    expect(after.tasks.find(item => item.id === pending)).toBeUndefined()
    expect(after.growth).toMatchObject({ totalXp: before.growth.totalXp, actions: before.growth.actions })
    expect((await read(owner)).goals.some(item => item.id === goal)).toBe(false)
  })

  it('结束目标立即释放聚焦并锁定取消，结束事件不可重复', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '结束锁定', standards: ['标准'] })).result.entityId
    await database.fixtureFocused(owner, goal)
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

  it('已撤除结束任务的新命令与预览，失败不改变任务或奖励', async () => {
    const today = (await read(owner)).today
    const pending = (await command(owner, { type: 'createTask', title: '待处理任务', description: '', plannedOn: today, destination: '' })).result.entityId
    const before = await read(owner)
    expect(before.tasks[0].capabilities.end.allowed).toBe(false)
    const value = { type: 'endTask' as const, id: pending }
    expect((await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: value })).status).toBe(400)
    expect((await send(owner, envelope(before.version, value))).status).toBe(400)
    expect(await read(owner)).toEqual(before)
  })

  it('未来未完成任务删除逻辑隐藏且同请求幂等', async () => {
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

  it('目标终态倒序且分页稳定，默认只显示进行中目标', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await command(owner, { type: 'createGoal', title: `终态 ${i}`, standards: ['标准'], destination: '' })).result.entityId)
    await command(owner, { type: 'endGoal', id: ids[0] })
    await command(owner, { type: 'achieveGoal', id: ids[1], coefficient: 1, reflection: '' })
    expect((await read(owner, '?includeTerminal=true')).goals.map(item => item.id)).toEqual([ids[2], ids[1], ids[0]])
    expect((await read(owner, '?includeTerminal=true&pageSize=2&page=1')).goals.map(item => item.id)).toEqual([ids[2], ids[1]])
    expect((await read(owner, '?includeTerminal=true&pageSize=2&page=2')).goals.map(item => item.id)).toEqual([ids[0]])
    expect((await read(owner)).goals.map(item => item.id)).toEqual([ids[2]])
  })

  it('结束目标与待完成任务竞争时只完成任务，随后终态锁定旧完成', async () => {
    const goal = (await command(owner, { type: 'createGoal', title: '历史锁来源', standards: ['标准'], destination: '' })).result.entityId
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '竞争任务', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await read(owner)
    const finish = envelope(before.version, { type: 'completeTask', id: task })
    const [ending, completion] = await Promise.all([send(owner, envelope(before.version, { type: 'endGoal', id: goal })), send(owner, finish)])
    expect(completion.status).toBe(200)
    expect([400, 409]).toContain(ending.status)
    const receipt = planningReceiptSchema.parse(await completion.json())
    await command(owner, { type: 'endGoal', id: goal })
    const after = await read(owner)
    expect(after.tasks.find(item => item.id === task)).toMatchObject({ status: 'completed', capabilities: { cancel: { allowed: false } } })
    expect((await send(owner, envelope(after.version, { type: 'cancelTaskCompletion', completionId: receipt.result.completionId! }))).status).toBe(400)
    expect(await (await send(owner, finish)).json()).toEqual(receipt)
    expect((await read(owner)).version).toBe(after.version)
  })

  it('未来任务仅编辑内容仍可删除，不把普通修改当作历史安排', async () => {
    const today = Temporal.PlainDate.from((await read(owner)).today)
    const first = today.add({ days: 1 }).toString()
    const task = (await command(owner, { type: 'createTask', title: '曾改期任务', description: '', plannedOn: first, destination: '' })).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '曾改期任务', description: '更新说明', plannedOn: first, destination: '' })
    const current = await read(owner, '?taskRange=future')
    const response = await send(owner, envelope(current.version, { type: 'deleteTask', id: task } as PlanningCommand))
    expect(response.status).toBe(200)
    expect((await read(owner, '?taskRange=future')).tasks.find(item => item.id === task)).toBeUndefined()
  })

  it('超过二百条待办的目标同样阻断终态，不按客户端页判断', async () => {
    const goal = (await command(owner, { type: 'createGoal', destination: '', title: '全量确认', standards: ['标准'] })).result.entityId
    const today = (await read(owner)).today
    let version = (await read(owner)).version
    for (let i = 0; i < 201; i++) {
      const response = await send(owner, envelope(version, { type: 'createTask', title: `全量待办 ${i}`, description: '', plannedOn: today, destination: goal }))
      expect(response.status).toBe(200)
      version = planningReceiptSchema.parse(await response.json()).version
    }
    const response = await request(owner, '/api/adventure/preview', { expectedVersion: version, command: { type: 'endGoal', id: goal } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'PENDING_TASKS' } })
    expect((await read(owner)).version).toBe(version)
  }, 20000)

  it('今天任务和撤销完成后的任务可删除，已完成任务仍受保护', async () => {
    const today = (await read(owner)).today
    const todayTask = (await command(owner, { type: 'createTask', title: '今天任务', description: '', plannedOn: today, destination: '' })).result.entityId
    const onceDone = (await command(owner, { type: 'createTask', title: '曾完成', description: '', plannedOn: today, destination: '' })).result.entityId
    const completion = await command(owner, { type: 'completeTask', id: onceDone })
    const doneState = await read(owner)
    expect((await send(owner, envelope(doneState.version, { type: 'deleteTask', id: onceDone }))).status).toBe(400)
    await command(owner, { type: 'cancelTaskCompletion', completionId: completion.result.completionId! })
    for (const id of [todayTask, onceDone]) await command(owner, { type: 'deleteTask', id })
    const after = await read(owner)
    expect(after.tasks).toHaveLength(0)
    expect(after.growth.totalXp).toBe(0)
  })
})
