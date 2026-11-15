import { afterEach, describe, expect, it, vi } from 'vitest'
import { planningCommandSchema, planningEnvelopeSchema, planningReceiptSchema, recurringCommandSchema, planningPageSchema, type PlanningEnvelope } from '../../src/shared/adventure-planning'
import { storedPlanningEnvelopeSchema } from '../../src/shared/adventure-recovery'
import { recurringChildSchema, recurringChildrenSchema, recurringListInputSchema, recurringParentSchema, dateTaskListSchema, recurringDefinitiveErrors } from '../../src/shared/adventure-recurring'
import { rewardEntrySchema, rewardSourceSchema } from '../../src/shared/adventure-growth'
import { planningApi, PlanningError } from '../../src/adventure/planning-api'
import { authorizedFetch, authorizedMutation } from '../../src/auth/request'
import { adventureClientVersion, adventureReceiptModel, planningCompatibility, recurringAdventureClientVersion } from '../../src/shared/adventure-client-version'

vi.mock('../../src/auth/request', () => ({ authorizedFetch: vi.fn(), authorizedMutation: vi.fn() }))
const parentId = '00000000-0000-4000-8000-000000000198'
const childId = '00000000-0000-4000-8000-000000000199'
const completionId = '00000000-0000-4000-8000-000000000200'
const today = '2026-11-15'
const basis = { expectedVersion: 9, today }
const context = { version: 9, today, timeZone: 'Asia/Shanghai' }
const readSignal = () => new AbortController().signal
const allowed = { allowed: true }, denied = { allowed: false, reason: '当前不可操作' }
const snapshot = {
  parentId, childId, title: '刷题', description: '完成一道记录一次', periodType: 'week', anchorOn: '2026-11-11',
  periodNumber: 1, periodStartOn: '2026-11-11', periodEndOn: '2026-11-17', requiredCount: 5,
  occurredAt: '2026-11-15T00:30:00Z', occurredOn: today, goalId: null, goalTitle: null, categoryLabel: null,
}
const reward = { amount: 1, calculation: { type: 'fixed_task', completionId, count: 1, coefficient: 1 } }
const child = { kind: 'recurring_child', id: childId, parentId, completionId, status: 'completed', invalidatedAt: null,
  snapshot, reward, capabilities: { cancelRecurringCompletion: allowed } }
const parent = {
  kind: 'recurring', id: parentId, title: '刷题', description: '完成一道记录一次', periodType: 'week', startOn: '2026-11-11', requiredCount: 3,
  status: 'active', endedAt: null, endedOn: null, goalId: null, goalTitle: null, categoryLabel: null, independent: true,
  completedPeriods: 1, effectiveChildren: 4, currentPeriod: { number: 1, startOn: '2026-11-11', endOn: '2026-11-17', completed: 4, required: 3, satisfied: true, ratio: 1 },
  capabilities: { editRecurringTask: allowed, changeStartOn: denied, changeDestination: allowed, recordRecurringCompletion: denied, endRecurringTask: allowed, deleteRecurringTask: denied },
}
const envelope = { requestId: 'recurring-contract-01', expectedVersion: 9, command: { type: 'recordRecurringCompletion', id: parentId, today } } satisfies PlanningEnvelope
const receipt = { version: 10, result: { entityId: childId, completionId, message: '已完成 · +1 经验', reward,
  source: { ...snapshot, taskKind: 'recurring_child' } } }
afterEach(() => vi.resetAllMocks())

it('六个新命令共享严格封套和权威页面日期；旧一次性及五表历史封套继续解析', () => {
  const commands = [
    { type: 'createRecurringTask', title: ' 刷题 ', description: '', periodType: 'month', startOn: today, requiredCount: 5, destination: '', today },
    { type: 'editRecurringTask', id: parentId, title: '刷题', description: '', requiredCount: 3, today },
    envelope.command, { type: 'cancelRecurringCompletion', completionId, today },
    { type: 'endRecurringTask', id: parentId, today }, { type: 'deleteRecurringTask', id: parentId, today },
  ]
  for (const command of commands) {
    expect(planningEnvelopeSchema.safeParse({ ...envelope, command }).success).toBe(true)
    const { today: _today, ...missingDate } = command
    expect(recurringCommandSchema.safeParse(missingDate).success).toBe(false)
    for (const extra of [{ owner: parentId }, { amount: 9 }, { notes: '备注' }, { completedPeriods: 9 }, { occurredOn: today }])
      expect(recurringCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false)
  }
  expect(planningCommandSchema.parse(commands[0])).toMatchObject({ title: '刷题' })
  expect(planningEnvelopeSchema.safeParse({ ...envelope, command: { type: 'completeTask', id: childId } }).success).toBe(true)
  expect(storedPlanningEnvelopeSchema.safeParse({ ...envelope, command: { type: 'createGoal', title: '旧目标', standards: ['完成'], destination: 'independent' } }).success).toBe(true)
  expect(planningEnvelopeSchema.safeParse({ ...envelope, command: { type: 'completeTask', id: childId, today } }).success).toBe(false)
})

it('次数只收安全正整数，日期收真实公历日；不开放改周期、备注、奖励或日期回填字段', () => {
  const base = { type: 'createRecurringTask', title: '刷题', description: '', periodType: 'week', startOn: today, requiredCount: 5, destination: '', today }
  for (const requiredCount of [0, -1, 1.5, '5', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(planningCommandSchema.safeParse({ ...base, requiredCount }).success).toBe(false)
  for (const requiredCount of [1, 3, Number.MAX_SAFE_INTEGER])
    expect(planningCommandSchema.safeParse({ ...base, requiredCount }).success).toBe(true)
  for (const startOn of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-11-15T00:00Z', '0000-01-01'])
    expect(planningCommandSchema.safeParse({ ...base, startOn }).success).toBe(false)
  expect(planningCommandSchema.safeParse({ ...base, startOn: '2028-02-29' }).success).toBe(true)
  for (const periodType of ['day', 'RRULE', 'weekly']) expect(planningCommandSchema.safeParse({ ...base, periodType }).success).toBe(false)
  expect(planningCommandSchema.safeParse({ type: 'editRecurringTask', id: parentId, title: '改名', description: '', requiredCount: 1, periodType: 'month', today }).success).toBe(false)
})

it('父响应保留4/3实际次数，子响应冻结完成时5次要求，失效子保留但关联排除', () => {
  expect(recurringParentSchema.parse(parent).currentPeriod?.completed).toBe(4)
  expect(recurringChildSchema.parse(child).snapshot.requiredCount).toBe(5)
  expect(recurringParentSchema.safeParse({ ...parent, currentPeriod: { ...parent.currentPeriod, completed: 3, satisfied: false } }).success).toBe(false)
  expect(recurringParentSchema.safeParse({ ...parent, status: 'not_started' }).success).toBe(false)
  expect(recurringChildSchema.safeParse({ ...child, parentId: childId }).success).toBe(false)
  expect(recurringChildSchema.safeParse({ ...child, reward: { ...reward, amount: 2 } }).success).toBe(false)
  const cancelled = { ...child, status: 'cancelled', invalidatedAt: '2026-11-15T01:00:00Z', capabilities: { cancelRecurringCompletion: denied } }
  expect(recurringChildSchema.safeParse(cancelled).success).toBe(true)
  expect(recurringChildrenSchema.safeParse({ ...context, parentId, page: 1, pageSize: 10, total: 1, children: [cancelled] }).success).toBe(false)
  expect(recurringChildrenSchema.parse({ ...context, parentId, page: 1, pageSize: 10, total: 0, children: [] }).total).toBe(0)
  expect(dateTaskListSchema.safeParse({ ...context, date: today, scope: 'all', search: '', page: 1, pageSize: 10, total: 1, tasks: [child], progress: { completed: 4, total: 5, ratio: .8 } }).success).toBe(true)
})

it('父子分页固定10项、查询固定版本日期并拒绝owner；旧奖励回执及新来源都可恢复', () => {
  const input = { ...basis, date: today }
  expect(recurringListInputSchema.parse(input)).toMatchObject({ page: 1, search: '', scope: 'all' })
  for (const extra of [{ page: 0 }, { page: 1_000_001 }, { owner: parentId }, { search: 'x'.repeat(101) }])
    expect(recurringListInputSchema.safeParse({ ...input, ...extra }).success).toBe(false)
  expect(planningReceiptSchema.parse(receipt).result.source).toMatchObject({ parentId, childId, periodNumber: 1, requiredCount: 5 })
  expect(storedPlanningEnvelopeSchema.parse(envelope)).toEqual(envelope)
  const legacy = { version: 2, result: { entityId: parentId.toUpperCase(), message: '已完成', reward: { amount: 3_000_000_000, calculation: { type: 'fixed_task', completionId, count: 1, coefficient: 3_000_000_000 } } } }
  expect(planningReceiptSchema.parse(legacy)).toEqual(legacy)
  const event = { id: completionId, kind: 'task_completed', entityId: childId, title: snapshot.title, occurredAt: snapshot.occurredAt, occurredOn: today,
    amount: 1, goalId: null, goalTitle: null, categoryLabel: null, calculation: reward.calculation, recurring: snapshot }
  expect(rewardEntrySchema.parse(event).recurring?.childId).toBe(childId)
  expect(rewardSourceSchema.safeParse({ version: 9, event, description: snapshot.description, plannedOn: null, standards: [], reflection: null,
    page: 1, pageSize: 5, totalSources: 1, actionSources: [{ taskId: childId, completionId, occurredOn: today, title: snapshot.title, description: snapshot.description,
      plannedOn: null, goalId: null, goalTitle: null, categoryLabel: null, recurring: snapshot }] }).success).toBe(true)
  // The current page need not advertise recurring capability before #199 activation.
  expect(planningPageSchema.shape.recurring.safeParse(undefined).success).toBe(true)
})

describe('纯API客户端的错误和接续边界', () => {
  it.each(Object.entries(recurringDefinitiveErrors))('%s只发送一次并提供明确错误，不改封套、不补交', async (code, status) => {
    vi.mocked(authorizedMutation).mockResolvedValue(Response.json({ error: { code, message: '请重新读取' } }, { status }))
    const original = structuredClone(envelope)
    await expect(planningApi.send(parentId, envelope, readSignal())).rejects.toMatchObject({ code, status, uncertain: false, requiresRefresh: code === 'PLANNING_DATE_CHANGED' })
    expect(authorizedMutation).toHaveBeenCalledTimes(1)
    expect(envelope).toEqual(original)
    expect(authorizedMutation).toHaveBeenCalledWith('/api/adventure/commands', JSON.stringify(envelope), expect.any(AbortSignal), parentId, 'POST', { 'X-Adventure-Client-Version': recurringAdventureClientVersion })
  })
  it.each([
    [409, 'REQUEST_ID_REUSED'], [404, 'RECEIPT_UNKNOWN'], [503, 'CLIENT_UPDATE_REQUIRED'], [401, 'AUTH_REQUIRED'],
    [500, 'PLANNING_DATE_CHANGED'], [400, 'constructor'], [503, 'ADVENTURE_UNAVAILABLE'],
  ])('未知或不匹配的%d/%s保留pending', async (status, code) => {
    vi.mocked(authorizedMutation).mockResolvedValue(Response.json({ error: { code, message: '未知' } }, { status }))
    await expect(planningApi.send(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    expect(authorizedMutation).toHaveBeenCalledTimes(1)
  })
  it('网络中断和成功响应格式损坏仍为未知；旧一次性请求保持现行版本头', async () => {
    vi.mocked(authorizedMutation).mockRejectedValueOnce(new TypeError('network'))
    await expect(planningApi.send(parentId, envelope, readSignal())).rejects.toBeInstanceOf(PlanningError)
    vi.mocked(authorizedMutation).mockResolvedValueOnce(Response.json({ version: 10 }))
    await expect(planningApi.send(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    vi.mocked(authorizedMutation).mockResolvedValueOnce(Response.json(receipt))
    const once = { ...envelope, command: { type: 'completeTask' as const, id: childId } }
    await planningApi.send(parentId, once, readSignal())
    expect(vi.mocked(authorizedMutation).mock.lastCall?.[5]).toEqual({ 'X-Adventure-Client-Version': adventureClientVersion })
  })
  it('按固定版本日期读取完整分页，响应跨天或版本变动必须回读', async () => {
    const list = { ...context, date: today, scope: 'all', search: '', page: 1, pageSize: 10, total: 1, parents: [parent] }
    vi.mocked(authorizedMutation).mockResolvedValueOnce(Response.json(list))
    const filters = { ...basis, date: today, scope: 'all' as const, search: '', page: 1 }
    expect((await planningApi.recurringList(parentId, filters, readSignal())).parents[0].id).toBe(parentId)
    expect(authorizedMutation).toHaveBeenCalledWith('/api/adventure/recurring/list', JSON.stringify(filters), expect.any(AbortSignal), parentId)
    vi.mocked(authorizedMutation).mockResolvedValueOnce(Response.json({ ...list, today: '2026-11-16' }))
    await expect(planningApi.recurringList(parentId, filters, readSignal())).rejects.toMatchObject({ code: 'PLANNING_DATE_CHANGED', requiresRefresh: true })
    vi.mocked(authorizedMutation).mockResolvedValueOnce(Response.json({ ...list, version: 10 }))
    await expect(planningApi.recurringList(parentId, filters, readSignal())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })
  it('父详情、生效子分页、子详情及统一日期流共用公共请求入口', async () => {
    const signal = readSignal()
    vi.mocked(authorizedMutation)
      .mockResolvedValueOnce(Response.json({ ...context, parent }))
      .mockResolvedValueOnce(Response.json({ ...context, parentId, page: 1, pageSize: 10, total: 1, children: [child] }))
      .mockResolvedValueOnce(Response.json({ ...context, child }))
      .mockResolvedValueOnce(Response.json({ ...context, date: today, scope: 'all', search: '', page: 1, pageSize: 10, total: 1, tasks: [child], progress: { completed: 1, total: 1, ratio: 1 } }))
    expect((await planningApi.recurringParent(parentId, { ...basis, id: parentId }, signal)).parent.id).toBe(parentId)
    expect((await planningApi.recurringChildren(parentId, { ...basis, parentId, page: 1 }, signal)).children[0].id).toBe(childId)
    expect((await planningApi.recurringChild(parentId, { ...basis, id: childId }, signal)).child.id).toBe(childId)
    expect((await planningApi.dateTaskList(parentId, { ...basis, date: today, scope: 'all', search: '', page: 1 }, signal)).tasks[0].kind).toBe('recurring_child')
    expect(vi.mocked(authorizedMutation).mock.calls.map(call => call[0])).toEqual([
      '/api/adventure/recurring/detail', '/api/adventure/recurring/children', '/api/adventure/recurring/child', '/api/adventure/date-tasks/list',
    ])
  })
  it('新客户端对旧一次性和周期pending都使用冻结的只读协议，不协商写版本', async () => {
    const once = { ...envelope, command: { type: 'completeTask' as const, id: childId } }
    vi.mocked(authorizedFetch).mockImplementation(async () => Response.json(planningCompatibility, { headers: { 'Cache-Control': 'no-store' } }))
    vi.mocked(authorizedMutation).mockImplementation(async (_path, body) => {
      const lookup = JSON.parse(body)
      return Response.json({ requestId: lookup.requestId, nonce: lookup.nonce, receipt }, { headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Model': adventureReceiptModel } })
    })
    for (const pending of [once, envelope]) {
      expect(await planningApi.lookupReceipt(parentId, pending, readSignal())).toEqual(planningReceiptSchema.parse(receipt))
    }
    expect(authorizedMutation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(authorizedMutation).mock.calls.every(call => call[0] === '/api/adventure/receipts/lookup' && call[5] === undefined)).toBe(true)
  })
  it('探针加字段或回执头误用新写版本时保持未知，不回退写入', async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce(Response.json({ ...planningCompatibility, recurring: 1, clientVersion: recurringAdventureClientVersion }, { headers: { 'Cache-Control': 'no-store' } }))
    await expect(planningApi.lookupReceipt(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    expect(authorizedMutation).not.toHaveBeenCalled()
    vi.mocked(authorizedFetch).mockResolvedValueOnce(Response.json(planningCompatibility, { headers: { 'Cache-Control': 'no-store' } }))
    vi.mocked(authorizedMutation).mockImplementationOnce(async (_path, body) => {
      const lookup = JSON.parse(body)
      return Response.json({ requestId: lookup.requestId, nonce: lookup.nonce, receipt }, { headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Model': recurringAdventureClientVersion } })
    })
    await expect(planningApi.lookupReceipt(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    expect(authorizedMutation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(authorizedMutation).mock.calls[0][0]).toBe('/api/adventure/receipts/lookup')
  })
  it('回执nonce不符或无no-store时保持未知，绝不退回写入', async () => {
    vi.mocked(authorizedFetch).mockResolvedValue(Response.json({ model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false }, { headers: { 'Cache-Control': 'no-store' } }))
    vi.mocked(authorizedMutation).mockResolvedValue(Response.json({ requestId: envelope.requestId, nonce: 'bad', receipt }, { headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Model': adventureReceiptModel } }))
    await expect(planningApi.lookupReceipt(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    expect(authorizedMutation).toHaveBeenCalledTimes(1)
    vi.mocked(authorizedFetch).mockResolvedValue(Response.json({ model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false }))
    await expect(planningApi.lookupReceipt(parentId, envelope, readSignal())).rejects.toMatchObject({ uncertain: true })
    expect(authorizedMutation).toHaveBeenCalledTimes(1)
  })
})
