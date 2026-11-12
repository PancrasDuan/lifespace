import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { growthPageSchema, rewardSourceSchema } from '../../src/shared/adventure-growth'
import { planningPreviewSchema, planningReceiptSchema, taskHistorySchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc as rpcOrigin, planningDatabase } from '../support/planning-database'

const database = planningDatabase('lifecycle@example.invalid')
const { request, readFourTable: read, envelope, send, commandFourTable: command } = database
describe.skipIf(!rpcOrigin)('正式 Worker HTTP → 本机真实 PostgREST → 独立 PostgreSQL 跨功能集成', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  let owner: string
  beforeEach(() => { owner = crypto.randomUUID() })

  it('统一编辑日期后完成、改目标标签并达成：按发生时归属计奖，终态锁定和来源一致', async () => {
    const original = (await database.fixtureGoal(owner, 0, { type: 'createGoal', title: '原成果', standards: ['原标准'], categoryLabel: '原分类' })).result.entityId
    const recipient = (await database.fixtureGoal(owner, 1, { type: 'createGoal', title: '接收目标', standards: ['标准'] })).result.entityId
    const task = (await database.createHistoricalTaskFourTable(owner, { type: 'createTask', title: '联动行动', description: '冻结说明', plannedOn: '2020-01-01', destination: original })).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '联动行动', description: '冻结说明', plannedOn: (await read(owner)).today, destination: original })
    const doneEnvelope = envelope((await read(owner)).version, { type: 'completeTask', id: task })
    const completed = planningReceiptSchema.parse(await (await send(owner, doneEnvelope)).json())
    await database.fixtureGoal(owner, (await read(owner)).version, { type: 'editGoal', id: original, title: '原成果', standards: ['原标准'], categoryLabel: '新分类' })
    let page = await read(owner)
    expect(page.goals.find(g => g.id === original)?.progress).toMatchObject({ completed: 1, total: 1 })
    expect(page.goals.find(g => g.id === recipient)?.progress).toMatchObject({ completed: 0, total: 0 })
    const before = page
    const preview = await request(owner, '/api/adventure/preview', { expectedVersion: page.version, command: { type: 'achieveGoal', id: original, coefficient: 3 } })
    expect(preview.status).toBe(200)
    const value = planningPreviewSchema.parse(await preview.json())
    expect('rewards' in value && value.rewards[2]).toMatchObject({ amount: 3, calculation: { count: 1, coefficient: 3 } })
    expect(await read(owner)).toEqual(before)
    const achieved = await command(owner, { type: 'achieveGoal', id: original, coefficient: 3, reflection: '跨功能成果' })
    page = await read(owner)
    expect(page.tasks.find(t => t.id === task)).toMatchObject({ id: task, goalId: original, status: 'completed', capabilities: { cancel: { allowed: false } }, completionOrigin: { goalId: original, categoryLabel: '原分类' } })
    expect((await send(owner, envelope(page.version, { type: 'cancelTaskCompletion', completionId: completed.result.completionId! }))).status).toBe(400)
    expect(await (await send(owner, doneEnvelope)).json()).toEqual(completed)
    expect((await read(owner)).goals.map(goal => goal.id)).toEqual([recipient])
    const detail = await read(owner, `?goalId=${original}`)
    expect(detail.goalDetail?.goal).toMatchObject({ status: 'achieved', title: '原成果' })
    expect(detail.goalDetail?.tasks).toHaveLength(1)
    const growth = growthPageSchema.parse(await (await request(owner, '/api/adventure/growth')).json())
    expect(growth).toMatchObject({ total: 2, growth: { totalXp: 4, actions: 1, achievedGoals: 1 } })
    const reward = rewardSourceSchema.parse(await (await request(owner, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)).json())
    expect(reward).toMatchObject({ event: { categoryLabel: '新分类', amount: 3 }, actionSources: [{ taskId: task, completionId: completed.result.completionId, categoryLabel: '原分类', goalId: original, title: '联动行动' }] })
    expect((await request(crypto.randomUUID(), `/api/adventure/reward-source?id=${achieved.result.achievementId}`)).status).toBe(404)
  })

  it('已停用迁移与聚焦命令并发时均拒绝且不改变账户', async () => {
    const incoming = (await database.fixtureGoal(owner, 0, { type: 'createGoal', title: '目标', standards: ['标准'] })).result.entityId
    const before = await read(owner)
    const inputs = [envelope(before.version, { type: 'migrateGoal', id: incoming, destination: '' }), envelope(before.version, { type: 'focusGoal', id: incoming, focused: true })]
    const responses = await Promise.all(inputs.map(value => send(owner, value)))
    expect(responses.map(r => r.status)).toEqual([400, 400])
    expect(await read(owner)).toEqual(before)
  })

  it('未来任务编辑日期归属后可删除，先转移未完成任务再结束目标且历史安排保留', async () => {
    const today = (await read(owner)).today
    const task = (await command(owner, { type: 'createTask', title: '未来行动', description: '', plannedOn: '2099-01-01', destination: '' })).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '未来行动', description: '', plannedOn: '2099-01-02', destination: '' })
    const goal = (await database.fixtureGoal(owner, (await read(owner)).version, { type: 'createGoal', title: '接收安排', standards: ['标准'] })).result.entityId
    await command(owner, { type: 'editTask', id: task, title: '未来行动', description: '', plannedOn: '2099-01-02', destination: goal })
    const before = await read(owner, '?taskRange=future')
    expect(before.tasks[0]).toMatchObject({ id: task, plannedOn: '2099-01-02', capabilities: { delete: { allowed: true } }, arrangements: [{ newPlannedOn: '2099-01-01' }, { oldPlannedOn: '2099-01-01', newPlannedOn: '2099-01-02' }] })
    const history = taskHistorySchema.parse(await (await request(owner, `/api/adventure/task-history?id=${task}`)).json())
    const blocked = await send(owner, envelope(before.version, { type: 'endGoal', id: goal }))
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toMatchObject({ error: { code: 'PENDING_TASKS' } })
    expect(await read(owner, '?taskRange=future')).toEqual(before)
    await command(owner, { type: 'editTask', id: task, title: '未来行动', description: '', plannedOn: '2099-01-02', destination: '' })
    await command(owner, { type: 'endGoal', id: goal })
    const after = await read(owner, `?taskRange=future&goalId=${goal}`)
    expect(after.goalDetail?.goal.progress).toMatchObject({ completed: 0, total: 0 })
    expect(after.goalDetail?.tasks).toEqual([])
    expect(after.tasks[0]).toMatchObject({ id: task, status: 'pending', independent: true })
    expect(after.growth).toMatchObject({ totalXp: 0, actions: 0 })
    expect(after.today).toBe(today)
    const preserved = taskHistorySchema.parse(await (await request(owner, `/api/adventure/task-history?id=${task}`)).json())
    expect(preserved.items).toEqual(history.items)
    await command(owner, { type: 'deleteTask', id: task })
    expect((await read(owner, '?taskRange=future')).tasks).toEqual([])
    expect((await read(owner)).growth).toEqual(after.growth)
  })
})
