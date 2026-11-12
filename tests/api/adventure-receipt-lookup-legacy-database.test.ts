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
    const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command, nonce: 'a'.repeat(64) }
    const before = await (await db.request(row.owner_id, '/api/adventure/growth')).json()
    const found = await db.request(row.owner_id, '/api/adventure/receipts/lookup', envelope, null)
    expect(found.status).toBe(200)
    const linked = await found.json() as { requestId: string; nonce: string; receipt: unknown }
    expect(linked).toMatchObject({ requestId: envelope.requestId, nonce: envelope.nonce })
    const receipt = planningReceiptSchema.parse(linked.receipt)
    expect(receipt).toEqual(planningReceiptSchema.parse(row.receipt))
    expect(JSON.stringify(receipt)).not.toMatch(/mainline|主线/i)
    const conflict = await db.request(row.owner_id, '/api/adventure/receipts/lookup', { ...envelope, command: { type: 'deleteTask', id: receipt.result.entityId } }, null)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    for (const id of ['unsafe-cn-receipt', 'unsafe-en-receipt']) {
      const unsafe = fixture!.receipts.find(item => item.request_id === id)!
      const response = await db.request(unsafe.owner_id, '/api/adventure/receipts/lookup', { requestId: id, expectedVersion: 0, command: unsafe.command, nonce: envelope.nonce }, null)
      expect(response.status).toBe(409)
      const error = await response.json()
      expect(error).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      expect(JSON.stringify(error)).not.toMatch(/mainline|主线/i)
    }
    const removed = await db.request('00000000-0000-4000-8000-000000000005', '/api/adventure/receipts/lookup', { requestId: 'replay-mainline', expectedVersion: 0, command: { type: 'createMainline', name: '旧方向' }, nonce: envelope.nonce }, null)
    expect(removed.status).toBe(404)
    expect(await removed.json()).toMatchObject({ error: { code: 'RECEIPT_UNKNOWN' } })
    expect(await (await db.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
  })

  it('已知字段类型错误时两个入口均明确拒绝且不修改账户', async () => {
    const row = fixture!.receipts.find(item => item.request_id === 'unsafe-source-type')!
    const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command }
    const before = await (await db.request(row.owner_id, '/api/adventure/growth')).json()
    for (const [path, body] of [
      ['/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }],
      ['/api/adventure/commands', envelope],
    ] as const) {
      const response = await db.request(row.owner_id, path, body, path.endsWith('/lookup') ? null : undefined)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
    }
    expect(await (await db.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
  })

  for (const [index, source, expected] of [
    [0, { goalId: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' }, { goalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    [1, { goalId: 'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA' }, { goalId: 'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA' }],
    [2, { goalId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }, { goalId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }],
    [3, { goalId: '00000000-0000-0000-0000-000000000000' }, { goalId: '00000000-0000-0000-0000-000000000000' }],
    [4, { goalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, { goalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    [5, { plannedOn: '0000-01-01' }, { plannedOn: '0000-01-01' }],
    [6, { plannedOn: '0001-01-01' }, { plannedOn: '0001-01-01' }],
    [7, { occurredOn: '9999-12-31' }, { occurredOn: '9999-12-31' }],
    [8, { plannedOn: '0000-02-30' }, null],
    [9, { goalId: 'not-a-uuid' }, null],
    [10, { plannedOn: '0000-02-29' }, { plannedOn: '0000-02-29' }],
    [11, { plannedOn: '1900-02-29' }, null],
    [12, { plannedOn: '2000-02-29' }, { plannedOn: '2000-02-29' }],
    [13, { plannedOn: '0000-13-01' }, null],
  ] as const) {
    it(`合成回执边界 ${index} 在两个 Worker 入口保持安全，账户不变`, async () => {
      const row = fixture!.receipts.find(item => item.request_id === `boundary-receipt-${index}`)!
      const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command }
      const before = await (await db.request(row.owner_id, '/api/adventure/growth')).json()
      const observed: Array<{ path: string; status: number; body: unknown }> = []
      for (const [path, body] of [
        ['/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }],
        ['/api/adventure/commands', envelope],
      ] as const) {
        const response = await db.request(row.owner_id, path, body, path.endsWith('/lookup') ? null : undefined)
        observed.push({ path, status: response.status, body: await response.json() })
      }
      expect(await (await db.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
      expect(observed.map(result => result.status), JSON.stringify(source)).toEqual([expected ? 200 : 409, expected ? 200 : 409])
      for (const result of observed) {
        if (expected) {
          const value = result.body as { receipt?: { result: { source: unknown } }; result?: { source: unknown } }
          expect(result.path.endsWith('/lookup') ? value.receipt?.result.source : value.result?.source).toEqual(expected)
        } else expect(result.body).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      }
    })
  }

  for (const [index, expectedResult] of [
    [14, { entityId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    [15, { reward: { amount: 1, calculation: { type: 'fixed_task', completionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', count: 1, coefficient: 1 } } }],
    [16, { reward: { amount: 1, calculation: { type: 'goal_actions', actionIds: ['ffffffff-ffff-ffff-ffff-ffffffffffff'], count: 1, coefficient: 1, fallback: false } } }],
    [17, null],
  ] as const) {
    it(`回执字段边界 ${index} 经两个 Worker 入口安全处理`, async () => {
      const row = fixture!.receipts.find(item => item.request_id === `boundary-receipt-${index}`)!
      const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command }
      const before = await (await db.request(row.owner_id, '/api/adventure/growth')).json()
      for (const [path, body] of [
        ['/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }],
        ['/api/adventure/commands', envelope],
      ] as const) {
        const response = await db.request(row.owner_id, path, body, path.endsWith('/lookup') ? null : undefined)
        expect(response.status).toBe(expectedResult ? 200 : 409)
        const value = await response.json() as { receipt?: { result: unknown }; result?: unknown; error?: unknown }
        if (expectedResult) expect(path.endsWith('/lookup') ? value.receipt?.result : value.result).toMatchObject(expectedResult)
        else expect(value).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      }
      expect(await (await db.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
    })
  }
})
