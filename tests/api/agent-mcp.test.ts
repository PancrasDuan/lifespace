import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000001'
const team = 'https://agent-test.cloudflareaccess.com'
const audience = 'test-agent-audience'
const clientId = 'agent-test-client.access'
const env = {
  CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience,
  SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
  SUPABASE_SECRET_KEY: 'sb_secret_test-only', AUTH_ALLOWED_EMAILS: 'agent@example.invalid',
}
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
function assertion() {
  const message = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: team, aud: audience, exp: Math.floor(Date.now() / 1000) + 300, sub: '', common_name: clientId })}`
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), pair.privateKey).toString('base64url')}`
}
function upstream(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    if (url === `${env.SUPABASE_URL}/rest/v1/rpc/agent_resolve_owner`) return Response.json({ ownerId: owner })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json({ id: owner, email: 'agent@example.invalid', email_confirmed_at: '2026-11-01T00:00:00Z', is_anonymous: false })
    const value = extra?.(url, init)
    if (value) return value
    throw new Error('unexpected upstream')
  }))
}
function request(body: unknown, headers: HeadersInit = {}) {
  return app.request('/api/agent/mcp', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': assertion(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) }, env)
}
afterEach(() => vi.unstubAllGlobals())

test('Agent 通过真实入口初始化 MCP 并获得协商的协议版本', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'lifespace-ledger' } } })
})

test('工具发现提供本人账户、普通流水与独立退款契约', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 'discovery', method: 'tools/list', params: {} }, { 'MCP-Protocol-Version': '2025-11-25' })
  expect(response.status).toBe(200)
  const result = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[]; properties?: Record<string, { description?: string }> } }> } }
  expect(result.result.tools.map(tool => tool.name)).toEqual(['list_ledger_accounts', 'create_ledger_entry', 'create_ledger_refund'])
  const create = result.result.tools[1]
  expect(create.inputSchema.required).toEqual(expect.arrayContaining(['requestId', 'direction', 'amountCents', 'occurredAt', 'accountId', 'categoryCode', 'note']))
  expect(create.inputSchema.properties?.categoryCode.description).toContain('dining：餐饮')
  expect(create.description).toContain('完整展示')
  expect(create.description).toContain('明确确认')
  const refund = result.result.tools[2]
  expect(refund.inputSchema).toMatchObject({ additionalProperties: false, required: ['parentEntryId', 'requestId', 'amountCents', 'occurredAt', 'note'], properties: { parentEntryId: { format: 'uuid' }, amountCents: { type: 'integer', minimum: 1, maximum: 99_999_999_999 }, note: { type: 'string', description: expect.stringContaining('trim 后最多 500 个 Unicode 码点') } } })
  expect(refund.inputSchema.properties?.note).not.toHaveProperty('maxLength')
  expect(Object.keys(refund.inputSchema.properties!)).toEqual(refund.inputSchema.required)
  for (const instruction of ['父流水关联', '继承的交易账户和分类', '明确确认', '再次完整展示并确认', '原 requestId', '无法独立证明']) expect(refund.description).toContain(instruction)
})

test('账户查询返回本人完整账户数据，包括余额', async () => {
  upstream(url => url.endsWith('/rpc/ledger_accounts_list') ? Response.json({ accounts: [{ id: '00000000-0000-4000-8000-000000000004', name: '支付宝', balanceCents: 12345, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }], version: 3 }) : undefined)
  const response = await request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_ledger_accounts', arguments: {} } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: 2, result: { structuredContent: { accounts: [{ name: '支付宝', balanceCents: 12345 }], version: 3 } } })
})

test('普通流水创建沿用现有用户、请求编号和账单校验', async () => {
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_create')) return undefined
    const body = JSON.parse(String(init?.body))
    return body.p_owner === owner && JSON.stringify(body.p_input) === JSON.stringify(entry)
      ? Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false })
      : Response.json({ message: 'ACCOUNT_NOT_FOUND' }, { status: 403 })
  })
  const response = await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: 3, result: { structuredContent: { entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false } } })
})

test('初始化完成通知返回 202 空响应', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', method: 'notifications/initialized' })
  expect(response.status).toBe(202)
  expect(await response.text()).toBe('')
})

test('协议版本协商支持兼容版本并拒绝不支持的后续版本', async () => {
  upstream()
  const older = await request({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client', version: '1' } } })
  expect(await older.json()).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
  const future = await request({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'client', version: '1' } } })
  expect(await future.json()).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  const invalid = await request({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { 'MCP-Protocol-Version': 'not-supported' })
  expect(invalid.status).toBe(400)
})

test('带浏览器 Origin 的外部请求拒绝访问 Agent 工具', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { Origin: 'https://attacker.example' })
  expect(response.status).toBe(403)
})

test('不接受不支持 MCP JSON 与事件流的 Accept 请求', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, { Accept: 'text/plain' })
  expect(response.status).toBe(406)
})

test('非 JSON 请求内容不会进入 MCP 工具', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { 'Content-Type': 'text/plain' })
  expect(response.status).toBe(415)
})

test('无效的 JSON-RPC id 不能触发流水写入', async () => {
  let writes = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_create')) { writes++; return Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false }) }
    return undefined
  })
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', id: null, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(400)
  expect(writes).toBe(0)
})

test('没有 id 的工具调用不能触发流水写入', async () => {
  let writes = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_create')) { writes++; return Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false }) }
    return undefined
  })
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(400)
  expect(writes).toBe(0)
})

test('创建结果未知时通过 MCP 提示沿用原编号和参数重试', async () => {
  upstream(url => url.endsWith('/rpc/ledger_create') ? new Response(null, { status: 503 }) : undefined)
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(200)
  const body = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } }
  expect(body.result.isError).toBe(true)
  expect(body.result.content[0].text).toContain('SAVE_UNKNOWN')
  expect(body.result.content[0].text).toContain('原 requestId 和相同参数')
})

test('未知 MCP 方法返回 JSON-RPC 方法不存在', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 11, method: 'unknown/method' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 11, error: { code: -32601 } })
})

test('账户查询拒绝用户指定其他所有者', async () => {
  let reads = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_accounts_list')) { reads++; return Response.json({ accounts: [], version: 0 }) }
    return undefined
  })
  const response = await request({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'list_ledger_accounts', arguments: { ownerId: 'someone-else' } } })
  expect(await response.json()).toMatchObject({ id: 12, error: { code: -32602 } })
  expect(reads).toBe(0)
})

test('未知工具返回参数错误，不能访问其他账单能力', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'delete_ledger_entry', arguments: {} } })
  expect(await response.json()).toMatchObject({ id: 13, error: { code: -32602 } })
})

test('MCP ping 返回空结果', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 14, method: 'ping' })
  expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 14, result: {} })
})

test('初始化缺少客户端信息时返回参数错误', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 15, method: 'initialize', params: {} })
  expect(await response.json()).toMatchObject({ id: 15, error: { code: -32602 } })
})

const refund = { parentEntryId: '00000000-0000-4000-8000-000000000008', requestId: '00000000-0000-4000-8000-000000000009', amountCents: 500, occurredAt: '2026-01-02T03:04:05Z', note: '  退货  ' }
const refundCall = (args: unknown = refund) => request({ jsonrpc: '2.0', id: 'refund', method: 'tools/call', params: { name: 'create_ledger_refund', arguments: args } })

test('退款允许 trim 后恰好 500 个 Unicode 码点，发现契约不误限原始长度', async () => {
  const note = '😀'.repeat(500)
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_refund')) return undefined
    expect(JSON.parse(String(init?.body)).p_input.note).toBe(note)
    return Response.json({ entryId: refund.requestId, version: 5, deleted: false })
  })
  expect(await (await refundCall({ ...refund, note: '  ' + note + '  ' })).json()).toMatchObject({ result: { structuredContent: { entryId: refund.requestId } } })
})

test('退款复用账单服务，可信 owner 和父标识单独注入，不接收继承字段', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_refund')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_parent: refund.parentEntryId, p_input: { requestId: refund.requestId, amountCents: 500, occurredAt: refund.occurredAt, note: '退货' } })
    return Response.json({ entryId: refund.requestId, version: 5, deleted: false })
  })
  const response = await refundCall()
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const body = await response.json() as { result: { content: Array<{ text: string }>; structuredContent: object } }
  expect(body.result.structuredContent).toEqual({ entryId: refund.requestId, version: 5, deleted: false })
  expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent)
})

test.each([
  { parentEntryId: 'invalid' }, { requestId: 'invalid' }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 0.1 },
  { amountCents: 100_000_000_000 }, { occurredAt: '2026-01-02T03:04:05.001Z' },
  { occurredAt: '2026-02-30T00:00:00Z' }, { note: '😀'.repeat(501) }, { note: undefined },
  { ownerId: owner }, { accountId: owner }, { categoryCode: 'dining' }, { direction: 'income' },
])('退款拒绝非法或越权字段 %j，未调用业务数据库', async change => {
  let writes = 0
  upstream(url => { if (url.endsWith('/rpc/ledger_refund')) writes++; return undefined })
  expect(await (await refundCall({ ...refund, ...change })).json()).toMatchObject({ result: { isError: true, structuredContent: { code: 'INVALID_ENTRY' } } })
  expect(writes).toBe(0)
})

test('退款拒绝未来时间，未调用业务数据库', async () => {
  upstream()
  expect(await (await refundCall({ ...refund, occurredAt: '2999-01-01T00:00:00Z' })).json()).toMatchObject({ result: { isError: true, structuredContent: { code: 'FUTURE_TIME' } } })
})

test.each(['NOT_FOUND', 'REFUND_PARENT_INVALID', 'REFUND_LIMIT', 'REFUND_TIME', 'BALANCE_LIMIT', 'REQUEST_ID_REUSED'] as const)('退款业务错误 %s 沿用稳定 MCP 映射', async code => {
  upstream(url => url.endsWith('/rpc/ledger_refund') ? Response.json({ message: code, details: 'private upstream details' }, { status: 400 }) : undefined)
  const body = await (await refundCall()).json()
  expect(body).toMatchObject({ result: { isError: true, structuredContent: { code } } })
  expect(JSON.stringify(body)).not.toContain('private upstream details')
})

test.each([new Response(null, { status: 503 }), Response.json({ entryId: 'invalid' }), Response.json({ message: 'private upstream details' }, { status: 500 })])('退款响应丢失或无效时保留未知结果语义', async upstreamResponse => {
  let writes = 0
  upstream(url => { if (url.endsWith('/rpc/ledger_refund')) { writes++; return upstreamResponse }; return undefined })
  const body = await (await refundCall()).json()
  expect(body).toMatchObject({ result: { isError: true, structuredContent: { code: 'SAVE_UNKNOWN', message: expect.stringContaining('原 requestId 和相同参数') } } })
  expect(JSON.stringify(body)).not.toContain('private upstream details')
  expect(writes).toBe(1)
})

test('退款仍需 Agent 鉴权与在线准入，Agent 凭据不能访问网页退款接口', async () => {
  upstream()
  const headers = { 'Cf-Access-Jwt-Assertion': assertion(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_ledger_refund', arguments: refund } })
  expect((await app.request('/api/agent/mcp', { method: 'POST', headers, body }, { ...env, AUTH_ALLOWED_EMAILS: 'removed@example.invalid' })).status).toBe(403)
  expect((await app.request('/api/agent/mcp', { method: 'POST', headers: { ...headers, 'Cf-Access-Jwt-Assertion': '' }, body }, env)).status).toBe(401)
  expect((await app.request('/api/ledger/entries/' + refund.parentEntryId + '/refunds', { method: 'POST', headers, body: JSON.stringify(refund) }, env)).status).toBe(401)
})
