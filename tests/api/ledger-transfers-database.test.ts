import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ledgerAccountReceiptSchema, ledgerAccountsSchema, ledgerPageSchema, ledgerTransferReceiptSchema, ledgerDetailSchema, ledgerDeletePreviewSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc } from '../support/ledger-database'

const accounts = async (owner: string) => ledgerAccountsSchema.parse(await (await ledgerRequest(owner, '/api/ledger/accounts')).json())
const createAccount = async (owner: string, name: string, balanceCents = 0) => {
  const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents })
  expect(response.status).toBe(200)
  return ledgerAccountReceiptSchema.parse(await response.json()).accountId
}
const input = (fromAccountId: string, toAccountId: string, overrides: Record<string, unknown> = {}) => ({ requestId: crypto.randomUUID(), fromAccountId, toAccountId, amountCents: 10000, occurredAt: '2025-01-02T03:04:05Z', note: '饭卡充值', ...overrides })
const list = async (owner: string) => ledgerPageSchema.parse(await (await ledgerRequest(owner)).json())
const transfer = async (owner: string, value: ReturnType<typeof input>) => {
  const response = await ledgerRequest(owner, '/api/ledger/transfers', value)
  expect(response.status).toBe(200)
  return ledgerTransferReceiptSchema.parse(await response.json())
}
const detail = async (owner: string, id: string) => ledgerDetailSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${id}`)).json())
const preview = async (owner: string, id: string) => ledgerDeletePreviewSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${id}/delete-preview`)).json())
const remove = async (owner: string, id: string, scope: string) => {
  const response = await ledgerRequest(owner, `/api/ledger/entries/${id}/delete`, { scope })
  expect(response.status).toBe(200)
  return ledgerReceiptSchema.parse(await response.json())
}

describe.skipIf(!ledgerRpc)('关联转账：真实 Worker → 隔离 PostgreSQL/PostgREST', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())

  it('零余额也可转账，一次生成两个不同标识的等额相反流水并只推进一个版本', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '银行卡'), to = await createAccount(owner, '饭卡', -500)
    const response = await ledgerRequest(owner, '/api/ledger/transfers', input(from, to))
    expect(response.status).toBe(200)
    const receipt = ledgerTransferReceiptSchema.parse(await response.json())
    expect(receipt).toMatchObject({ version: 3, deleted: false })
    expect(receipt.outEntryId).not.toBe(receipt.inEntryId)
    const entries = await list(owner)
    expect(entries.total).toBe(2)
    expect(entries.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: receipt.outEntryId, accountId: from, transferId: receipt.transferId, direction: 'expense', categoryCode: 'transfer_out', amountCents: -10000, note: '饭卡充值', parentEntryId: null }),
      expect.objectContaining({ id: receipt.inEntryId, accountId: to, transferId: receipt.transferId, direction: 'income', categoryCode: 'transfer_in', amountCents: 10000, note: '饭卡充值', parentEntryId: null }),
    ]))
    expect((await accounts(owner)).accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: from, balanceCents: -10000 }), expect.objectContaining({ id: to, balanceCents: 9500 })]))
  })

  it('从任意一侧查看现名及整组删除；无关写入不失效，重复删除与原请求重试不复活', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '银行卡', 100000), to = await createAccount(owner, '饭卡')
    const value = input(from, to), receipt = await transfer(owner, value)
    expect(await detail(owner, receipt.outEntryId)).toMatchObject({ entry: { id: receipt.outEntryId }, transferEntry: { id: receipt.inEntryId, accountName: '饭卡' }, refundCount: 0 })
    expect(await detail(owner, receipt.inEntryId)).toMatchObject({ transferEntry: { id: receipt.outEntryId, accountName: '银行卡' } })
    const out = await preview(owner, receipt.outEntryId), incoming = await preview(owner, receipt.inEntryId)
    expect(out.transferEntry?.id).toBe(receipt.inEntryId)
    expect(incoming.transferEntry?.id).toBe(receipt.outEntryId)
    expect(incoming.scope).toBe(out.scope)
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.outEntryId}/delete`, { scope: '0'.repeat(64) })).status).toBe(409)
    expect(await list(owner)).toMatchObject({ total: 2, version: 3 })
    await createAccount(owner, '无关账户')
    expect((await ledgerRequest(owner, `/api/ledger/accounts/${to}`, { requestId: crypto.randomUUID(), name: '新饭卡' }, 'PATCH')).status).toBe(200)
    expect((await detail(owner, receipt.outEntryId)).transferEntry?.accountName).toBe('新饭卡')
    await Promise.all([remove(owner, receipt.inEntryId, incoming.scope), remove(owner, receipt.outEntryId, out.scope)])
    expect(await list(owner)).toMatchObject({ total: 0, version: 6 })
    expect((await accounts(owner)).accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: from, balanceCents: 100000 }), expect.objectContaining({ id: to, balanceCents: 0 })]))
    expect(await transfer(owner, value)).toEqual({ ...receipt, deleted: true, version: 6 })
    for (const id of [receipt.outEntryId, receipt.inEntryId]) expect((await ledgerRequest(owner, `/api/ledger/entries/${id}`)).status).toBe(404)
    expect((await accounts(owner)).version).toBe(6)
  })

  it('同号并发只转账一次，不同原输入及与普通流水或退款复用请求号均拒绝', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '转出'), to = await createAccount(owner, '转入')
    const value = input(from, to), receipts = await Promise.all(Array.from({ length: 8 }, () => transfer(owner, value)))
    expect(new Set(receipts.map(item => item.transferId)).size).toBe(1)
    expect(await list(owner)).toMatchObject({ total: 2, version: 3 })
    for (const change of [{ fromAccountId: to, toAccountId: from }, { amountCents: 9999 }, { occurredAt: '2025-01-02T03:04:04Z' }, { note: '另一笔' }]) {
      const response = await ledgerRequest(owner, '/api/ledger/transfers', { ...value, ...change })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    const ordinary = { requestId: value.requestId, accountId: from, direction: 'expense', categoryCode: 'dining', amountCents: -10000, occurredAt: value.occurredAt, note: value.note }
    expect((await ledgerRequest(owner, '/api/ledger/entries', ordinary)).status).toBe(409)
    const another = { ...ordinary, requestId: crypto.randomUUID() }
    const saved = ledgerReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries', another)).json())
    expect((await ledgerRequest(owner, '/api/ledger/transfers', { ...value, requestId: another.requestId })).status).toBe(409)
    expect((await ledgerRequest(owner, `/api/ledger/entries/${saved.entryId}/refunds`, { requestId: value.requestId, amountCents: 10000, occurredAt: value.occurredAt, note: value.note })).status).toBe(409)
  })

  it('拒绝相同账户、无效金额、客户端指定关联、单侧新建及转账退款，零负余额可继续转出', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '转出'), to = await createAccount(owner, '转入', -1)
    for (const fields of [{ toAccountId: from }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 0.1 }, { amountCents: 100000000000 }, { transferId: crypto.randomUUID() }, { ownerId: crypto.randomUUID() }, { note: '文'.repeat(501) }]) {
      expect((await ledgerRequest(owner, '/api/ledger/transfers', input(from, to, fields))).status).toBe(400)
    }
    expect((await ledgerRequest(owner, '/api/ledger/transfers?owner=other', input(from, to))).status).toBe(400)
    expect((await ledgerRequest(owner, '/api/ledger/transfers', input(from, to, { occurredAt: '9999-01-01T00:00:00Z' }))).status).toBe(400)
    for (const [direction, categoryCode, amountCents] of [['expense', 'transfer_out', -1], ['income', 'transfer_in', 1]]) {
      expect((await ledgerRequest(owner, '/api/ledger/entries', { requestId: crypto.randomUUID(), accountId: from, direction, categoryCode, amountCents, occurredAt: '2025-01-02T03:04:05Z', note: '' })).status).toBe(400)
    }
    const receipt = await transfer(owner, input(from, to))
    for (const id of [receipt.outEntryId, receipt.inEntryId]) {
      const response = await ledgerRequest(owner, `/api/ledger/entries/${id}/refunds`, { requestId: crypto.randomUUID(), amountCents: 1, occurredAt: '2025-01-03T00:00:00Z', note: '' })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REFUND_PARENT_INVALID' } })
    }
    await transfer(owner, input(from, to, { note: undefined }))
    expect(await list(owner)).toMatchObject({ version: 4, total: 4 })
    expect((await accounts(owner)).accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: from, balanceCents: -20000 }), expect.objectContaining({ id: to, balanceCents: 19999 })]))
  })

  it('越权账户、流水、关联、删除和退款均拒绝，其他所有者不受影响', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), from = await createAccount(owner, '转出'), to = await createAccount(owner, '转入'), foreign = await createAccount(other, '他人')
    for (const value of [input(from, foreign), input(foreign, to), input(from, crypto.randomUUID())]) expect((await ledgerRequest(owner, '/api/ledger/transfers', value)).status).toBe(404)
    const receipt = await transfer(owner, input(from, to))
    for (const id of [receipt.outEntryId, receipt.inEntryId]) {
      for (const suffix of ['', '/delete-preview']) expect((await ledgerRequest(other, `/api/ledger/entries/${id}${suffix}`)).status).toBe(404)
      expect((await ledgerRequest(other, `/api/ledger/entries/${id}/delete`, { scope: (await preview(owner, id)).scope })).status).toBe(404)
      expect((await ledgerRequest(other, `/api/ledger/entries/${id}/refunds`, { requestId: crypto.randomUUID(), amountCents: 1, occurredAt: '2025-01-03T00:00:00Z', note: '' })).status).toBe(404)
    }
    expect(await accounts(other)).toMatchObject({ version: 1, accounts: [{ balanceCents: 0 }] })
    expect(await list(other)).toMatchObject({ total: 0 })
  })

  it('任一侧余额超限全部回滚，修正后原请求可重试；删除超限保留整组', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '转出'), to = await createAccount(owner, '转入', 99999999999)
    const value = input(from, to, { amountCents: 1 }), before = await accounts(owner)
    const response = await ledgerRequest(owner, '/api/ledger/transfers', value)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'BALANCE_LIMIT' } })
    expect(await accounts(owner)).toEqual(before)
    expect(await list(owner)).toMatchObject({ total: 0, version: 2 })
    await ledgerRequest(owner, `/api/ledger/accounts/${to}`, { requestId: crypto.randomUUID(), balanceCents: 0, expectedBalanceCents: 99999999999 }, 'PATCH')
    const receipt = await transfer(owner, value)
    await ledgerRequest(owner, `/api/ledger/accounts/${from}`, { requestId: crypto.randomUUID(), balanceCents: 99999999999, expectedBalanceCents: -1 }, 'PATCH')
    const snapshot = await accounts(owner), scope = (await preview(owner, receipt.inEntryId)).scope
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.inEntryId}/delete`, { scope })).status).toBe(409)
    expect(await accounts(owner)).toEqual(snapshot)
    expect(await list(owner)).toMatchObject({ total: 2, version: 5 })
  })

  it('第二条流水及版本写入故障、删除版本故障均回滚两侧流水与余额', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '转出', 100000), to = await createAccount(owner, '转入')
    const before = await accounts(owner)
    for (const note of ['ledger121-second-side-failure', 'ledger91-rollback']) {
      expect((await ledgerRequest(owner, '/api/ledger/transfers', input(from, to, { note }))).status).toBe(503)
      expect(await accounts(owner)).toEqual(before)
      expect(await list(owner)).toMatchObject({ total: 0, version: 2 })
    }
    const receipt = await transfer(owner, input(from, to, { note: 'ledger94-delete-rollback' })), snapshot = await accounts(owner)
    const scope = (await preview(owner, receipt.outEntryId)).scope
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.outEntryId}/delete`, { scope })).status).toBe(503)
    expect(await accounts(owner)).toEqual(snapshot)
    expect(await list(owner)).toMatchObject({ total: 2, version: 3 })
    expect((await detail(owner, receipt.outEntryId)).transferEntry?.id).toBe(receipt.inEntryId)
  })

  it('并发不同转账串行核对余额上界，只有一组提交且另一请求可在修正后重试', async () => {
    const owner = crypto.randomUUID(), from = await createAccount(owner, '转出'), to = await createAccount(owner, '转入', 99999999998)
    const values = [input(from, to, { amountCents: 1 }), input(from, to, { amountCents: 1 })]
    const responses = await Promise.all(values.map(value => ledgerRequest(owner, '/api/ledger/transfers', value)))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(await list(owner)).toMatchObject({ total: 2, version: 3 })
    expect((await accounts(owner)).accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: from, balanceCents: -1 }), expect.objectContaining({ id: to, balanceCents: 99999999999 })]))
    await ledgerRequest(owner, `/api/ledger/accounts/${to}`, { requestId: crypto.randomUUID(), balanceCents: 0, expectedBalanceCents: 99999999999 }, 'PATCH')
    await transfer(owner, values[responses.findIndex(response => response.status === 409)])
    expect(await list(owner)).toMatchObject({ total: 4, version: 5 })
    await ledgerRequest(owner, `/api/ledger/accounts/${from}`, { requestId: crypto.randomUUID(), balanceCents: -99999999999, expectedBalanceCents: -2 }, 'PATCH')
    const before = await accounts(owner)
    expect((await ledgerRequest(owner, '/api/ledger/transfers', input(from, to, { amountCents: 1 }))).status).toBe(409)
    expect(await accounts(owner)).toEqual(before)
    expect(await list(owner)).toMatchObject({ total: 4, version: 6 })
  })
})
