import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { recurringParentDetailSchema, recurringChildDetailSchema, recurringChildrenSchema, recurringListSchema, dateTaskListSchema } from '../../src/shared/adventure-recurring'
import { planningPreviewSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'
import { growthPageSchema, rewardSourceSchema } from '../../src/shared/adventure-growth'

const db = planningDatabase('recurring@example.invalid')
const json = async (response: Response) => {
  const body: unknown = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}
describe.skipIf(!localPlanningRpc)('周期任务真实 Worker → RPC → PostgreSQL', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  const basis = async (owner: string) => { const p = await db.read(owner); return { today: p.today, expectedVersion: p.version } }
  const create = async (owner: string, requiredCount = 3, destination = '', startOn?: string) => {
    const { today } = await basis(owner)
    return db.command(owner, { type: 'createRecurringTask', title: '周期学习', description: '父说明', periodType: 'week', startOn: startOn ?? today, requiredCount, destination, today })
  }
  const parent = async (owner: string, id: string) => recurringParentDetailSchema.parse(await json(await db.request(owner, '/api/adventure/recurring/detail', { ...await basis(owner), id }))).parent
  const child = async (owner: string, id: string) => recurringChildDetailSchema.parse(await json(await db.request(owner, '/api/adventure/recurring/child', { ...await basis(owner), id }))).child
  const record = async (owner: string, id: string) => db.command(owner, { type: 'recordRecurringCompletion', id, today: (await basis(owner)).today })
  const children = async (owner: string, parentId: string, page = 1) => recurringChildrenSchema.parse(await json(await db.request(owner, '/api/adventure/recurring/children', { ...await basis(owner), parentId, page })))
  const list = async (owner: string, date: string, extra = {}) => recurringListSchema.parse(await json(await db.request(owner, '/api/adventure/recurring/list', { ...await basis(owner), date, ...extra })))
  const actions = async (owner: string, date: string, extra = {}) => dateTaskListSchema.parse(await json(await db.request(owner, '/api/adventure/date-tasks/list', { ...await basis(owner), date, ...extra })))
  const error = async (response: Response, status: number, code: string) => { expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ error: { code } }) }

  it('升级前一次性旧页面以原始封套恢复大额历史奖励，所有旧新写仍拦截', async () => {
    const fixture = JSON.parse(process.env.ADVENTURE_RECURRING_OLD_RECEIPT!) as { owner: string; envelope: ReturnType<typeof db.envelope>; receipt: unknown; retired: { owner: string; envelope: ReturnType<typeof db.envelope>; receipt: unknown } }
    const before = await db.read(fixture.owner)
    const response = await db.request(fixture.owner, '/api/adventure/receipts/lookup', { ...fixture.envelope, nonce: 'a'.repeat(64) }, 'goal-categories-1')
    expect(response.headers.get('X-Lifespace-Adventure-Model')).toBe('goal-categories-1')
    expect(await json(response)).toMatchObject({ receipt: fixture.receipt })
    expect(planningReceiptSchema.parse(fixture.receipt).result.reward?.amount).toBe(7)
    await error(await db.request(fixture.owner, '/api/adventure/commands', fixture.envelope, 'goal-categories-1'), 503, 'CLIENT_UPDATE_REQUIRED')
    await error(await db.request(fixture.owner, '/api/adventure/legacy-retry', fixture.envelope, 'goal-categories-1'), 503, 'CLIENT_UPDATE_REQUIRED')
    expect(await db.read(fixture.owner)).toEqual(before)
    const retired = fixture.retired
    const restored = await db.request(retired.owner, '/api/adventure/receipts/lookup', { ...retired.envelope, nonce: 'b'.repeat(64) }, null)
    expect(await json(restored)).toMatchObject({ receipt: retired.receipt })
    await error(await db.request(retired.owner, '/api/adventure/commands', retired.envelope, 'goal-categories-1'), 503, 'CLIENT_UPDATE_REQUIRED')
  })

  it('激活声明、直接完成、完整父子能力、不可变快照与同封套成功回执', async () => {
    const owner = crypto.randomUUID(), initial = await db.read(owner)
    expect(initial.recurring).toEqual({ version: 1, timeZone: 'Asia/Shanghai', clientVersion: 'recurring-1' })
    const id = (await create(owner, 1)).result.entityId
    const p = await parent(owner, id)
    expect(p).toMatchObject({ status: 'active', completedPeriods: 0, effectiveChildren: 0, currentPeriod: { completed: 0, required: 1 }, capabilities: { recordRecurringCompletion: { allowed: true }, changeStartOn: { allowed: false }, deleteRecurringTask: { allowed: false } } })
    const command: PlanningCommand = { type: 'recordRecurringCompletion', id, today: initial.today }
    const envelope = db.envelope((await basis(owner)).expectedVersion, command)
    const done = planningReceiptSchema.parse(await json(await db.send(owner, envelope)))
    expect(done.result).toMatchObject({ source: { taskKind: 'recurring_child', parentId: id, childId: done.result.entityId, requiredCount: 1 }, growthChange: { xpDelta: 1, after: { actions: 1 } } })
    const after = await parent(owner, id)
    expect(after).toMatchObject({ completedPeriods: 1, effectiveChildren: 1, currentPeriod: { completed: 1, ratio: 1 }, capabilities: { recordRecurringCompletion: { allowed: false } } })
    expect(await child(owner, done.result.entityId)).toMatchObject({ status: 'completed', parentId: id, snapshot: { title: '周期学习', description: '父说明', goalId: null }, capabilities: { cancelRecurringCompletion: { allowed: true } } })
    expect(await json(await db.send(owner, envelope))).toEqual(done)
    await error(await db.send(owner, db.envelope(after.completedPeriods + 1, command)), 400, 'PERIOD_FULL')
  })

  it('撤销逻辑失效，最后关联归零且不生成待办；成长和日期进度同步回退', async () => {
    const owner = crypto.randomUUID(), id = (await create(owner, 1)).result.entityId
    const done = await record(owner, id), today = (await basis(owner)).today
    expect(await children(owner, id)).toMatchObject({ total: 1, children: [{ id: done.result.entityId }] })
    expect(await actions(owner, today)).toMatchObject({ total: 1, progress: { completed: 1, total: 1 } })
    const preview = planningPreviewSchema.parse(await json(await db.request(owner, '/api/adventure/preview', { expectedVersion: done.version, command: { type: 'cancelRecurringCompletion', completionId: done.result.completionId!, today } })))
    expect(preview).toMatchObject({ operation: 'cancelRecurringCompletion', childId: done.result.entityId, parentId: id, growthAfter: { actions: 0, totalXp: 0 } })
    await db.command(owner, { type: 'cancelRecurringCompletion', completionId: done.result.completionId!, today })
    expect(await children(owner, id)).toMatchObject({ total: 0, children: [] })
    expect(await child(owner, done.result.entityId)).toMatchObject({ status: 'cancelled', capabilities: { cancelRecurringCompletion: { allowed: false } } })
    expect(await actions(owner, today)).toMatchObject({ total: 0, tasks: [], progress: { total: 0, ratio: null } })
    expect(await parent(owner, id)).toMatchObject({ completedPeriods: 0, effectiveChildren: 0, capabilities: { recordRecurringCompletion: { allowed: true } } })
    expect((await db.read(owner)).tasks).toEqual([])
    expect((await db.read(owner)).growth).toMatchObject({ actions: 0, totalXp: 0 })
    await error(await db.send(owner, db.envelope((await basis(owner)).expectedVersion, { type: 'deleteRecurringTask', id, today })), 400, 'RECURRING_ALREADY_STARTED')
  })

  it('父迁移连续，子与成长来源保留完成时归属，目标一次性进度和任务数分离', async () => {
    const owner = crypto.randomUUID(), a = (await db.command(owner, { type: 'createGoal', title: '目标 A', standards: ['标准'] })).result.entityId
    const b = (await db.command(owner, { type: 'createGoal', title: '目标 B', standards: ['标准'] })).result.entityId
    const id = (await create(owner, 3, a)).result.entityId, first = await record(owner, id), today = (await basis(owner)).today
    await db.command(owner, { type: 'editRecurringTask', id, title: '迁移后的父', description: '新说明', requiredCount: 3, destination: b, today })
    const second = await record(owner, id)
    expect((await child(owner, first.result.entityId)).snapshot).toMatchObject({ goalId: a, title: '周期学习' })
    expect((await child(owner, second.result.entityId)).snapshot).toMatchObject({ goalId: b, title: '迁移后的父' })
    expect(await parent(owner, id)).toMatchObject({ currentPeriod: { completed: 2 }, effectiveChildren: 2 })
    const page = await db.read(owner, `?goalId=${b}`)
    expect(page.goals.find(g => g.id === b)).toMatchObject({ taskCount: 1, progress: { total: 0, ratio: null } })
    expect(page.goalDetail).toMatchObject({ totalTasks: 0, tasks: [], relatedTasks: [] })
    await db.fixtureFocused(owner, a)
    expect(await actions(owner, today, { scope: 'focus' })).toMatchObject({ total: 1, tasks: [{ id: first.result.entityId }] })
    expect(await actions(owner, today, { search: '目标 A' })).toMatchObject({ total: 1, tasks: [{ id: first.result.entityId }] })
    expect(await list(owner, today, { scope: 'focus' })).toMatchObject({ total: 0 })
    const growth = growthPageSchema.parse(await json(await db.request(owner, '/api/adventure/growth')))
    expect(growth.items.find(e => e.entityId === first.result.entityId)?.recurring).toMatchObject({ goalId: a, parentId: id })
    const source = rewardSourceSchema.parse(await json(await db.request(owner, `/api/adventure/reward-source?id=${first.result.completionId}`)))
    expect(source).toMatchObject({ plannedOn: null, event: { entityId: first.result.entityId, recurring: { goalId: a } } })
    await db.command(owner, { type: 'achieveGoal', id: a, coefficient: 3, reflection: '' })
    const lock = await child(owner, first.result.entityId)
    expect(lock.capabilities.cancelRecurringCompletion.allowed).toBe(false)
    await error(await db.send(owner, db.envelope((await basis(owner)).expectedVersion, { type: 'cancelRecurringCompletion', completionId: first.result.completionId!, today })), 400, 'READ_ONLY')
    const achieved = growthPageSchema.parse(await json(await db.request(owner, '/api/adventure/growth'))).items.find(e => e.kind === 'goal_achieved')!
    const reward = rewardSourceSchema.parse(await json(await db.request(owner, `/api/adventure/reward-source?id=${achieved.id}`)))
    expect(reward).toMatchObject({ event: { amount: 3 }, totalSources: 1, actionSources: [{ taskId: first.result.entityId, plannedOn: null, recurring: { parentId: id, goalId: a } }] })
  })

  it('目标终态阻止未开始与满额父，旧写门禁仍拒绝且保留严格旧回执恢复', async () => {
    const owner = crypto.randomUUID(), goal = (await db.command(owner, { type: 'createGoal', title: '目标', standards: ['标准'] })).result.entityId
    const id = (await create(owner, 1, goal, '2098-01-01')).result.entityId, today = (await basis(owner)).today
    for (const type of ['endGoal', 'achieveGoal'] as const) {
      const command: PlanningCommand = type === 'achieveGoal' ? { type, id: goal, coefficient: 1, reflection: '' } : { type, id: goal }
      await error(await db.request(owner, '/api/adventure/preview', { expectedVersion: (await basis(owner)).expectedVersion, command }), 400, 'PENDING_RECURRING_TASKS')
      await error(await db.send(owner, db.envelope((await basis(owner)).expectedVersion, command)), 400, 'PENDING_RECURRING_TASKS')
      await error(await db.request(owner, '/api/adventure/commands', db.envelope((await basis(owner)).expectedVersion, command), 'goal-categories-1'), 503, 'CLIENT_UPDATE_REQUIRED')
    }
    const probe = z.strictObject({ model: z.literal('goal-categories'), version: z.literal(1), receiptLookup: z.literal(true), legacyRetry: z.literal(false) })
    probe.parse(await json(await db.request(owner, '/api/adventure/compatibility')))
    const envelope = db.envelope((await basis(owner)).expectedVersion, { type: 'editRecurringTask', id, title: '调整', description: '', requiredCount: 2, today })
    const receipt = await json(await db.send(owner, envelope))
    const lookup = await db.request(owner, '/api/adventure/receipts/lookup', { ...envelope, nonce: 'f'.repeat(64) }, 'goal-categories-1')
    expect(lookup.headers.get('X-Lifespace-Adventure-Model')).toBe('goal-categories-1')
    expect(lookup.headers.get('Cache-Control')).toBe('no-store')
    expect(await json(lookup)).toMatchObject({ receipt })
    await error(await db.request(owner, '/api/adventure/legacy-retry', envelope, 'goal-categories-1'), 503, 'CLIENT_UPDATE_REQUIRED')
  })

  it('未开始在开始日移动，结束父停在实际结束日，运行父不生成历史/未来计划', async () => {
    const owner = crypto.randomUUID(), today = (await basis(owner)).today
    const future = (await create(owner, 2, '', '2098-01-01')).result.entityId
    const active = (await create(owner, 2)).result.entityId
    expect(await list(owner, today)).toMatchObject({ total: 1, parents: [{ id: active }] })
    expect(await list(owner, '2098-01-01')).toMatchObject({ total: 1, parents: [{ id: future, status: 'not_started' }] })
    await db.command(owner, { type: 'editRecurringTask', id: future, title: '移动', description: '', requiredCount: 2, startOn: '2098-02-01', today })
    expect(await list(owner, '2098-01-01')).toMatchObject({ total: 0 })
    expect(await list(owner, '2098-02-01')).toMatchObject({ total: 1 })
    expect(await list(owner, '2020-01-01')).toMatchObject({ total: 0 })
    await record(owner, active)
    const preview = planningPreviewSchema.parse(await json(await db.request(owner, '/api/adventure/preview', { expectedVersion: (await basis(owner)).expectedVersion, command: { type: 'endRecurringTask', id: active, today } })))
    expect(preview).toMatchObject({ effectiveChildren: 1, operation: 'endRecurringTask' })
    await db.command(owner, { type: 'endRecurringTask', id: active, today })
    expect(await list(owner, today)).toMatchObject({ total: 1, parents: [{ id: active, status: 'ended', endedOn: today }] })
    expect((await parent(owner, active)).capabilities.endRecurringTask.allowed).toBe(false)
    expect(await actions(owner, today)).toMatchObject({ total: 1 })
    expect(await actions(owner, '2098-02-01')).toMatchObject({ total: 0 })
  })

  it('完整过滤范围分页和搜索，今日分母只有待办一次性和有效行动', async () => {
    const owner = crypto.randomUUID(), today = (await basis(owner)).today
    const id = (await create(owner, 20)).result.entityId
    for (let n = 0; n < 12; n++) await record(owner, id)
    await db.command(owner, { type: 'createTask', title: '一次性', description: '', plannedOn: today, destination: '' })
    const first = await actions(owner, today), second = await actions(owner, today, { page: 2 })
    expect(first).toMatchObject({ total: 13, progress: { completed: 12, total: 13 } })
    expect(first.tasks).toHaveLength(10); expect(second.tasks).toHaveLength(3)
    expect(new Set([...first.tasks, ...second.tasks].map(t => t.id)).size).toBe(13)
    expect(await actions(owner, today, { search: '父说明' })).toMatchObject({ total: 12, progress: { completed: 12, total: 12 } })
    expect(await actions(owner, today, { page: 100 })).toMatchObject({ total: 13, tasks: [] })
    expect((await db.read(owner)).todayTaskProgress).toMatchObject({ total: 13, completed: 12 })
    expect((await db.read(owner)).tasks).toHaveLength(1)
    expect(await children(owner, id)).toMatchObject({ total: 12, children: expect.any(Array) })
    expect((await children(owner, id, 2)).children).toHaveLength(2)
    expect(await children(owner, id, 100)).toMatchObject({ total: 12, children: [] })
  })

  it('严格请求、越权、跨日与过期版本返回明确错误且没有副作用', async () => {
    const owner = crypto.randomUUID(), id = (await create(owner)).result.entityId, state = await basis(owner)
    const readInput = { ...state, id }
    await error(await db.request(owner, '/api/adventure/recurring/detail', { ...readInput, extra: true }), 400, 'INVALID_COMMAND')
    await error(await db.request(owner, '/api/adventure/recurring/detail?extra=true', readInput), 400, 'INVALID_QUERY')
    await error(await db.request(owner, '/api/adventure/recurring/detail', { ...readInput, today: '2020-01-01' }), 409, 'PLANNING_DATE_CHANGED')
    await error(await db.request(owner, '/api/adventure/recurring/detail', { ...readInput, expectedVersion: 0 }), 409, 'VERSION_CONFLICT')
    const stranger = crypto.randomUUID()
    await error(await db.request(stranger, '/api/adventure/recurring/detail', { ...await basis(stranger), id }), 404, 'NOT_FOUND')
    await error(await db.send(owner, db.envelope(state.expectedVersion, { type: 'recordRecurringCompletion', id, today: '2020-01-01' })), 409, 'PLANNING_DATE_CHANGED')
    expect(await basis(owner)).toEqual(state)
    expect(await parent(owner, id)).toMatchObject({ effectiveChildren: 0 })
  })

  it('一次性2完成、逾期1待办、周期2子，统一今日进度为4/5', async () => {
    const owner = crypto.randomUUID(), today = (await basis(owner)).today
    await db.createHistoricalTaskFourTable(owner, { type: 'createTask', title: '逾期', description: '', plannedOn: '2020-01-01', destination: '' })
    for (let i = 0; i < 2; i++) {
      const task = await db.command(owner, { type: 'createTask', title: '一次性完成', description: '', plannedOn: today, destination: '' })
      await db.command(owner, { type: 'completeTask', id: task.result.entityId })
    }
    const id = (await create(owner, 2)).result.entityId
    await record(owner, id); await record(owner, id)
    expect(await actions(owner, today)).toMatchObject({ total: 5, progress: { completed: 4, total: 5, ratio: 0.8 } })
    expect((await db.read(owner)).todayTaskProgress).toEqual({ completed: 4, total: 5, ratio: 0.8 })
  })

  it('父列表按完整过滤范围固定10项分页，未开始能力和删除预览来自真实日期', async () => {
    const owner = crypto.randomUUID(), ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push((await create(owner, 1, '', '2098-01-01')).result.entityId)
    const first = await list(owner, '2098-01-01'), second = await list(owner, '2098-01-01', { page: 2 })
    expect(first.total).toBe(12); expect(first.parents).toHaveLength(10); expect(second.parents).toHaveLength(2)
    expect([...first.parents, ...second.parents].map(p => p.id)).toEqual(ids)
    expect(first.parents[0].capabilities).toMatchObject({ changeStartOn: { allowed: true }, deleteRecurringTask: { allowed: true }, recordRecurringCompletion: { allowed: false }, endRecurringTask: { allowed: false } })
    expect(await list(owner, '2098-01-01', { page: 99 })).toMatchObject({ total: 12, parents: [] })
    expect(await list(owner, '2098-01-01', { search: '无此内容' })).toMatchObject({ total: 0 })
    const state = await basis(owner)
    expect(planningPreviewSchema.parse(await json(await db.request(owner, '/api/adventure/preview', { expectedVersion: state.expectedVersion, command: { type: 'deleteRecurringTask', id: ids[0], today: state.today } })))).toMatchObject({ requiresConfirmation: true, operation: 'deleteRecurringTask', entityId: ids[0], effectiveChildren: 0, completedPeriods: 0 })
  })
})
