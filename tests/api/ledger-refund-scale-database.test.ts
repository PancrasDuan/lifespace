import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc } from '../support/ledger-database'

const owner = process.env.LEDGER_REFUND_SCALE_OWNER
const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
describe.skipIf(!ledgerRpc || !owner)('十万条含退款事实：派生、关联与删除范围真实 HTTP', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  it('有效退款决定状态，深页／跨日期关联／只读范围稳定，父子删除只加一个版本', async () => {
    const observations: { path: string; ms: number; status: number }[] = []
    const request = async (path: string, body?: unknown) => {
      const start = performance.now(), response = await ledgerRequest(owner!, '/api/ledger/entries' + path, body)
      observations.push({ path, ms: performance.now() - start, status: response.status })
      expect(response.status).toBe(200)
      return response.json()
    }
    const first = ledgerPageSchema.parse(await request('?page=1'))
    expect(first).toMatchObject({ total: 70000, version: 100000, pageSize: 30 })
    const query = '?page=2334&version=100000'
    const last = ledgerPageSchema.parse(await request(query))
    expect(last.items.map(entry => entry.id)).toEqual([10,9,8,7,6,5,4,3,2,1].map(n => id(2, n)))
    expect(last.items.map(entry => entry.status)).toEqual(['partial-refund','full-refund','completed','partial-refund','full-refund','completed','partial-refund','full-refund','completed','partial-refund'])
    for (let n = 0; n < 4; n++) expect(await request(query)).toEqual(last)
    const date = ledgerPageSchema.parse(await request('?page=334&startDate=2024-01-01&endDate=2024-01-01&version=100000'))
    expect(date).toMatchObject({ total: 40000, version: 100000 })
    expect(date.items.find(entry => entry.id === id(2, 30000))?.status).toBe('full-refund')
    expect(date.items.find(entry => entry.id === id(2, 29999))?.status).toBe('completed')
    expect(date.items.find(entry => entry.id === id(2, 29998))?.status).toBe('partial-refund')
    const parent = ledgerDetailSchema.parse(await request('/' + id(2, 30000)))
    expect(parent).toMatchObject({ entry: { amountCents: -100, status: 'full-refund' }, refunds: [{ amountCents: 70 }, { amountCents: 30 }] })
    const child = ledgerDetailSchema.parse(await request('/' + id(3, 30000)))
    expect(child.parentEntry?.id).toBe(id(2, 30000))
    expect(child.entry.occurredAt).toBe('2024-02-01T00:20:00.000Z')
    expect(child.parentEntry?.occurredAt).toBe('2024-01-01T00:20:00.000Z')
    const preview = ledgerDeletePreviewSchema.parse(await request('/' + id(2, 30000) + '/delete-preview'))
    expect(preview).toMatchObject({ refundCount: 2, version: 100000 })
    for (let n = 0; n < 4; n++) {
      expect(await request('/' + id(2, 30000))).toEqual(parent)
      expect(await request('/' + id(3, 30000))).toEqual(child)
      expect(await request('/' + id(2, 30000) + '/delete-preview')).toEqual(preview)
    }
    const receipt = ledgerReceiptSchema.parse(await request('/' + id(2, 30000) + '/delete', { scope: preview.scope }))
    expect(receipt).toMatchObject({ deleted: true, version: 100001 })
    expect(ledgerPageSchema.parse(await request('?page=1'))).toMatchObject({ total: 69997, version: 100001 })
    expect(await request('/' + id(2, 30000) + '/delete', { scope: preview.scope })).toEqual(receipt)
    for (const target of [id(2,30000), id(3,30000), id(4,30000)]) expect((await ledgerRequest(owner!, '/api/ledger/entries/' + target)).status).toBe(404)
    await writeFile(process.env.LEDGER_REFUND_SCALE_HTTP_REPORT || '.cache/ledger-refund-scale-http.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows: 100000, activeRowsBefore: 70000, activeRowsAfter: 69997, observations }, null, 2))
  })
})
