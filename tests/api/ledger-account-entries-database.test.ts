import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ledgerAccountReceiptSchema, ledgerAccountsSchema, ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc } from '../support/ledger-database'

const entry = (accountId: string, overrides: Record<string, unknown> = {}) => ({ requestId: crypto.randomUUID(), direction: 'expense', amountCents: -2000, occurredAt: '2025-01-02T03:04:05Z', accountId, categoryCode: 'dining', note: '', ...overrides })
const accounts = async (owner: string) => ledgerAccountsSchema.parse(await (await ledgerRequest(owner, '/api/ledger/accounts')).json())
const createAccount = async (owner: string, balanceCents = 100000, name = '银行卡') => {
  const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents })
  expect(response.status).toBe(200)
  return ledgerAccountReceiptSchema.parse(await response.json()).accountId
}
const write = async (owner: string, input: ReturnType<typeof entry>) => {
  const response = await ledgerRequest(owner, '/api/ledger/entries', input)
  expect(response.status).toBe(200)
  return ledgerReceiptSchema.parse(await response.json())
}
const list = async (owner: string) => ledgerPageSchema.parse(await (await ledgerRequest(owner)).json())
const detail = async (owner: string, id: string) => ledgerDetailSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${id}`)).json())
const patch = (owner: string, id: string, fields: Record<string, unknown>) => ledgerRequest(owner, `/api/ledger/accounts/${id}`, { requestId: crypto.randomUUID(), ...fields }, 'PATCH')
const refund = async (owner: string, id: string, amountCents = 500) => {
  const input = { requestId: crypto.randomUUID(), amountCents, occurredAt: '2025-01-03T00:00:00Z', note: '退款' }
  const response = await ledgerRequest(owner, `/api/ledger/entries/${id}/refunds`, input)
  expect(response.status).toBe(200)
  return ledgerReceiptSchema.parse(await response.json())
}
const preview = async (owner: string, id: string) => ledgerDeletePreviewSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${id}/delete-preview`)).json())
const remove = async (owner: string, id: string, scope: string) => {
  const response = await ledgerRequest(owner, `/api/ledger/entries/${id}/delete`, { scope })
  expect(response.status).toBe(200)
  return ledgerReceiptSchema.parse(await response.json())
}

describe.skipIf(!ledgerRpc)('账户流水：真实 Worker → 隔离 PostgreSQL/PostgREST', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())

  it('普通流水保存账户 ID 并读取账户现名，改名后归属及原请求保持稳定', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    const input = entry(accountId), receipt = await write(owner, input)
    expect((await detail(owner, receipt.entryId)).entry).toMatchObject({ accountId, accountName: '银行卡', transferId: null })
    expect((await patch(owner, accountId, { name: '工资卡' })).status).toBe(200)
    expect((await list(owner)).items).toMatchObject([{ accountId, accountName: '工资卡' }])
    expect((await detail(owner, receipt.entryId)).entry).toMatchObject({ accountId, accountName: '工资卡' })
    expect(await write(owner, input)).toMatchObject({ entryId: receipt.entryId, version: 3 })
  })

  it('收入、支出及补录按当前金额联动；同号并发只入账一次', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    const input = entry(accountId)
    const receipts = await Promise.all(Array.from({ length: 6 }, () => write(owner, input)))
    expect(new Set(receipts.map(value => value.entryId)).size).toBe(1)
    expect(await accounts(owner)).toMatchObject({ version: 2, accounts: [{ balanceCents: 98000 }] })
    await write(owner, entry(accountId, { direction: 'income', amountCents: 5000, categoryCode: 'salary', occurredAt: '2024-01-01T00:00:00Z' }))
    expect(await accounts(owner)).toMatchObject({ version: 3, accounts: [{ balanceCents: 103000 }] })
    expect(await list(owner)).toMatchObject({ total: 2 })
  })

  it('退款继承父支出账户和分类，并增加当前余额与保留关联状态', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    const parent = await write(owner, entry(accountId))
    await patch(owner, accountId, { name: '现名' })
    const child = await refund(owner, parent.entryId)
    expect(await accounts(owner)).toMatchObject({ version: 4, accounts: [{ balanceCents: 98500 }] })
    expect(await detail(owner, child.entryId)).toMatchObject({ entry: { accountId, accountName: '现名', categoryCode: 'dining', parentEntryId: parent.entryId }, parentEntry: { id: parent.entryId, accountName: '现名', status: 'partial-refund' } })
    expect(await detail(owner, parent.entryId)).toMatchObject({ refundedCents: 500, refunds: [{ id: child.entryId }] })
  })

  it('删除父子净额、单删退款及普通收入只撤销确认范围，重复删除不再次入账', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    const parent = await write(owner, entry(accountId)), first = await refund(owner, parent.entryId), second = await refund(owner, parent.entryId, 300)
    await remove(owner, first.entryId, (await preview(owner, first.entryId)).scope)
    expect(await accounts(owner)).toMatchObject({ version: 5, accounts: [{ balanceCents: 98300 }] })
    const scope = (await preview(owner, parent.entryId)).scope
    await Promise.all(Array.from({ length: 5 }, () => remove(owner, parent.entryId, scope)))
    expect(await accounts(owner)).toMatchObject({ version: 6, accounts: [{ balanceCents: 100000 }] })
    expect((await ledgerRequest(owner, `/api/ledger/entries/${second.entryId}`)).status).toBe(404)
    const income = await write(owner, entry(accountId, { direction: 'income', amountCents: 123, categoryCode: 'salary' }))
    await remove(owner, income.entryId, (await preview(owner, income.entryId)).scope)
    expect(await accounts(owner)).toMatchObject({ version: 8, accounts: [{ balanceCents: 100000 }] })
  })

  it('余额联动超限整次拒绝，当前余额、流水、退款与版本保持原值', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner, 99999999999)
    const failed = await ledgerRequest(owner, '/api/ledger/entries', entry(accountId, { direction: 'income', amountCents: 1, categoryCode: 'salary' }))
    expect(failed.status).toBe(409)
    expect(await failed.json()).toMatchObject({ error: { code: 'BALANCE_LIMIT' } })
    expect(await accounts(owner)).toMatchObject({ version: 1, accounts: [{ balanceCents: 99999999999 }] })
    expect(await list(owner)).toMatchObject({ total: 0 })
    const parent = await write(owner, entry(accountId))
    await patch(owner, accountId, { balanceCents: 99999999999, expectedBalanceCents: 99999997999 })
    const rejectedRefund = await ledgerRequest(owner, `/api/ledger/entries/${parent.entryId}/refunds`, { requestId: crypto.randomUUID(), amountCents: 1, occurredAt: '2025-01-03T00:00:00Z', note: '' })
    expect(rejectedRefund.status).toBe(409)
    expect(await rejectedRefund.json()).toMatchObject({ error: { code: 'BALANCE_LIMIT' } })
    const rejectedDelete = await ledgerRequest(owner, `/api/ledger/entries/${parent.entryId}/delete`, { scope: (await preview(owner, parent.entryId)).scope })
    expect(rejectedDelete.status).toBe(409)
    expect(await rejectedDelete.json()).toMatchObject({ error: { code: 'BALANCE_LIMIT' } })
    expect(await accounts(owner)).toMatchObject({ version: 3, accounts: [{ balanceCents: 99999999999 }] })
    expect(await detail(owner, parent.entryId)).toMatchObject({ entry: { status: 'completed' }, refundCount: 0 })
  })

  it('没有账户时列表为空，未知流水的详情、退款及删除均拒绝', async () => {
    const owner = crypto.randomUUID(), parent = crypto.randomUUID(), child = crypto.randomUUID()
    expect(await list(owner)).toMatchObject({ total: 0, items: [], version: 0 })
    expect(await accounts(owner)).toEqual({ accounts: [], version: 0 })
    for (const id of [parent, child]) {
      for (const suffix of ['', '/delete-preview']) expect((await ledgerRequest(owner, `/api/ledger/entries/${id}${suffix}`)).status).toBe(404)
      expect((await ledgerRequest(owner, `/api/ledger/entries/${id}/delete`, { scope: '0'.repeat(64) })).status).toBe(404)
      expect((await ledgerRequest(owner, `/api/ledger/entries/${id}/refunds`, { requestId: crypto.randomUUID(), amountCents: 1, occurredAt: '2025-01-03T00:00:00Z', note: '' })).status).toBe(404)
    }
    await createAccount(owner)
    expect(await accounts(owner)).toMatchObject({ version: 1, accounts: [{ balanceCents: 100000 }] })
  })

  it('手工修正直接校正当前值，1000 减 20、修正 900 后删除支出得到 920', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    const parent = await write(owner, entry(accountId))
    expect((await patch(owner, accountId, { balanceCents: 90000, expectedBalanceCents: 100000 })).status).toBe(409)
    expect((await patch(owner, accountId, { balanceCents: 90000, expectedBalanceCents: 98000 })).status).toBe(200)
    const scope = (await preview(owner, parent.entryId)).scope
    await patch(owner, accountId, { name: '现名' })
    await remove(owner, parent.entryId, scope)
    expect(await accounts(owner)).toMatchObject({ version: 5, accounts: [{ balanceCents: 92000, name: '现名' }] })
  })

  it('父子整组按净额校验边界；负余额允许，低于下限则不消费请求', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner, 0)
    const input = entry(accountId), parent = await write(owner, input)
    await refund(owner, parent.entryId, 2000)
    await patch(owner, accountId, { balanceCents: 99999999999, expectedBalanceCents: 0 })
    await remove(owner, parent.entryId, (await preview(owner, parent.entryId)).scope)
    expect(await accounts(owner)).toMatchObject({ version: 5, accounts: [{ balanceCents: 99999999999 }] })
    await patch(owner, accountId, { balanceCents: -99999999999, expectedBalanceCents: 99999999999 })
    const rejected = entry(accountId, { amountCents: -1 })
    expect((await ledgerRequest(owner, '/api/ledger/entries', rejected)).status).toBe(409)
    expect(await accounts(owner)).toMatchObject({ version: 6, accounts: [{ balanceCents: -99999999999 }] })
    await patch(owner, accountId, { balanceCents: 0, expectedBalanceCents: -99999999999 })
    await write(owner, rejected)
    expect(await accounts(owner)).toMatchObject({ version: 8, accounts: [{ balanceCents: -1 }] })
    expect(await write(owner, input)).toMatchObject({ entryId: parent.entryId, deleted: true, version: 8 })
    expect(await accounts(owner)).toMatchObject({ version: 8, accounts: [{ balanceCents: -1 }] })
  })

  it('拒绝账户名称快照、越权账户及单侧转账，所有者之间互不影响', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), accountId = await createAccount(owner), otherId = await createAccount(other)
    for (const id of [otherId, crypto.randomUUID()]) {
      const response = await ledgerRequest(owner, '/api/ledger/entries', entry(id))
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'ACCOUNT_NOT_FOUND' } })
    }
    for (const fields of [{ accountName: '快照' }, { accountId: null }, { accountId: '名称' }, { categoryCode: 'transfer_out' }, { transferId: crypto.randomUUID() }, { ownerId: other }]) {
      expect((await ledgerRequest(owner, '/api/ledger/entries', entry(accountId, fields))).status).toBe(400)
    }
    const [first, second] = await Promise.all([write(owner, entry(accountId)), write(other, entry(otherId, { amountCents: -100 }))])
    expect((await ledgerRequest(other, `/api/ledger/entries/${first.entryId}`)).status).toBe(404)
    expect(await list(owner)).toMatchObject({ total: 1, items: [{ id: first.entryId, accountId }] })
    expect(await list(other)).toMatchObject({ total: 1, items: [{ id: second.entryId, accountId: otherId }] })
    expect(await accounts(owner)).toMatchObject({ accounts: [{ balanceCents: 98000 }] })
    expect(await accounts(other)).toMatchObject({ accounts: [{ balanceCents: 99900 }] })
  })

  it('版本提交故障回滚流水和账户余额，退款与删除失败也完整回滚', async () => {
    const owner = crypto.randomUUID(), accountId = await createAccount(owner)
    expect((await ledgerRequest(owner, '/api/ledger/entries', entry(accountId, { note: 'ledger91-rollback' }))).status).toBe(503)
    expect(await accounts(owner)).toMatchObject({ version: 1, accounts: [{ balanceCents: 100000 }] })
    expect(await list(owner)).toMatchObject({ total: 0 })
    const parent = await write(owner, entry(accountId, { note: 'ledger94-delete-rollback' }))
    expect((await ledgerRequest(owner, `/api/ledger/entries/${parent.entryId}/refunds`, { requestId: crypto.randomUUID(), amountCents: 500, occurredAt: '2025-01-03T00:00:00Z', note: 'ledger91-rollback' })).status).toBe(503)
    expect(await accounts(owner)).toMatchObject({ version: 2, accounts: [{ balanceCents: 98000 }] })
    await refund(owner, parent.entryId)
    const before = await accounts(owner), scope = (await preview(owner, parent.entryId)).scope
    const response = await ledgerRequest(owner, `/api/ledger/entries/${parent.entryId}/delete`, { scope })
    expect(response.status).toBe(503)
    expect(await accounts(owner)).toEqual(before)
    expect(await detail(owner, parent.entryId)).toMatchObject({ refundCount: 1, entry: { status: 'partial-refund' } })
  })

  it('并发修正与收支以所有者锁串行化，过时修正不覆盖收支', async () => {
    for (let index = 0; index < 8; index++) {
      const owner = crypto.randomUUID(), accountId = await createAccount(owner)
      const [correction, creation] = await Promise.all([
        patch(owner, accountId, { balanceCents: 90000, expectedBalanceCents: 100000 }),
        ledgerRequest(owner, '/api/ledger/entries', entry(accountId)),
      ])
      expect(creation.status).toBe(200)
      expect([200, 409]).toContain(correction.status)
      expect(await accounts(owner)).toMatchObject({ version: correction.status === 200 ? 3 : 2, accounts: [{ balanceCents: correction.status === 200 ? 88000 : 98000 }] })
      expect(await list(owner)).toMatchObject({ total: 1 })
    }
  })
})
