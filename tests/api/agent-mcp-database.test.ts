import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { oauthFixture, oauthOther, oauthOwner } from '../support/mcp-oauth'
import { installLedgerDatabase, ledgerTestAccount, ledgerRequest, ordinaryEntry } from '../support/ledger-database'
import { mcpScopes } from '../../worker/mcp-oauth-config'
import { ledgerAccountsSchema, ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerErrors, ledgerLimits, ledgerPageSchema, ledgerReceiptSchema, ledgerTransferReceiptSchema } from '../../src/shared/ledger'

const rpcUrl = process.env.LEDGER_LOCAL_RPC_URL
// Separate owners keep the OAuth database suite's balances and versions isolated.
const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
let fixture: ReturnType<typeof oauthFixture>
let accessToken: string
let restore: () => void

async function call(name: string, args: object) {
  const response = await fixture.request('/api/agent/mcp', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const body = await response.json() as { result: { isError?: boolean; structuredContent: Record<string, unknown>; content: Array<{ text: string }> } }
  expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent)
  return body
}
const refundInput = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, requestId: crypto.randomUUID(), amountCents: 300, occurredAt: '2026-01-02T03:04:05Z', note: '退款', ...overrides,
})
async function parent(overrides: Record<string, unknown> = {}) {
  const accountId = await ledgerTestAccount(owner, '退款 ' + crypto.randomUUID())
  const input = await ordinaryEntry(owner, { accountId, amountCents: -1000, categoryCode: 'dining', ...overrides })
  const result = await call('create_ledger_entry', input)
  expect(result.result.isError).toBeUndefined()
  return { ...ledgerReceiptSchema.parse(result.result.structuredContent), input }
}
async function refund(input: object) {
  const result = await call('create_ledger_refund', input)
  expect(result.result.isError).toBeUndefined()
  return ledgerReceiptSchema.parse(result.result.structuredContent)
}
async function detail(id: string) {
  const response = await ledgerRequest(owner, '/api/ledger/entries/' + id)
  expect(response.status).toBe(200)
  return ledgerDetailSchema.parse(await response.json())
}
async function accounts() {
  return ledgerAccountsSchema.parse((await call('list_ledger_accounts', {})).result.structuredContent)
}
async function list(args: object = {}) {
  const response = await call('list_ledger_entries', args)
  expect(response.result.isError).toBeUndefined()
  return ledgerPageSchema.parse(response.result.structuredContent)
}
async function entryDetail(args: object) {
  const response = await call('get_ledger_entry', args)
  expect(response.result.isError).toBeUndefined()
  return ledgerDetailSchema.parse(response.result.structuredContent)
}
async function remove(id: string) {
  const preview = ledgerDeletePreviewSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries/' + id + '/delete-preview')).json())
  const response = await ledgerRequest(owner, '/api/ledger/entries/' + id + '/delete', { scope: preview.scope })
  expect(response.status).toBe(200)
}
async function expectError(input: object, code: string) {
  expect((await call('create_ledger_refund', input)).result).toMatchObject({ isError: true, structuredContent: { error: { code } } })
}

describe.skipIf(!rpcUrl)('Agent 通过真实隔离账单数据库操作', () => {
  beforeAll(async () => {
    const target = new URL(rpcUrl!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('仅允许本机隔离数据库')
    restore = installLedgerDatabase()
    fixture = oauthFixture(rpcUrl)
    fixture.users.set(owner, { ...fixture.users.get(oauthOwner)!, id: owner })
    accessToken = (await fixture.issue((await fixture.client()).clientId, mcpScopes, owner)).access_token
  })
  afterAll(() => { vi.unstubAllGlobals(); restore?.() })

  it('创建同一流水的重试只更新一次余额，不能使用他人账户', async () => {
    const accountId = await ledgerTestAccount(owner, 'Agent 测试账户')
    const otherAccountId = await ledgerTestAccount(other, '其他测试账户')
    const entry = { requestId: '00000000-0000-4000-8000-000000000091', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId, categoryCode: 'dining', note: '午饭' }
    const first = await call('create_ledger_entry', entry)
    const retry = await call('create_ledger_entry', entry)
    expect(retry.result.structuredContent).toEqual(first.result.structuredContent)
    const foreign = await call('create_ledger_entry', { ...entry, requestId: '00000000-0000-4000-8000-000000000092', accountId: otherAccountId })
    expect(foreign.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'ACCOUNT_NOT_FOUND' } } })
    const accounts = await call('list_ledger_accounts', {})
    expect(accounts.result.structuredContent).toMatchObject({ accounts: [{ id: accountId, balanceCents: -3500 }] })
  })

  it('退款追加收入，继承父账户和分类，原支出金额不变并推进当前余额', async () => {
    const original = await parent()
    const input = refundInput(original.entryId, { note: '  ' + '😀'.repeat(500) + '  ' })
    const receipt = await refund(input)
    expect(await detail(receipt.entryId)).toMatchObject({
      entry: { direction: 'income', amountCents: 300, accountId: original.input.accountId, categoryCode: 'dining', parentEntryId: original.entryId, note: input.note.trim() },
      parentEntry: { id: original.entryId, amountCents: -1000, status: 'partial-refund' },
    })
    expect(await detail(original.entryId)).toMatchObject({ entry: { amountCents: -1000 }, refundedCents: 300, refundCount: 1 })
    expect((await accounts()).accounts).toContainEqual(expect.objectContaining({ id: original.input.accountId, balanceCents: -700 }))
    expect(receipt.version).toBe(original.version + 1)
  })

  it('跨 owner、不存在、已删除、收入、退款和转账父流水均被拒绝且无写入', async () => {
    const original = await parent()
    const income = await parent({ direction: 'income', amountCents: 1000, categoryCode: 'salary' })
    const child = await refund(refundInput(original.entryId))
    const deleted = await parent()
    await remove(deleted.entryId)
    const foreignInput = await ordinaryEntry(other)
    const foreign = ledgerReceiptSchema.parse(await (await ledgerRequest(other, '/api/ledger/entries', foreignInput)).json())
    const toAccountId = await ledgerTestAccount(owner, '转入 ' + crypto.randomUUID())
    const transfer = ledgerTransferReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/transfers', { requestId: crypto.randomUUID(), fromAccountId: original.input.accountId, toAccountId, amountCents: 10, occurredAt: original.input.occurredAt, note: '' })).json())
    const before = await accounts()
    for (const id of [foreign.entryId, crypto.randomUUID(), deleted.entryId]) {
      await expectError(refundInput(id), 'NOT_FOUND')
    }
    for (const id of [income.entryId, child.entryId, transfer.outEntryId, transfer.inEntryId]) await expectError(refundInput(id), 'REFUND_PARENT_INVALID')
    expect(await accounts()).toEqual(before)
  })

  it('时间边界、非法参数与额度失败不会留下流水、余额或版本变化', async () => {
    const original = await parent()
    const before = await accounts()
    await expectError(refundInput(original.entryId, { occurredAt: '2026-01-02T03:04:04Z' }), 'REFUND_TIME')
    await expectError(refundInput(original.entryId, { occurredAt: '2999-01-01T00:00:00Z' }), 'FUTURE_TIME')
    await expectError(refundInput(original.entryId, { amountCents: 1001 }), 'REFUND_LIMIT')
    for (const change of [{ amountCents: -1 }, { ownerId: other }, { accountId: original.input.accountId }, { categoryCode: 'salary' }, { occurredAt: '2026-01-02T03:04:05.001Z' }]) await expectError(refundInput(original.entryId, change), 'INVALID_ENTRY')
    expect(await accounts()).toEqual(before)
    expect(await detail(original.entryId)).toMatchObject({ refundedCents: 0, refundCount: 0, version: before.version })
    await refund(refundInput(original.entryId, { amountCents: 1000, occurredAt: original.input.occurredAt }))
    expect(await detail(original.entryId)).toMatchObject({ entry: { status: 'full-refund' }, refundedCents: 1000 })
  })

  it('并发不同请求共享额度，同编号并发只入账一次，全额后原请求仍成功', async () => {
    const original = await parent()
    const results = await Promise.all(Array.from({ length: 10 }, () => call('create_ledger_refund', refundInput(original.entryId))))
    expect(results.filter(result => !result.result.isError)).toHaveLength(3)
    for (const result of results.filter(result => result.result.isError)) expect((result.result.structuredContent.error as { code: string }).code).toBe('REFUND_LIMIT')
    expect(await detail(original.entryId)).toMatchObject({ refundedCents: 900, refundCount: 3, version: original.version + 3 })
    const input = refundInput(original.entryId, { amountCents: 100, note: ' 😀 ' })
    const receipts = await Promise.all(Array.from({ length: 8 }, () => refund(input)))
    expect(new Set(receipts.map(value => value.entryId)).size).toBe(1)
    expect(await detail(original.entryId)).toMatchObject({ entry: { amountCents: -1000, status: 'full-refund' }, refundedCents: 1000, refundCount: 4, version: original.version + 4 })
    expect(await refund({ ...input, note: '😀' })).toEqual(receipts[0])
    await expectError(refundInput(original.entryId, { amountCents: 1 }), 'REFUND_LIMIT')
    expect((await accounts()).accounts).toContainEqual(expect.objectContaining({ id: original.input.accountId, balanceCents: 0 }))
  })

  it('请求号与普通创建共享命名空间，父标识、金额、时间或备注变化均冲突', async () => {
    const original = await parent(), second = await parent()
    const input = refundInput(original.entryId)
    await refund(input)
    const before = await accounts()
    for (const change of [{ id: second.entryId }, { amountCents: 301 }, { occurredAt: '2026-01-02T03:04:06Z' }, { note: '修改' }]) await expectError({ ...input, ...change }, 'REQUEST_ID_REUSED')
    await expectError({ ...input, requestId: original.input.requestId }, 'REQUEST_ID_REUSED')
    expect((await call('create_ledger_entry', { ...original.input, requestId: input.requestId })).result).toMatchObject({ isError: true, structuredContent: { error: { code: 'REQUEST_ID_REUSED' } } })
    expect(await accounts()).toEqual(before)
  })

  it('父流水及退款删除后重试返回原 deleted 回执，不重建或再次改余额', async () => {
    const original = await parent()
    const input = refundInput(original.entryId)
    const receipt = await refund(input)
    await remove(original.entryId)
    const before = await accounts()
    expect(await refund(input)).toEqual({ entryId: receipt.entryId, version: before.version, deleted: true })
    expect((await ledgerRequest(owner, '/api/ledger/entries/' + receipt.entryId)).status).toBe(404)
    expect(await accounts()).toEqual(before)
  })

  it('余额上界和提交中失败完整回滚；余额变化后旧请求依然幂等', async () => {
    const original = await parent()
    const input = refundInput(original.entryId)
    const receipt = await refund(input)
    const updated = await ledgerRequest(owner, '/api/ledger/accounts/' + original.input.accountId, { requestId: crypto.randomUUID(), balanceCents: ledgerLimits.amountCents, expectedBalanceCents: -700 }, 'PATCH')
    expect(updated.status).toBe(200)
    const before = await accounts()
    await expectError(refundInput(original.entryId, { amountCents: 1 }), 'BALANCE_LIMIT')
    expect(await refund(input)).toEqual({ ...receipt, version: before.version })
    expect(await accounts()).toEqual(before)
    expect(await detail(original.entryId)).toMatchObject({ refundCount: 1, refundedCents: 300 })
    const rollback = await parent()
    const snapshot = await accounts()
    await expectError(refundInput(rollback.entryId, { note: 'ledger91-rollback' }), 'SAVE_UNKNOWN')
    expect(await detail(rollback.entryId)).toMatchObject({ refundedCents: 0, refundCount: 0, version: snapshot.version })
    expect(await accounts()).toEqual(snapshot)
  })

  it('真实提交成功但响应丢失时返回 SAVE_UNKNOWN，原请求重试只保留一笔', async () => {
    const original = await parent()
    const input = refundInput(original.entryId)
    const ledgerFetch = globalThis.fetch
    let writes = 0
    globalThis.fetch = async (url, init) => {
      const response = await ledgerFetch(url, init)
      if (String(url).endsWith('/rpc/ledger_refund')) {
        writes++
        expect(response.ok).toBe(true)
        return new Response(null, { status: 503 })
      }
      return response
    }
    try { await expectError(input, 'SAVE_UNKNOWN') } finally { globalThis.fetch = ledgerFetch }
    expect(writes).toBe(1)
    const committed = await detail(original.entryId)
    expect(committed).toMatchObject({ refundCount: 1, refundedCents: 300, version: original.version + 1 })
    const receipt = await refund(input)
    expect(receipt).toMatchObject({ entryId: committed.refunds[0].id, version: committed.version, deleted: false })
    expect(await detail(original.entryId)).toEqual(committed)
    expect((await accounts()).accounts).toContainEqual(expect.objectContaining({ id: original.input.accountId, balanceCents: -700 }))
  })

  it('REST 与 MCP 的实际退款回执、幂等及错误体一致', async () => {
    const original = await parent()
    const first = refundInput(original.entryId)
    const { id, ...body } = first
    const rest = await ledgerRequest(owner, '/api/ledger/entries/' + id + '/refunds', body)
    expect(rest.status).toBe(200)
    const receipt = ledgerReceiptSchema.parse(await rest.json())
    expect(await refund(first)).toEqual(receipt)
    const second = refundInput(id, { amountCents: 200 })
    const mcpReceipt = await refund(second)
    const { id: secondId, ...secondBody } = second
    expect(await (await ledgerRequest(owner, '/api/ledger/entries/' + secondId + '/refunds', secondBody)).json()).toEqual(mcpReceipt)
    const before = await accounts()
    const cases = [
      [{ id: 'invalid' }, 'NOT_FOUND'],
      [{ amountCents: 0 }, 'INVALID_ENTRY'],
      [{ note: '😀'.repeat(501) }, 'INVALID_ENTRY'],
      [{ accountId: original.input.accountId }, 'INVALID_ENTRY'],
      [{ parentEntryId: id }, 'INVALID_ENTRY'],
      [{ occurredAt: '2999-01-01T00:00:00Z' }, 'FUTURE_TIME'],
      [{ occurredAt: '2026-01-02T03:04:04Z' }, 'REFUND_TIME'],
      [{ amountCents: 501 }, 'REFUND_LIMIT'],
      [{ requestId: first.requestId, note: '不同参数' }, 'REQUEST_ID_REUSED'],
    ] as const
    for (const [change, code] of cases) {
      const input = refundInput(id, change)
      const { id: target, ...value } = input
      const response = await ledgerRequest(owner, '/api/ledger/entries/' + target + '/refunds', value)
      expect(response.status).toBe(ledgerErrors[code][0])
      const result = await call('create_ledger_refund', input)
      expect(result.result.isError).toBe(true)
      expect(result.result.structuredContent).toEqual(await response.json())
    }
    expect(await accounts()).toEqual(before)
    expect(await detail(id)).toMatchObject({ refundCount: 2, refundedCents: 500, entry: { amountCents: -1000 } })
  })

  it('流水列表与 REST 一致：日期/账户筛选、分页、版本冲突和跨 owner 空结果', async () => {
    const firstAccount = await ledgerTestAccount(owner, '读取筛选 A')
    const secondAccount = await ledgerTestAccount(owner, '读取筛选 B')
    const foreignAccount = await ledgerTestAccount(other, '读取筛选 其他')
    for (let index = 0; index < 31; index++) {
      ledgerReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, {
        accountId: secondAccount, occurredAt: `2026-03-0${index % 9 + 1}T03:04:05Z`, note: `筛选 ${index}`,
      }))).json())
    }
    const dated = ledgerReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, {
      accountId: firstAccount, occurredAt: '2025-12-31T16:00:00Z', note: '北京时间 2026-01-01',
    }))).json())
    const outside = ledgerReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, {
      accountId: firstAccount, occurredAt: '2025-12-31T15:59:59Z', note: '北京时间 2025-12-31',
    }))).json())
    const foreign = ledgerReceiptSchema.parse(await (await ledgerRequest(other, '/api/ledger/entries', await ordinaryEntry(other, {
      accountId: foreignAccount, occurredAt: '2026-01-01T00:00:00Z',
    }))).json())

    const all = await list()
    expect(all.total).toBeGreaterThanOrEqual(33)
    expect(all.items).toHaveLength(30)
    expect(JSON.stringify(all)).not.toContain(foreign.entryId)

    const dateRange = { startDate: '2026-01-01', endDate: '2026-01-01' }
    const datedList = await list({ ...dateRange, accountId: firstAccount })
    expect(datedList).toMatchObject({ total: 1, page: 1, pageSize: 30 })
    expect(datedList.items.map(item => item.id)).toEqual([dated.entryId])

    const firstAccountList = await list({ accountId: firstAccount })
    expect(firstAccountList.total).toBe(2)
    expect(firstAccountList.items.map(item => item.id)).toEqual(expect.arrayContaining([dated.entryId, outside.entryId]))

    const accountPage = await list({ accountId: secondAccount, page: 1 })
    expect(accountPage).toMatchObject({ total: 31, page: 1 })
    expect(accountPage.items).toHaveLength(30)
    const accountSecondPage = await list({ accountId: secondAccount, page: 2, version: accountPage.version })
    expect(accountSecondPage.items).toHaveLength(1)
    expect(new Set([...accountPage.items, ...accountSecondPage.items].map(item => item.id)).size).toBe(31)
    expect((await list({ accountId: foreignAccount })).total).toBe(0)
    expect((await list({ accountId: foreignAccount })).items).toEqual([])

    for (const args of [
      { startDate: '2026-01-01' }, { endDate: '2026-01-01' }, { startDate: '2026-01-02', endDate: '2026-01-01' },
      { startDate: '2026-02-30', endDate: '2026-03-01' }, { accountId: 'bad' }, { page: 0 }, { page: 1_000_001 },
      { version: -1 }, { ownerId: other }, { unknown: true },
    ]) {
      const mcp = await call('list_ledger_entries', args)
      expect(mcp.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_QUERY' } } })
    }

    const restPage = ledgerPageSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries?' + new URLSearchParams({
      page: '1', startDate: dateRange.startDate, endDate: dateRange.endDate, accountId: firstAccount, version: String(datedList.version),
    }))).json())
    expect(restPage).toEqual(datedList)

    await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: secondAccount, occurredAt: '2025-01-01T00:00:00Z' }))
    const stale = await call('list_ledger_entries', { accountId: secondAccount, page: 1, version: accountPage.version })
    expect(stale.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'LIST_CHANGED' } } })
  }, 30000)

  it('单笔详情与 REST 一致：父流水、退款关联分页、转账对侧、已删除和跨 owner 隔离', async () => {
    const account = await ledgerTestAccount(owner, '详情读取 A')
    const toAccount = await ledgerTestAccount(owner, '详情读取 B')
    const original = await parent({ accountId: account, amountCents: -1000 })
    const refunds = []
    for (let index = 0; index < 31; index++) refunds.push(await refund(refundInput(original.entryId, {
      amountCents: 1, occurredAt: '2026-01-02T03:04:05Z', note: `关联 ${index}`,
    })))
    const transfer = ledgerTransferReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/transfers', {
      requestId: crypto.randomUUID(), fromAccountId: account, toAccountId: toAccount, amountCents: 100,
      occurredAt: '2026-01-02T03:04:05Z', note: '转账读取',
    })).json())

    const first = await entryDetail({ id: original.entryId })
    expect(first).toMatchObject({
      entry: { id: original.entryId, amountCents: -1000, status: 'partial-refund' },
      parentEntry: null, transferEntry: null, refundCount: 31, refundedCents: 31, refundPage: 1, refundPageSize: 30,
    })
    expect(first.refunds).toHaveLength(30)
    const second = await entryDetail({ id: original.entryId, refundPage: 2, version: first.version })
    expect(second).toMatchObject({ refundPage: 2, refundCount: 31, version: first.version })
    expect(second.refunds).toHaveLength(1)
    const seen = [...first.refunds, ...second.refunds].map(item => item.id)
    expect(new Set(seen).size).toBe(31)
    expect(seen).toEqual(refunds.map(item => item.entryId).sort().reverse())
    const child = await entryDetail({ id: seen[0] })
    expect(child).toMatchObject({ entry: { id: seen[0], parentEntryId: original.entryId, amountCents: 1 }, parentEntry: { id: original.entryId } })

    for (const side of [transfer.outEntryId, transfer.inEntryId]) {
      const value = await entryDetail({ id: side })
      expect(value.transferEntry?.id).toBe(side === transfer.outEntryId ? transfer.inEntryId : transfer.outEntryId)
      expect(value.entry.transferId).toBe(value.transferEntry?.transferId)
    }
    expect((await entryDetail({ id: transfer.outEntryId })).transferEntry).toMatchObject({ id: transfer.inEntryId, accountId: toAccount })

    const rest = ledgerDetailSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${original.entryId}?refundPage=2&version=${first.version}`)).json())
    expect(second).toEqual(rest)
    const stale = await call('get_ledger_entry', { id: original.entryId, version: first.version - 1 })
    expect(stale.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'LIST_CHANGED' } } })

    for (const args of [
      { id: 'invalid' }, { id: crypto.randomUUID() }, { id: original.entryId, refundPage: 0 },
      { id: original.entryId, refundPage: 1.5 }, { id: original.entryId, version: -1 }, { id: original.entryId, ownerId: other },
      { id: original.entryId, unknown: true },
    ]) {
      const mcp = await call('get_ledger_entry', args)
      expect(mcp.result.isError).toBe(true)
    }
    expect((await call('get_ledger_entry', { id: 'invalid' })).result).toMatchObject({ structuredContent: { error: { code: 'NOT_FOUND' } } })
    expect((await call('get_ledger_entry', { id: crypto.randomUUID() })).result).toMatchObject({ structuredContent: { error: { code: 'NOT_FOUND' } } })
    expect((await call('get_ledger_entry', { id: original.entryId, refundPage: 0 })).result).toMatchObject({ structuredContent: { error: { code: 'INVALID_QUERY' } } })

    const otherToken = (await fixture.issue((await fixture.client()).clientId, mcpScopes, oauthOther)).access_token
    const foreign = await fixture.request('/api/agent/mcp', {
      method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_ledger_entry', arguments: { id: original.entryId } } }),
    })
    expect(await foreign.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'NOT_FOUND' } } } })

    await remove(original.entryId)
    expect((await call('get_ledger_entry', { id: original.entryId })).result).toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_FOUND' } } })
    expect((await list({ accountId: account })).items.map(item => item.id)).not.toContain(original.entryId)
    expect((await list({ accountId: account })).items.map(item => item.id)).toContain(transfer.outEntryId)
  }, 30000)

})
