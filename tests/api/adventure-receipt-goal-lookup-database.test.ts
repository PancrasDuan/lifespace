import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const fixture = process.env.GOAL_REPLAY_FIXTURE ? z.object({
  owner: z.uuid(), create: z.record(z.string(), z.unknown()), edit: z.record(z.string(), z.unknown()), created: z.unknown(), edited: z.unknown(),
  orderOwner: z.uuid(), oldOrder: z.record(z.string(), z.unknown()), orderReceipt: z.unknown(),
}).parse(JSON.parse(process.env.GOAL_REPLAY_FIXTURE)) : undefined
const db = planningDatabase()
describe.skipIf(!localPlanningRpc || !fixture)('旧目标封套只读查询', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('旧创建、编辑及按主线排序封套沿用旧规范化读取原回执', async () => {
    for (const [owner, requestId, command, receipt] of [
      [fixture!.owner, 'legacy-create-171', fixture!.create, fixture!.created],
      [fixture!.owner, 'legacy-edit-171', fixture!.edit, fixture!.edited],
      [fixture!.orderOwner, 'order-replay-a', fixture!.oldOrder, fixture!.orderReceipt],
    ] as const) {
      const nonce = 'a'.repeat(64)
      const response = await db.request(owner, '/api/adventure/receipts/lookup', { requestId, expectedVersion: 0, command, nonce }, null)
      expect(response.status, requestId).toBe(200)
      const actual = await response.json()
      expect(actual).toEqual({ requestId, nonce, receipt })
      expect(JSON.stringify(actual)).not.toMatch(/mainline|主线/i)
    }
  })
})
