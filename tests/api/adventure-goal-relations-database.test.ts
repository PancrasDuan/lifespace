import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningPageSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

const db = planningDatabase()
const nativeFetch = globalThis.fetch
describe.skipIf(!localPlanningRpc)('关系卡片 Worker HTTP 与隔离数据库', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('分页只包含当前关联且未删除的任务，完成时间与版本一致并隔离账户', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const goal = (await db.command(owner, { type: 'createGoal', title: '目标', standards: ['标准'] })).result.entityId
    const today = (await db.read(owner)).today
    const make = (title: string) => db.command(owner, { type: 'createTask', title, description: '不应展示', plannedOn: today, destination: goal })
    const first = (await make('甲')).result.entityId
    const second = (await make('乙')).result.entityId
    const moved = (await make('迁出')).result.entityId
    const deleted = (await make('删除')).result.entityId
    await db.command(owner, { type: 'completeTask', id: first })
    await db.command(owner, { type: 'editTask', id: moved, title: '迁出', description: '', plannedOn: today, destination: '' })
    await db.command(owner, { type: 'deleteTask', id: deleted })
    const response = await db.request(owner, `/api/adventure?goalId=${goal}&pageSize=1`)
    expect(response.status).toBe(200)
    const page = planningPageSchema.parse(await response.json())
    expect(page.goalDetail?.relatedTasks).toEqual([{ id: first, title: '甲', plannedOn: today, completedAt: expect.any(String) }])
    expect(page.goalDetail?.totalRelatedTasks).toBe(2)
    expect(page.version).toBe((await db.read(owner)).version)
    const next = planningPageSchema.parse(await (await db.request(owner, `/api/adventure?goalId=${goal}&pageSize=1&goalTaskPage=2`)).json())
    expect(next.goalDetail?.relatedTasks).toEqual([{ id: second, title: '乙', plannedOn: today, completedAt: null }])
    expect((await db.request(other, `/api/adventure?goalId=${goal}`)).status).toBe(404)
  })

  it('未完成任务阻断预览和提交；达成冻结分类、奖励，终态拒绝修改', async () => {
    const owner = crypto.randomUUID()
    const goal = (await db.command(owner, { type: 'createGoal', title: '成果', categoryLabel: '学习', standards: ['标准'] })).result.entityId
    const today = (await db.read(owner)).today
    const task = (await db.command(owner, { type: 'createTask', title: '行动', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await db.read(owner)
    const commands: PlanningCommand[] = [{ type: 'achieveGoal', id: goal, coefficient: 1, reflection: '' }, { type: 'endGoal', id: goal }]
    for (const command of commands) {
      const preview = await db.request(owner, '/api/adventure/preview', { expectedVersion: before.version, command })
      expect(preview.status).toBe(400)
      expect(await preview.json()).toMatchObject({ error: { code: 'PENDING_TASKS' } })
      const result = await db.send(owner, db.envelope(before.version, command))
      expect(result.status).toBe(400)
      expect(await result.json()).toMatchObject({ error: { code: 'PENDING_TASKS' } })
    }
    expect(await db.read(owner)).toEqual(before)
    await db.command(owner, { type: 'completeTask', id: task })
    const version = (await db.read(owner)).version
    const preview = await db.request(owner, '/api/adventure/preview', { expectedVersion: version, command: { type: 'achieveGoal', id: goal } })
    expect(preview.status).toBe(200)
    await db.command(owner, { type: 'editGoal', id: goal, title: '成果', standards: ['标准'], categoryLabel: '新标签' })
    expect((await db.send(owner, db.envelope(version, { type: 'achieveGoal', id: goal, coefficient: 1, reflection: '' }))).status).toBe(409)
    const achieved = await db.command(owner, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '感想' })
    const source = await db.request(owner, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)
    expect(await source.json()).toMatchObject({ event: { categoryLabel: '新标签', amount: 2 }, actionSources: [{ taskId: task, categoryLabel: '学习' }] })
    const terminal = await db.read(owner, `?goalId=${goal}`)
    expect(terminal.goalDetail?.goal.status).toBe('achieved')
    expect((await db.send(owner, db.envelope(terminal.version, { type: 'editGoal', id: goal, title: '修改', standards: ['标准'] }))).status).toBe(400)
  })

  it('迁出的历史完成仍作为奖励来源，但不出现在当前关系', async () => {
    const owner = crypto.randomUUID()
    const source = (await db.command(owner, { type: 'createGoal', title: '来源', standards: ['标准'] })).result.entityId
    const target = (await db.command(owner, { type: 'createGoal', title: '现归属', standards: ['标准'] })).result.entityId
    const today = (await db.read(owner)).today
    const task = (await db.command(owner, { type: 'createTask', title: '历史行动', description: '', plannedOn: today, destination: source })).result.entityId
    await db.command(owner, { type: 'completeTask', id: task })
    const fixture = await nativeFetch(new URL('/rpc/adventure_test_move_completed', localPlanningRpc!), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner, p_task: task, p_goal: target }),
    })
    expect(fixture.status).toBe(204)
    const old = await db.read(owner, `?goalId=${source}`)
    expect(old.goalDetail?.relatedTasks).toEqual([])
    expect(old.goalDetail?.tasks).toMatchObject([{ id: task, goalId: target }])
    const current = await db.read(owner, `?goalId=${target}`)
    expect(current.goalDetail?.relatedTasks).toMatchObject([{ id: task, title: '历史行动' }])
    const achieved = await db.command(owner, { type: 'achieveGoal', id: source, coefficient: 2, reflection: '' })
    const reward = await db.request(owner, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)
    expect(await reward.json()).toMatchObject({ event: { categoryLabel: null, amount: 2 }, actionSources: [{ taskId: task, goalId: source }] })
  })
})
