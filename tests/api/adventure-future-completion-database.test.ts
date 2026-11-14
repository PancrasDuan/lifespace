import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Temporal } from '@js-temporal/polyfill'
import { planningReceiptSchema, taskListSchema } from '../../src/shared/adventure-planning'
import { growthPageSchema, rewardSourceSchema } from '../../src/shared/adventure-growth'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const database = planningDatabase('future-completion@example.invalid')
const { read, command, send, envelope, request } = database
const list = async (owner: string, date: string) => {
  const workspace = await read(owner)
  const response = await request(owner, '/api/adventure/tasks/list', { date, scope: 'all', expectedVersion: workspace.version, today: workspace.today })
  expect(response.status).toBe(200)
  return taskListSchema.parse(await response.json())
}

describe.skipIf(!localPlanningRpc)('未来任务按实际完成日入账及查询', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  it('提前完成移入今日、即时统计、直接取消回原计划日，再完成仅保留一份奖励', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const future = Temporal.PlainDate.from(today).add({ days: 7 }).toString()
    const goal = (await command(owner, { type: 'createGoal', title: '提前实现的目标', standards: ['实际行动完成'], categoryLabel: '日期回归' })).result.entityId
    const id = (await command(owner, { type: 'createTask', title: '提前行动', description: '保留未来计划', plannedOn: future, destination: goal })).result.entityId
    expect((await list(owner, future)).tasks[0].capabilities.complete.allowed).toBe(true)
    expect((await list(owner, today)).progress).toEqual({ completed: 0, total: 0, ratio: null })
    const finish = envelope((await read(owner)).version, { type: 'completeTask', id })
    const response = await send(owner, finish)
    expect(response.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await response.json())
    const completionId = receipt.result.completionId!
    const done = await read(owner, `?goalId=${goal}`)
    expect(done.tasks[0]).toMatchObject({ id, plannedOn: future, completedOn: today, status: 'completed', completionOrigin: { plannedOn: future, occurredOn: today, categoryLabel: '日期回归' }, capabilities: { cancel: { allowed: true }, edit: { allowed: false } } })
    expect(done.growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect(done.todayTaskProgress).toEqual({ completed: 1, total: 1, ratio: 1 })
    expect(done.goalDetail!.goal.progress).toEqual({ completed: 1, total: 1, ratio: 1 })
    expect(done.goalDetail!.relatedTasks[0]).toMatchObject({ id, plannedOn: future })
    expect(Temporal.Instant.from(done.goalDetail!.relatedTasks[0].completedAt!).toZonedDateTimeISO('Asia/Shanghai').toPlainDate().toString()).toBe(today)
    expect((await list(owner, today)).progress).toEqual({ completed: 1, total: 1, ratio: 1 })
    expect((await list(owner, future)).tasks).toEqual([])
    const growthResponse = await request(owner, '/api/adventure/growth')
    expect(growthResponse.status).toBe(200)
    const growth = growthPageSchema.parse(await growthResponse.json())
    expect(growth.items[0]).toMatchObject({ id: completionId, occurredOn: today, amount: 1 })
    expect(Temporal.Instant.from(growth.items[0].occurredAt).toZonedDateTimeISO('Asia/Shanghai').toPlainDate().toString()).toBe(today)
    const sourceResponse = await request(owner, `/api/adventure/reward-source?id=${completionId}`)
    expect(sourceResponse.status).toBe(200)
    expect(rewardSourceSchema.parse(await sourceResponse.json())).toMatchObject({ plannedOn: future, event: { occurredOn: today } })
    const cancel = envelope(done.version, { type: 'cancelTaskCompletion', completionId })
    const cancelResponse = await send(owner, cancel)
    expect(cancelResponse.status).toBe(200)
    const canceledReceipt = planningReceiptSchema.parse(await cancelResponse.json())
    expect(canceledReceipt.result.growthChange).toMatchObject({ xpDelta: -1, after: { totalXp: 0, actions: 0 } })
    expect((await list(owner, today)).tasks).toEqual([])
    expect((await list(owner, future)).tasks[0]).toMatchObject({ id, plannedOn: future, completedOn: null, status: 'pending', reward: null })
    expect((await read(owner, `?goalId=${goal}`)).goalDetail!.goal.progress).toEqual({ completed: 0, total: 1, ratio: 0 })
    const redo = await command(owner, { type: 'completeTask', id })
    expect(redo.result.completionId).not.toBe(completionId)
    expect(await (await send(owner, finish)).json()).toEqual(receipt)
    expect(await (await send(owner, cancel)).json()).toEqual(canceledReceipt)
    expect((await send(owner, envelope(redo.version, cancel.command))).status).toBe(409)
    expect((await read(owner)).growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect((await list(owner, today)).tasks).toHaveLength(1)
  })

  it('未来完成并发、同封套重试、账户隔离及目标终态继续生效', async () => {
    const owner = crypto.randomUUID()
    const goal = (await command(owner, { type: 'createGoal', title: '提前达成', standards: ['完成行动'] })).result.entityId
    const id = (await command(owner, { type: 'createTask', title: '并发提前行动', description: '', plannedOn: '2099-01-01', destination: goal })).result.entityId
    const before = await read(owner)
    expect((await send(crypto.randomUUID(), envelope(0, { type: 'completeTask', id }))).status).toBe(404)
    const finish = envelope(before.version, { type: 'completeTask', id })
    const responses = await Promise.all([send(owner, finish), send(owner, finish)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(await responses[0].json()).toEqual(await responses[1].json())
    expect((await send(owner, envelope(before.version, finish.command))).status).toBe(409)
    const done = await read(owner)
    expect(done.growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect((await send(owner, envelope(done.version, { type: 'editTask', id, title: '不能改期', description: '', plannedOn: done.today, destination: goal }))).status).toBe(400)
    await command(owner, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '' })
    const terminal = await read(owner)
    expect(terminal.tasks[0].capabilities.cancel.allowed).toBe(false)
    expect((await send(owner, envelope(terminal.version, { type: 'cancelTaskCompletion', completionId: done.tasks[0].completionId! }))).status).toBe(400)
    expect(await read(owner)).toEqual(terminal)
    expect(terminal.growth).toMatchObject({ totalXp: 3, actions: 1, achievedGoals: 1 })
  })

  it('原计划日到来时不重复计入今日任务与页面汇总，成长仍只计一次', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const id = (await command(owner, { type: 'createTask', title: '昨天提前完成今天的计划', description: '', plannedOn: today, destination: '' })).result.entityId
    const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString()
    await database.historicalCommand(owner, envelope((await read(owner)).version, { type: 'completeTask', id }), yesterday)
    const workspace = await read(owner)
    expect(workspace.tasks).toEqual([])
    expect(workspace.taskProgress).toEqual({ completed: 0, total: 0, ratio: null })
    expect(workspace.todayTaskProgress).toEqual({ completed: 0, total: 0, ratio: null })
    expect(workspace.growth).toMatchObject({ totalXp: 1, actions: 1 })
    expect((await list(owner, today)).tasks).toEqual([])
    expect((await list(owner, yesterday)).tasks[0]).toMatchObject({ id, plannedOn: today, completedOn: yesterday })
  })

  it('提前完成跨日后冻结，即使计划仍在未来，原成功封套仍只重放', async () => {
    const owner = crypto.randomUUID()
    const id = (await command(owner, { type: 'createTask', title: '昨天提前完成', description: '', plannedOn: '2099-01-01', destination: '' })).result.entityId
    const today = (await read(owner)).today
    const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString()
    const finish = envelope((await read(owner)).version, { type: 'completeTask', id })
    const receipt = await database.historicalCommand(owner, finish, yesterday)
    expect((await list(owner, today)).tasks).toEqual([])
    expect((await list(owner, '2099-01-01')).tasks).toEqual([])
    const past = await list(owner, yesterday)
    expect(past.tasks[0]).toMatchObject({ id, plannedOn: '2099-01-01', completedOn: yesterday, capabilities: { cancel: { allowed: false, reason: '仅能取消实际完成日为今天的完成记录' } } })
    const before = await read(owner)
    const cancellation = await send(owner, envelope(before.version, { type: 'cancelTaskCompletion', completionId: receipt.result.completionId! }))
    expect(cancellation.status).toBe(400)
    expect(await cancellation.json()).toMatchObject({ error: { code: 'DATE_LOCKED', message: '仅能取消实际完成日为今天的完成记录' } })
    expect(await (await send(owner, finish)).json()).toEqual(receipt)
    expect(await read(owner)).toEqual(before)
    expect(before.growth).toMatchObject({ totalXp: 1, actions: 1 })
  })
})
