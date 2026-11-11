import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const fixtureSchema = z.object({
  receipts: z.array(z.object({ owner_id: z.uuid(), request_id: z.string(), command: z.record(z.string(), z.unknown()), receipt: z.unknown() })),
  locks: z.array(z.object({ owner_id: z.uuid(), completion_id: z.uuid(), unlocked_completion_id: z.uuid(), invalidated_completion_id: z.uuid(), expected_version: z.coerce.number() })),
})
const fixture = process.env.ADVENTURE_MIGRATED_FIXTURE ? fixtureSchema.parse(JSON.parse(process.env.ADVENTURE_MIGRATED_FIXTURE)) : undefined
const api = planningDatabase('migrated-task@example.invalid')

describe.skipIf(!localPlanningRpc || !fixture)('旧库迁移后的真实 Worker 任务回执与历史锁定', () => {
  beforeEach(() => api.install())
  afterEach(() => api.restore())

  it('有效及已失效的旧完成和旧任务命令安全重放，摘要冲突不能重新执行', async () => {
    for (const id of ['rpc-move-task', 'rpc-complete-task', 'rpc-complete-cancel', 'rpc-cancel-task', 'legacy-reschedule', 'legacy-migrate-task', 'legacy-end-task']) {
      const row = fixture!.receipts.find(item => item.request_id === id)!
      if (id === 'rpc-complete-task') expect(row.receipt).toMatchObject({ result: { mainlineName: '旧方向', source: { goalTitle: '保留的旧名称' } } })
      const expected = planningReceiptSchema.parse(row.receipt)
      const response = await api.request(row.owner_id, '/api/adventure/commands', { requestId: id, expectedVersion: 0, command: row.command })
      expect(response.status, id).toBe(200)
      const actual = await response.json()
      expect(actual, id).toEqual(expected)
      expect(JSON.stringify(actual), id).not.toMatch(/mainline|主线/i)
      const conflict = await api.request(row.owner_id, '/api/adventure/commands', { requestId: id, expectedVersion: 0, command: { type: 'deleteTask', id: expected.result.entityId } })
      expect(conflict.status, id).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    const owner = fixture!.receipts.find(item => item.request_id === 'rpc-complete-cancel')!.owner_id
    const growth = await api.request(owner, '/api/adventure/growth')
    expect(growth.status).toBe(200)
    expect(await growth.json()).toMatchObject({ version: 10, growth: { totalXp: 4, actions: 1, achievedGoals: 1 }, total: 2 })
  })

  it('旧奖励来源保留发生时非主线事实，不从当前目标补写分类', async () => {
    const row = fixture!.receipts.find(item => item.request_id === 'rpc-achieve-goal')!
    const receipt = planningReceiptSchema.parse(row.receipt)
    const response = await api.request(row.owner_id, `/api/adventure/reward-source?id=${receipt.result.achievementId}`)
    expect(response.status).toBe(200)
    const source = await response.json()
    expect(source).toMatchObject({ event: { title: 'RPC成果', categoryLabel: null, amount: 3 }, reflection: '冻结评价', standards: ['成果标准'], totalSources: 1,
      actionSources: [{ title: 'RPC迁移任务', goalTitle: 'RPC成果', categoryLabel: null, description: '原始说明' }] })
    expect(JSON.stringify(source)).not.toMatch(/mainline|主线/i)
    expect((await api.request(crypto.randomUUID(), `/api/adventure/reward-source?id=${receipt.result.achievementId}`)).status).toBe(404)
  })

  it('原归属已结束的完成不可撤销，其他完成仍可撤销且旧失效回执不复活', async () => {
    const lock = fixture!.locks[0]
    const growthBefore = await (await api.request(lock.owner_id, '/api/adventure/growth')).json()
    const denied = await api.request(lock.owner_id, '/api/adventure/commands', { requestId: 'lock-http-cancel', expectedVersion: lock.expected_version, command: { type: 'cancelTaskCompletion', completionId: lock.completion_id } })
    expect(denied.status).toBe(400)
    expect(await denied.json()).toMatchObject({ error: { code: 'READ_ONLY' } })
    expect(await (await api.request(lock.owner_id, '/api/adventure/growth')).json()).toEqual(growthBefore)
    const cancel = await api.request(lock.owner_id, '/api/adventure/commands', { requestId: 'unlock-http-cancel', expectedVersion: lock.expected_version, command: { type: 'cancelTaskCompletion', completionId: lock.unlocked_completion_id } })
    expect(cancel.status).toBe(200)
    const growthAfter = await (await api.request(lock.owner_id, '/api/adventure/growth')).json()
    expect(growthAfter).toMatchObject({ version: lock.expected_version + 1, growth: { totalXp: 1, actions: 1 } })
    const source = await api.request(lock.owner_id, `/api/adventure/reward-source?id=${lock.completion_id}`)
    expect(source.status).toBe(200)
    expect(await source.json()).toMatchObject({ event: { id: lock.completion_id, categoryLabel: null, title: '历史锁定任务' } })
    expect(JSON.stringify(growthAfter)).not.toMatch(/mainline|主线/i)
  })
})
