import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'

const db = planningDatabase()
describe.skipIf(!localPlanningRpc)('目标控制台真实数据库 HTTP', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('任务迁移候选可查询，目标候选退役且账户隔离', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const goal = await db.command(owner, { type: 'createGoal', title: '目标', standards: ['标准'] })
    const taskResponse = await db.request(owner, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: goal.version,
      command: { type: 'createTask', title: '任务', description: '', plannedOn: '2099-01-01', destination: '' } })
    expect(taskResponse.status).toBe(200)
    const task = planningReceiptSchema.parse(await taskResponse.json()).result.entityId
    const candidates = await db.request(owner, `/api/adventure/migration-options?kind=task&id=${task}`)
    expect(candidates.status).toBe(200)
    expect(await candidates.json()).toMatchObject({ kind: 'task', entityId: task, total: 2, options: [{ id: '' }, { id: goal.result.entityId, name: '目标' }] })
    expect((await db.request(other, `/api/adventure/migration-options?kind=task&id=${task}`)).status).toBe(404)
    expect((await db.request(owner, `/api/adventure/migration-options?kind=goal&id=${goal.result.entityId}`)).status).toBe(400)
  })
  it('真实 workspace 读取含任务目标，编辑标签后保留目标和任务身份', async () => {
    const owner = crypto.randomUUID()
    const goal = (await db.command(owner, { type: 'createGoal', title: '联合目标', standards: ['标准'], categoryLabel: '学习' })).result.entityId
    const today = (await db.read(owner)).today
    const task = (await db.command(owner, { type: 'createTask', title: '关联任务', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await db.read(owner, `?goalId=${goal}`)
    expect(before.goalDetail).toMatchObject({ goal: { id: goal, progress: { completed: 0, total: 1 } }, tasks: [{ id: task, goalId: goal }] })
    await db.command(owner, { type: 'editGoal', id: goal, title: '联合目标改名', standards: ['新标准'], categoryLabel: '生活' })
    const after = await db.read(owner, `?goalId=${goal}`)
    expect(after.goalDetail).toMatchObject({ goal: { id: goal, categoryLabel: '生活', progress: { total: 1 } }, tasks: [{ id: task, goalId: goal }] })
  })
  it('标签、全局排序、分页、版本与账户隔离', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const a = (await db.command(owner, { type: 'createGoal', title: '甲', standards: ['完成'], categoryLabel: ' 学习 ' })).result.entityId
    const b = (await db.command(owner, { type: 'createGoal', title: '乙', standards: ['完成'], categoryLabel: '学习' })).result.entityId
    await db.command(owner, { type: 'editGoal', id: a, title: '甲更新', standards: ['完成'], categoryLabel: '健康' })
    const before = await db.read(owner)
    expect(before.goals.map(g => [g.title, g.categoryLabel])).toEqual([['甲更新', '健康'], ['乙', '学习']])
    const stale = db.envelope(before.version, { type: 'reorderGoals', id: b, direction: 'up' })
    await db.command(owner, { type: 'reorderGoals', id: b, direction: 'up' })
    expect((await db.send(owner, stale)).status).toBe(409)
    expect((await db.read(owner, '?pageSize=1&page=1')).goals.map(g => g.id)).toEqual([b])
    const second = await db.read(owner, '?pageSize=1&page=2')
    expect(second.totalGoals).toBe(2)
    expect(second.goals.map(g => g.id)).toEqual([a])
    expect((await db.read(other)).goals).toEqual([])
    expect((await db.send(other, db.envelope((await db.read(other)).version, { type: 'editGoal', id: a, title: '越权', standards: ['标准'] }))).status).toBe(404)
    await db.command(owner, { type: 'endGoal', id: b })
    expect((await db.read(owner)).totalGoals).toBe(1)
    expect((await db.read(owner, '?includeTerminal=true')).goals.map(g => g.id)).toEqual([a, b])
    expect((await db.send(owner, db.envelope((await db.read(owner)).version, { type: 'editGoal', id: b, title: '修改终态', standards: ['标准'] }))).status).toBe(400)
  })
})

describe.skipIf(!localPlanningRpc || !process.env.GOAL_REPLAY_FIXTURE)('旧目标回执迁移后通过 HTTP 重放', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('跨旧主线和旧聚焦组排序后稳定分页', async () => {
    const { orderOwner, goalA, goalB, oldOrder, orderReceipt } = JSON.parse(process.env.GOAL_REPLAY_FIXTURE!)
    const replay = await db.request(orderOwner, '/api/adventure/commands', { requestId: 'order-replay-a', expectedVersion: 5, command: oldOrder })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(orderReceipt)
    const before = await db.read(orderOwner)
    expect((await db.request(orderOwner, '/api/adventure/commands', { requestId: 'order-replay-a', expectedVersion: before.version, command: { ...oldOrder, direction: 'up' } })).status).toBe(409)
    expect((await db.request(orderOwner, '/api/adventure/commands', { requestId: 'order-new-old-shape', expectedVersion: before.version, command: oldOrder })).status).toBe(400)
    expect((await db.request(orderOwner, '/api/adventure/preview', { expectedVersion: before.version, command: oldOrder })).status).toBe(400)
    expect(before.goals.map(g => g.id)).toEqual([goalA, goalB])
    expect(before.goals.map(g => g.categoryLabel)).toEqual(['同类', '另一类'])
    await db.command(orderOwner, { type: 'reorderGoals', id: goalB, direction: 'up', targetId: goalA })
    expect((await db.read(orderOwner, '?pageSize=1&page=1')).goals[0].id).toBe(goalB)
    const page2 = await db.read(orderOwner, '?pageSize=1&page=2')
    expect(page2.totalGoals).toBe(2)
    expect(page2.goals[0].id).toBe(goalA)
  })
  it('旧创建及编辑的精确封套重放，不匹配或新旧形状请求被拒绝', async () => {
    const fixture = JSON.parse(process.env.GOAL_REPLAY_FIXTURE!)
    const post = (requestId: string, command: unknown) => db.request(fixture.owner, '/api/adventure/commands', { requestId, expectedVersion: 0, command })
    for (const [id, command, receipt] of [['legacy-create-171', fixture.create, fixture.created], ['legacy-edit-171', fixture.edit, fixture.edited]] as const) {
      const replay = await post(id, command)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(receipt)
      expect((await post(id, { ...command, title: '不同内容' })).status).toBe(409)
    }
    expect((await db.request(fixture.owner, '/api/adventure/commands', { requestId: 'legacy-new-171', expectedVersion: 2, command: fixture.create })).status).toBe(400)
    expect((await db.request(fixture.owner, '/api/adventure/preview', { expectedVersion: 2, command: fixture.edit })).status).toBe(400)
  })
})
