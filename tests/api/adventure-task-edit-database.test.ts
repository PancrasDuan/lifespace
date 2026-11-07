import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { taskHistorySchema } from '../../src/shared/adventure-planning'
import { planningDatabase, localPlanningRpc } from '../support/planning-database'

const database = planningDatabase('task-edit@example.invalid')
const { read, command, request, send, envelope } = database
let owner: string

describe.skipIf(!localPlanningRpc)('统一任务编辑的真实事务', () => {
  beforeEach(() => { owner = crypto.randomUUID(); database.install() })
  afterEach(() => database.restore())

  it('新建拒绝服务端今天之前的日期，且不改变账户或任务', async () => {
    const owner = crypto.randomUUID()
    const before = await read(owner)
    for (const destination of ['', (await command(owner, { type: 'createGoal', title: '归属', standards: ['标准'], destination: '' })).result.entityId]) {
      const current = await read(owner)
      const result = await send(owner, envelope(current.version, { type: 'createTask', title: '禁止补建', description: '', plannedOn: '2020-01-01', destination }))
      expect(result.status).toBe(400)
      expect(await result.json()).toMatchObject({ error: { code: 'RESCHEDULE_PAST' } })
      expect(await read(owner)).toEqual(current)
    }
    expect((await read(owner)).tasks).toEqual(before.tasks)
  })
  it('一次保存四项并保留任务身份、历史及稳定回执', async () => {
    const goal = (await command(owner, { type: 'createGoal', title: '新归属', standards: ['完成标准'], destination: '' })).result.entityId
    const today = (await read(owner)).today
    const id = (await command(owner, { type: 'createTask', title: '原任务', description: '原说明', plannedOn: today, destination: '' })).result.entityId
    const before = await read(owner)
    const value = { requestId: crypto.randomUUID(), expectedVersion: before.version,
      command: { type: 'editTask', id, title: '新任务', description: '新说明', plannedOn: '2099-01-01', destination: goal } }
    const response = await request(owner, '/api/adventure/commands', value)
    expect(response.status).toBe(200)
    const receipt = await response.json()
    const after = await read(owner, '?taskRange=future')
    expect(after.tasks[0]).toMatchObject({ id, title: '新任务', description: '新说明', plannedOn: '2099-01-01', goalId: goal, status: 'pending' })
    expect(after.version).toBe(before.version + 1)
    expect(after.growth).toEqual(before.growth)
    expect(await (await request(owner, '/api/adventure/commands', value)).json()).toEqual(receipt)
    expect(await read(owner, '?taskRange=future')).toEqual(after)
  })
  it('旧独立改期、迁移和缺少四字段的新编辑请求均不可写入', async () => {
    const today = (await read(owner)).today
    const id = (await command(owner, { type: 'createTask', title: '禁止旧入口', description: '', plannedOn: today, destination: '' })).result.entityId
    const before = await read(owner)
    for (const value of [
      { type: 'rescheduleTask', id, plannedOn: '2099-01-01' },
      { type: 'migrateTask', id, destination: '' },
      { type: 'editTask', id, title: '缺少日期归属', description: '' },
    ]) {
      const response = await request(owner, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: before.version, command: value })
      expect(response.status).toBe(400)
      expect(await read(owner)).toEqual(before)
    }
  })

  it('逾期原日期不变可保存其他字段，更改为另一过去日期或越权归属均原子拒绝', async () => {
    const id = (await database.createHistoricalTask(owner, { type: 'createTask', title: '逾期任务', description: '', plannedOn: '2020-01-01', destination: '' })).result.entityId
    const before = await read(owner, '?taskRange=past')
    const value = { type: 'editTask' as const, id, title: '保留日期的新名称', description: '修改说明', plannedOn: '2020-01-01', destination: '' }
    await command(owner, value)
    const after = await read(owner, '?taskRange=past')
    expect(after.tasks[0]).toMatchObject({ id, title: '保留日期的新名称', plannedOn: '2020-01-01', overdue: true })
    expect(after.version).toBe(before.version + 1)
    for (const change of [{ plannedOn: '2020-01-02' }, { destination: crypto.randomUUID() }]) {
      const response = await request(owner, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: after.version, command: { ...value, ...change } })
      expect([400, 404]).toContain(response.status)
      expect(await read(owner, '?taskRange=past')).toEqual(after)
    }
    const history = taskHistorySchema.parse(await (await request(owner, `/api/adventure/task-history?id=${id}`)).json())
    expect(history.total).toBe(1)
    expect(history.items[0]).toMatchObject({ title: '逾期任务', newPlannedOn: '2020-01-01' })
  })

  it('同版本并发编辑只提交一份结果，已完成任务不可编辑', async () => {
    const today = (await read(owner)).today
    const id = (await command(owner, { type: 'createTask', title: '并发任务', description: '', plannedOn: today, destination: '' })).result.entityId
    const before = await read(owner)
    const value = { type: 'editTask' as const, id, title: '编辑一', description: '完整说明', plannedOn: today, destination: '' }
    const responses = await Promise.all([send(owner, envelope(before.version, value)), send(owner, envelope(before.version, { ...value, title: '编辑二' }))])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect((await read(owner)).version).toBe(before.version + 1)
    await command(owner, { type: 'completeTask', id })
    const completed = await read(owner)
    const response = await send(owner, envelope(completed.version, value))
    expect(response.status).toBe(400)
    expect(await read(owner)).toEqual(completed)
  })
})
