import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'

describe.skipIf(!localPlanningRpc)('无主线任务的真实数据库 API', () => {
  const api = planningDatabase('category-db@example.invalid')
  const owner = crypto.randomUUID()
  beforeEach(() => api.install())
  afterEach(() => api.restore())

  for (const [index, name, expected] of [
    [0, '大写 max', { goalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    [1, '大写 UUID', { goalId: 'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA' }],
    [2, '小写 UUID', { goalId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }],
    [3, 'nil UUID', { goalId: '00000000-0000-0000-0000-000000000000' }],
    [4, '小写 max', { goalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    [5, '零年', { plannedOn: '0000-01-01' }],
    [6, '第一年', { plannedOn: '0001-01-01' }],
    [7, '末年', { occurredOn: '9999-12-31' }],
    [8, '零年闰日', { plannedOn: '0000-02-29' }],
    [9, '非法日期', null],
    [10, '有效闰日', { plannedOn: '2000-02-29' }],
    [11, '非法 UUID', null],
  ] as const) {
    it(`新库合成回执 ${name} 在两个 Worker 入口安全处理且账户不变`, async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
      const currentOwner = crypto.randomUUID()
      const envelope = { requestId: `fresh-boundary-${index}`, expectedVersion: 0, command: { type: 'createTask', title: `boundary-fresh-${index}`, description: '', plannedOn: today, destination: '' } }
      expect((await api.request(currentOwner, '/api/adventure/commands', envelope)).status).toBe(200)
      const before = await (await api.request(currentOwner, '/api/adventure/growth')).json()
      const observed: Array<{ path: string; status: number; body: unknown }> = []
      for (const [path, body] of [
        ['/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }],
        ['/api/adventure/commands', envelope],
      ] as const) {
        const response = await api.request(currentOwner, path, body, path.endsWith('/lookup') ? null : undefined)
        observed.push({ path, status: response.status, body: await response.json() })
      }
      expect(await (await api.request(currentOwner, '/api/adventure/growth')).json()).toEqual(before)
      if (expected === null) {
        expect(observed.map(result => result.status)).toEqual([409, 409])
        for (const result of observed) expect(result.body, result.path).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      } else {
        expect(observed.map(result => result.status)).toEqual([200, 200])
        for (const result of observed) {
          const value = result.body as { receipt?: { result: { source: unknown } }; result?: { source: unknown } }
          expect(result.path.endsWith('/lookup') ? value.receipt?.result.source : value.result?.source, result.path).toEqual(expected)
        }
      }
    })
  }

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

  it('四表初始化下未知结构回执拒绝重放且摘要冲突优先', async () => {
    for (const suffix of ['cn', 'en']) {
      const other = crypto.randomUUID()
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
      const envelope = { requestId: `unsafe-${suffix}-fixture`, expectedVersion: 0, command: { type: 'createTask', title: `unsafe-${suffix}-fixture`, description: '', plannedOn: today, destination: '' } }
      const initial = await api.request(other, '/api/adventure/commands', envelope)
      expect(initial.status).toBe(200)
      const task = planningReceiptSchema.parse(await initial.json()).result.entityId
      const conflict = await api.request(other, '/api/adventure/commands', { ...envelope, command: { type: 'deleteTask', id: task } })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
      const retry = await api.request(other, '/api/adventure/commands', envelope)
      expect(retry.status).toBe(409)
      const error = await retry.json()
      expect(error).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      expect(JSON.stringify(error)).not.toMatch(/mainline|主线/i)
      const list = await api.request(other, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: 1 })
      expect(await list.json()).toMatchObject({ version: 1, total: 1, tasks: [{ id: task }] })
    }
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

  it('目标标签改变后，任务完成和目标达成的奖励来源仍保留各自发生时标签', async () => {
    const other = crypto.randomUUID()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const goal = (await api.fixtureGoal(other, 0, { type: 'createGoal', title: '目标原名', standards: ['原标准'], categoryLabel: '原分类' })).result.entityId
    const send = (requestId: string, expectedVersion: number, command: unknown) => api.request(other, '/api/adventure/commands', { requestId, expectedVersion, command })
    const created = await send('freeze-task-1', 1, { type: 'createTask', title: '行动原名', description: '原说明', plannedOn: today, destination: goal })
    const task = planningReceiptSchema.parse(await created.json()).result.entityId
    const done = planningReceiptSchema.parse(await (await send('freeze-done-1', 2, { type: 'completeTask', id: task })).json())
    await api.fixtureGoal(other, 3, { type: 'editGoal', id: goal, title: '目标新名', standards: ['新标准'], categoryLabel: '新分类' })
    const achieved = planningReceiptSchema.parse(await (await send('freeze-goal-1', 4, { type: 'achieveGoal', id: goal, coefficient: 2, reflection: '完成' })).json())
    const growth = await api.request(other, '/api/adventure/growth')
    expect(growth.status).toBe(200)
    const page = await growth.json()
    expect(page).toMatchObject({ growth: { totalXp: 3, actions: 1, achievedGoals: 1 }, items: [
      { id: achieved.result.achievementId, title: '目标新名', categoryLabel: '新分类', amount: 2 },
      { id: done.result.completionId, title: '行动原名', goalTitle: '目标原名', categoryLabel: '原分类', amount: 1 },
    ] })
    const source = await api.request(other, `/api/adventure/reward-source?id=${achieved.result.achievementId}`)
    expect(source.status).toBe(200)
    expect(await source.json()).toMatchObject({ event: { categoryLabel: '新分类' }, actionSources: [{ taskId: task, goalTitle: '目标原名', categoryLabel: '原分类', description: '原说明' }] })
    const taskSource = await api.request(other, `/api/adventure/reward-source?id=${done.result.completionId}`)
    expect(await taskSource.json()).toMatchObject({ event: { goalTitle: '目标原名', categoryLabel: '原分类' }, standards: ['原标准'], description: '原说明' })
    expect(JSON.stringify(page)).not.toMatch(/mainline|主线/i)
  })
})
