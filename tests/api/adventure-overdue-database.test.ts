import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const database = planningDatabase('overdue@example.invalid')
const { read, command, envelope, send } = database

describe.skipIf(!localPlanningRpc)('逾期行动经 Worker 和真实数据库完成与撤销', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  it('今天直接完成逾期任务并保留原计划，撤销后仍为逾期待完成', async () => {
    const owner = crypto.randomUUID()
    const task = (await database.createHistoricalTask(owner, { type: 'createTask', title: '补做行动', description: '保留原安排', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=past')
    expect(before.tasks[0]).toMatchObject({ id: task, plannedOn: '2020-01-01', overdue: true, capabilities: { complete: { allowed: true } } })
    const finish = envelope(before.version, { type: 'completeTask', id: task })
    const response = await send(owner, finish)
    expect(response.status).toBe(200)
    const receipt = await response.json()
    const done = await read(owner)
    expect(done.tasks.find(item => item.id === task)).toMatchObject({ plannedOn: '2020-01-01', completedOn: done.today, status: 'completed', completionOrigin: { plannedOn: '2020-01-01', occurredOn: done.today }, reward: { amount: 1 } })
    expect(done.growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect(await (await send(owner, finish)).json()).toEqual(receipt)
    const completion = done.tasks.find(item => item.id === task)!.completionId!
    await command(owner, { type: 'cancelTaskCompletion', completionId: completion })
    const canceled = await read(owner, '?taskRange=past')
    expect(canceled.tasks.find(item => item.id === task)).toMatchObject({ plannedOn: '2020-01-01', completedOn: null, status: 'pending', overdue: true, reward: null })
    expect(canceled.growth).toMatchObject({ totalXp: 0, actions: 0 })
    expect(await (await send(owner, finish)).json()).toEqual(receipt)
    expect(await read(owner, '?taskRange=past')).toEqual(canceled)
  })
  it('未来和其他账户不能完成，竞争逾期完成只计奖一次，目标详情保留服务端日期', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const goal = (await command(owner, { type: 'createGoal', title: '补做成果', standards: ['完成标准'], destination: '' })).result.entityId
    const overdue = (await database.createHistoricalTask(owner, { type: 'createTask', title: '逾期目标行动', description: '', plannedOn: '2020-01-01', destination: goal })).result.entityId
    const future = (await command(owner, { type: 'createTask', title: '未来行动', description: '', plannedOn: '2099-01-01', destination: '' })).result.entityId
    const before = await read(owner)
    expect((await send(owner, envelope(before.version, { type: 'completeTask', id: future }))).status).toBe(400)
    expect((await send(other, envelope(0, { type: 'completeTask', id: overdue }))).status).toBe(404)
    expect(await read(owner)).toEqual(before)
    const finishes = [envelope(before.version, { type: 'completeTask', id: overdue }), envelope(before.version, { type: 'completeTask', id: overdue })]
    const responses = await Promise.all(finishes.map(value => send(owner, value)))
    expect(responses.map(value => value.status).sort()).toEqual([200, 409])
    const after = await read(owner, `?goalId=${goal}`)
    expect(after.goalDetail!.tasks[0]).toMatchObject({ id: overdue, plannedOn: '2020-01-01', completedOn: after.today, completionOrigin: { occurredOn: after.today, plannedOn: '2020-01-01' } })
    expect(after.growth).toMatchObject({ totalXp: 1, actions: 1 })
    const winner = responses.findIndex(value => value.status === 200)
    const receipt = await responses[winner].json()
    expect(await (await send(owner, finishes[winner])).json()).toEqual(receipt)
    await command(owner, { type: 'achieveGoal', id: goal, coefficient: 1, reflection: '' })
    const locked = await read(owner)
    expect((await send(owner, envelope(locked.version, { type: 'cancelTaskCompletion', completionId: after.goalDetail!.tasks[0].completionId! }))).status).toBe(400)
    expect(await read(owner)).toEqual(locked)
  })
})
