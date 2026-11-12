import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const fixture = process.env.ADVENTURE_MIGRATED_FIXTURE ? z.object({
  receipts: z.array(z.object({ owner_id: z.uuid(), request_id: z.string(), command: z.record(z.string(), z.unknown()), receipt: z.unknown() })),
}).parse(JSON.parse(process.env.ADVENTURE_MIGRATED_FIXTURE)) : undefined
const db = planningDatabase('migrated-task@example.invalid')
describe.skipIf(!localPlanningRpc || !fixture)('迁移后的只读历史回执', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('安全结果按账户和摘要返回，冲突、无法安全重放和删除历史均不执行', async () => {
    const row = fixture!.receipts.find(item => item.request_id === 'rpc-complete-task')!
    const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command }
    const before = await (await db.request(row.owner_id, '/api/adventure/growth')).json()
    const found = await db.request(row.owner_id, '/api/adventure/receipts/lookup', envelope, null)
    expect(found.status).toBe(200)
    const receipt = planningReceiptSchema.parse(await found.json())
    expect(receipt).toEqual(planningReceiptSchema.parse(row.receipt))
    expect(JSON.stringify(receipt)).not.toMatch(/mainline|主线/i)
    const conflict = await db.request(row.owner_id, '/api/adventure/receipts/lookup', { ...envelope, command: { type: 'deleteTask', id: receipt.result.entityId } }, null)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    for (const id of ['unsafe-cn-receipt', 'unsafe-en-receipt']) {
      const unsafe = fixture!.receipts.find(item => item.request_id === id)!
      const response = await db.request(unsafe.owner_id, '/api/adventure/receipts/lookup', { requestId: id, expectedVersion: 0, command: unsafe.command }, null)
      expect(response.status).toBe(409)
      const error = await response.json()
      expect(error).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      expect(JSON.stringify(error)).not.toMatch(/mainline|主线/i)
    }
    const removed = await db.request('00000000-0000-4000-8000-000000000005', '/api/adventure/receipts/lookup', { requestId: 'replay-mainline', expectedVersion: 0, command: { type: 'createMainline', name: '旧方向' } }, null)
    expect(removed.status).toBe(404)
    expect(await removed.json()).toMatchObject({ error: { code: 'RECEIPT_UNKNOWN' } })
    expect(await (await db.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
  })
})
