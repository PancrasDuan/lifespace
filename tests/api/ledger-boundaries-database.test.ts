import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ledgerAccountReceiptSchema,
  ledgerAccountsSchema,
  ledgerDeletePreviewSchema,
  ledgerReceiptSchema,
} from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

const adminUrl = process.env.WORKER_TEST_ADMIN_URL
describe.skipIf(!ledgerRpc || !adminUrl)('账单大集合仍由 PostgreSQL 聚合，业务入口保持 REST', () => {
  const admin = new Client({ connectionString: adminUrl! })
  let restore: () => void
  beforeEach(async () => {
    await admin.connect()
    restore = installLedgerDatabase()
  })
  afterEach(async () => {
    restore()
    await admin.end()
  })

  it('一万条退款的删除范围与净余额由数据库聚合，整组删除不改变零净额', async () => {
    const owner = crypto.randomUUID()
    const account = ledgerAccountReceiptSchema.parse(
      await (await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '大量退款', balanceCents: 0 })).json()
    )
    const parent = ledgerReceiptSchema.parse(
      await (
        await ledgerRequest(
          owner,
          '/api/ledger/entries',
          await ordinaryEntry(owner, {
            accountId: account.accountId,
            amountCents: -10000,
            occurredAt: '2026-01-01T00:00:00Z',
            categoryCode: 'dining',
            note: '',
          })
        )
      ).json()
    )
    await admin.query(
      `insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,parent_entry_id)
      select $1,gen_random_uuid(),'income',1,'2026-01-02T00:00:00Z',$2,'dining',repeat('界',500),$3 from generate_series(1,10000)`,
      [owner, account.accountId, parent.entryId]
    )
    await admin.query('update public.ledger_accounts set balance_cents=0 where owner_id=$1', [owner])
    const previewResponse = await ledgerRequest(owner, '/api/ledger/entries/' + parent.entryId + '/delete-preview')
    expect(previewResponse.status).toBe(200)
    const preview = ledgerDeletePreviewSchema.parse(await previewResponse.json())
    expect(preview).toMatchObject({ refundCount: 10000 })
    expect((await ledgerRequest(owner, '/api/ledger/entries/' + parent.entryId + '/delete', { scope: preview.scope })).status).toBe(200)
    const accounts = ledgerAccountsSchema.parse(await (await ledgerRequest(owner, '/api/ledger/accounts')).json())
    expect(accounts).toMatchObject({ accounts: [{ id: account.accountId, balanceCents: 0 }] })
    const deleted = await admin.query('select count(*) from public.ledger_entries where owner_id=$1 and deleted_at is not null', [owner])
    expect(deleted.rows[0].count).toBe('10001')
  }, 20_000)
})
