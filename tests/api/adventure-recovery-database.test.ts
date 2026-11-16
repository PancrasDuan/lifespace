import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'

const db = planningDatabase('recovery-224@example.invalid')
const recover = (owner: string, envelope: unknown) => db.request(owner, '/api/adventure/commands', envelope)

describe.skipIf(!localPlanningRpc)('原封套恢复真实事务', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())

  it('未提交时并发原封套恢复只写一次；响应丢失后仍返回原回执', async () => {
    const owner = crypto.randomUUID(), before = await db.read(owner)
    const envelope = db.envelope(before.version, { type: 'createTask', title: '恢复行动', description: '', plannedOn: before.today, destination: '' })
    const responses = await Promise.all(Array.from({ length: 6 }, () => recover(owner, envelope)))
    for (const response of responses) expect(response.status).toBe(200)
    const results = await Promise.all(responses.map(response => response.json()))
    for (const result of results) expect(result).toEqual(results[0])
    const after = await db.read(owner)
    expect(after.version).toBe(before.version + 1)
    expect(after.totalTasks).toBe(1)
    const replay = await recover(owner, envelope)
    expect(await replay.json()).toEqual(results[0])
    expect(await db.read(owner)).toEqual(after)
  })

  it('已完成且后续撤销的原封套仍返回历史回执，不重复奖励', async () => {
    const owner = crypto.randomUUID(), before = await db.read(owner)
    const task = await db.command(owner, { type: 'createTask', title: '历史完成', description: '', plannedOn: before.today, destination: '' })
    const envelope = db.envelope(task.version, { type: 'completeTask', id: task.result.entityId })
    const receipt = planningReceiptSchema.parse(await (await db.send(owner, envelope)).json())
    if (!receipt.result.completionId) throw new Error('完成回执缺少 completionId')
    await db.command(owner, { type: 'cancelTaskCompletion', completionId: receipt.result.completionId })
    const after = await db.read(owner)
    const response = await recover(owner, envelope)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expect(await db.read(owner)).toEqual(after)
  })

  it('版本冲突不执行，原 ID 内容冲突不允许解除，旧封套缺失只进入人工核对', async () => {
    const owner = crypto.randomUUID(), before = await db.read(owner)
    const envelope = db.envelope(before.version, { type: 'createTask', title: '原行动', description: '', plannedOn: before.today, destination: '' })
    await db.command(owner, { type: 'createGoal', title: '其他页面变更', standards: ['标准'] })
    const after = await db.read(owner)
    expect(await (await recover(owner, envelope)).json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect(await db.read(owner)).toEqual(after)
    const written = { ...envelope, expectedVersion: after.version }
    expect((await recover(owner, written)).status).toBe(200)
    const committed = await db.read(owner)
    const conflict = await recover(owner, { ...written, command: { ...written.command, title: '变造' } })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    const legacy = { requestId: 'legacy-missing-224', expectedVersion: 0, command: { type: 'createGoal', destination: '', title: '旧目标', standards: ['标准'] } }
    expect(await (await db.request(owner, '/api/adventure/receipts/lookup', { ...legacy, nonce: 'a'.repeat(64) })).json()).toMatchObject({ requestId: legacy.requestId, nonce: 'a'.repeat(64), error: { code: 'RECEIPT_UNKNOWN' } })
    expect(await db.read(owner)).toEqual(committed)
  })

  it('版本未变但跨天的创建和取消明确拒绝，可人工核对且没有副作用', async () => {
    const owner = crypto.randomUUID(), before = await db.read(owner)
    const past = new Date(Date.parse(`${before.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    const missed = db.envelope(before.version, { type: 'createTask', title: '昨日未提交', description: '', plannedOn: past, destination: '' })
    expect(await (await recover(owner, missed)).json()).toMatchObject({ error: { code: 'RESCHEDULE_PAST' } })
    expect(await db.read(owner)).toEqual(before)
    await db.createHistoricalTask(owner, { type: 'createTask', title: '昨日完成', description: '', plannedOn: past, destination: '' }, past)
    const completed = await db.read(owner, '?taskRange=past')
    const completionId = completed.tasks[0].completionId
    if (!completionId) throw new Error('历史完成缺少 completionId')
    const cancellation = db.envelope(completed.version, { type: 'cancelTaskCompletion', completionId })
    expect(await (await recover(owner, cancellation)).json()).toMatchObject({ error: { code: 'DATE_LOCKED' } })
    expect(await db.read(owner, '?taskRange=past')).toEqual(completed)
  })
})
