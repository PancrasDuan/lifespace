import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import app from '../../worker/index'
import { installLedgerDatabase, ledgerEnv, ledgerTestAccount, ledgerRequest, ordinaryEntry } from '../support/ledger-database'
import { ledgerAccountsSchema, ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerErrors, ledgerLimits, ledgerReceiptSchema, ledgerTransferReceiptSchema } from '../../src/shared/ledger'

const rpcUrl = process.env.LEDGER_LOCAL_RPC_URL
const adminUrl = process.env.WORKER_TEST_ADMIN_URL
const owner = '00000000-0000-4000-8000-000000000007'
const other = '00000000-0000-4000-8000-000000000008'
const team = 'https://agent-test.cloudflareaccess.com'
const audience = 'test-agent-audience'
const clientId = 'synthetic-http-active.access'
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const signed = () => {
  const value = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: team, aud: audience, exp: Math.floor(Date.now() / 1000) + 300, sub: '', common_name: clientId })}`
  return `${value}.${sign('RSA-SHA256', Buffer.from(value), pair.privateKey).toString('base64url')}`
}
const env = { ...ledgerEnv, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience }
const nativeFetch = globalThis.fetch
let restore: () => void

async function call(name: string, args: object) {
  const response = await app.request('/api/agent/mcp', {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': signed(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }, env)
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
async function remove(id: string) {
  const preview = ledgerDeletePreviewSchema.parse(await (await ledgerRequest(owner, '/api/ledger/entries/' + id + '/delete-preview')).json())
  const response = await ledgerRequest(owner, '/api/ledger/entries/' + id + '/delete', { scope: preview.scope })
  expect(response.status).toBe(200)
}
async function expectError(input: object, code: string) {
  expect((await call('create_ledger_refund', input)).result).toMatchObject({ isError: true, structuredContent: { error: { code } } })
}

describe.skipIf(!rpcUrl)('Agent 通过真实隔离账单数据库操作', () => {
  beforeAll(() => {
    const target = new URL(rpcUrl!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('仅允许本机隔离数据库')
    restore = installLedgerDatabase()
    const ledgerFetch = globalThis.fetch
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.href === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
      if (url.origin === env.SUPABASE_URL && url.pathname === '/rest/v1/rpc/agent_resolve_owner') return nativeFetch(new URL('/rpc/agent_resolve_owner', target), init)
      if (url.origin === env.SUPABASE_URL && url.pathname === `/auth/v1/admin/users/${owner}`) return Response.json({ id: owner, email: 'ledger@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false })
      return ledgerFetch(input, init)
    }
  })
  afterAll(() => { restore?.() })

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

  it('真实绑定停用后，下一次 MCP 请求立即失去准入', async () => {
    if (!adminUrl) throw new Error('缺少隔离数据库管理员地址')
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    try {
      await admin.query('update public.agent_identity_bindings set enabled=false where client_id=$1', [clientId])
      const response = await app.request(
        '/api/agent/mcp',
        {
          method: 'POST',
          headers: {
            'Cf-Access-Jwt-Assertion': signed(),
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        },
        env
      )
      expect(response.status).toBe(401)
    } finally {
      await admin.query('update public.agent_identity_bindings set enabled=true where client_id=$1', [clientId])
      await admin.end()
    }
  })

})
