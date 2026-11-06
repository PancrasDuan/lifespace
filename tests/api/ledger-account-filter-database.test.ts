import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ledgerAccountReceiptSchema, ledgerPageSchema, ledgerReceiptSchema, ledgerTransferReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

describe.skipIf(!ledgerRpc)('账户筛选：Worker 与隔离数据库', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  it('按账户和日期在分页前筛选，保留退款及对应转账侧，并隔离所有者', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const account = async (who: string, name: string) => ledgerAccountReceiptSchema.parse(await (await ledgerRequest(who, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents: 0 })).json()).accountId
    const a = await account(owner, '银行卡'), b = await account(owner, '饭卡'), foreign = await account(other, '其他')
    const parent = ledgerReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: a, amountCents: -10000 }))).json())
    const refund = ledgerReceiptSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${parent.entryId}/refunds`, { requestId: crypto.randomUUID(), amountCents: 1000, occurredAt: '2026-01-02T03:04:05Z', note: '' })).json())
    const transfer = ledgerTransferReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/transfers', { requestId: crypto.randomUUID(), fromAccountId: a, toAccountId: b, amountCents: 1000, occurredAt: '2026-01-02T03:04:05Z', note: '' })).json())
    for (let i = 0; i < 31; i++) expect((await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: b, note: `饭卡${i}` }))).status).toBe(200)
    await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: a, occurredAt: '2025-01-02T03:04:05Z' }))
    const read = async (query: string) => {
      const response = await ledgerRequest(owner, `/api/ledger/entries?${query}`)
      expect(response.status).toBe(200)
      return ledgerPageSchema.parse(await response.json())
    }
    const date = 'startDate=2026-01-02&endDate=2026-01-02'
    const first = await read(`accountId=${a}&${date}`)
    expect(first.total).toBe(3)
    expect(first.items.map(item => item.id).sort()).toEqual([parent.entryId, refund.entryId, transfer.outEntryId].sort())
    const page1 = await read(`accountId=${b}&${date}`)
    const page2 = await read(`accountId=${b}&${date}&page=2&version=${page1.version}`)
    expect([page1.total, page1.items.length, page2.items.length]).toEqual([32, 30, 2])
    expect([...page1.items, ...page2.items].map(item => item.id)).toContain(transfer.inEntryId)
    expect(new Set([...page1.items, ...page2.items].map(item => item.id)).size).toBe(32)
    expect((await read(`accountId=${foreign}`)).total).toBe(0)
    expect((await read(date)).total).toBe(35)
    for (const query of ['accountId=', 'accountId=bad', `accountId=${a}&accountId=${b}`]) expect((await ledgerRequest(owner, `/api/ledger/entries?${query}`)).status).toBe(400)
    await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: a }))
    expect((await ledgerRequest(owner, `/api/ledger/entries?accountId=${b}&version=${page1.version}`)).status).toBe(409)
  })
})
