import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'

describe.skipIf(!localPlanningRpc)('无主线任务的真实数据库 API', () => {
  const api = planningDatabase('category-db@example.invalid')
  const owner = crypto.randomUUID()
  beforeEach(() => api.install())
  afterEach(() => api.restore())

  it('独立任务完成、取消及旧回执重试保持奖励和账户隔离', async () => {
    const send = async (requestId: string, expectedVersion: number, command: unknown) => api.request(owner, '/api/adventure/commands', { requestId, expectedVersion, command })
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const created = await send('category-create-1', 0, { type: 'createTask', title: '独立行动', description: '', plannedOn: today, destination: '' })
    expect(created.status).toBe(200)
    const task = planningReceiptSchema.parse(await created.json()).result.entityId
    const completeCommand = { type: 'completeTask', id: task }
    const done = await send('category-complete-1', 1, completeCommand)
    expect(done.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await done.json())
    const list = await api.request(owner, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: 2 })
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({ total: 1, tasks: [{ id: task, independent: true, completionOrigin: { categoryLabel: null, goalId: null } }] })
    const growth = await api.request(owner, '/api/adventure/growth')
    expect(growth.status).toBe(200)
    expect(await growth.json()).toMatchObject({ growth: { totalXp: 1, actions: 1 }, items: [{ goalId: null, categoryLabel: null }] })
    const cancel = await send('category-cancel-1', 2, { type: 'cancelTaskCompletion', completionId: receipt.result.completionId })
    expect(cancel.status).toBe(200)
    expect(await (await send('category-complete-1', 1, completeCommand)).json()).toEqual(receipt)
    expect((await send('category-complete-1', 3, { type: 'deleteTask', id: task })).status).toBe(409)
    expect(await (await api.request(owner, '/api/adventure/growth')).json()).toMatchObject({ total: 0, growth: { totalXp: 0, actions: 0 } })
    expect((await api.request(crypto.randomUUID(), `/api/adventure/task-history?id=${task}`)).status).toBe(404)
  })

  it('不完整的历史回执明确拒绝重放且不重新执行', async () => {
    const other = crypto.randomUUID()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const envelope = { requestId: 'unsafe-receipt-1', expectedVersion: 0, command: { type: 'createTask', title: 'unsafe-receipt-fixture', description: '', plannedOn: today, destination: '' } }
    expect((await api.request(other, '/api/adventure/commands', envelope)).status).toBe(200)
    const retry = await api.request(other, '/api/adventure/commands', envelope)
    expect(retry.status).toBe(409)
    expect(await retry.json()).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
    const list = await api.request(other, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: 1 })
    expect(await list.json()).toMatchObject({ version: 1, total: 1 })
  })

  it('并发写入仅一项成功，旧任务命令不可作为新操作', async () => {
    const other = crypto.randomUUID()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const command = { type: 'createTask', title: '并发行动', description: '', plannedOn: today, destination: '' }
    const [a, b] = await Promise.all(['concurrent-a', 'concurrent-b'].map(requestId => api.request(other, '/api/adventure/commands', { requestId, expectedVersion: 0, command })))
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const receipt = planningReceiptSchema.parse(await (a.status === 200 ? a : b).json())
    for (const command of [{ type: 'endTask', id: receipt.result.entityId }, { type: 'rescheduleTask', id: receipt.result.entityId, plannedOn: today }, { type: 'migrateTask', id: receipt.result.entityId, destination: '' }]) {
      expect((await api.request(other, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: 1, command })).status).toBe(400)
    }
    const list = await api.request(other, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: 1 })
    expect(await list.json()).toMatchObject({ version: 1, total: 1, tasks: [{ id: receipt.result.entityId, status: 'pending' }] })
  })
})
