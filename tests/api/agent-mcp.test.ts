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

test('工具发现提供本人账户查询和带既有分类的普通流水创建', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 'discovery', method: 'tools/list', params: {} }, { 'MCP-Protocol-Version': '2025-11-25' })
  expect(response.status).toBe(200)
  const result = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[]; properties?: Record<string, { description?: string }> } }> } }
  expect(result.result.tools.map(tool => tool.name)).toEqual(['list_ledger_accounts', 'create_ledger_entry'])
  const create = result.result.tools[1]
  expect(create.inputSchema.required).toEqual(expect.arrayContaining(['requestId', 'direction', 'amountCents', 'occurredAt', 'accountId', 'categoryCode', 'note']))
  expect(create.inputSchema.properties?.categoryCode.description).toContain('dining：餐饮')
  expect(create.description).toContain('完整展示')
  expect(create.description).toContain('明确确认')
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
