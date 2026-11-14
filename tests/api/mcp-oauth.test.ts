import { afterEach, expect, test, vi } from 'vitest'
import { oauthFixture, oauthIssuer, oauthOwner, oauthOther, oauthRedirect } from '../support/mcp-oauth'
import { mcpScopes } from '../../worker/mcp-oauth-config'

afterEach(() => vi.unstubAllGlobals())

test('标准发现、授权码 + S256、工具握手及凭据隔离贯通', async () => {
  const f = oauthFixture()
  const response = await f.mcp()
  expect(response.status).toBe(401)
  expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata="' + oauthIssuer + '/.well-known/oauth-protected-resource/api/agent/mcp"')
  expect(response.headers.get('WWW-Authenticate')).not.toContain('invalid_token')
  expect(await (await f.request('/.well-known/oauth-protected-resource/api/agent/mcp')).json()).toMatchObject({ resource: oauthIssuer + '/api/agent/mcp', scopes_supported: [mcpScopes[0]], authorization_servers: [oauthIssuer] })
  const metadata = await f.request('/.well-known/oauth-authorization-server')
  expect(metadata.headers.get('Content-Type')).toContain('application/json')
  expect(await metadata.json()).toMatchObject({ issuer: oauthIssuer, code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, scopes_supported: mcpScopes })
  expect((await f.request('/oauth/authorize')).headers.get('X-Frame-Options')).toBe('DENY')
  const client = await f.client()
  const token = await f.issue(client.clientId)
  expect(token.resource).toBe(oauthIssuer + '/api/agent/mcp')
  expect(new URL(token.redirectTo).searchParams.get('iss')).toBe(oauthIssuer)
  expect((await f.mcp(token.access_token)).status).toBe(200)
  const init = await f.request('/api/agent/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) })
  expect(await init.json()).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  for (const path of ['/api/ledger/accounts', '/api/adventure', '/api/auth/me', '/api/oauth/grants']) {
    expect((await f.request(path, { headers: { Authorization: `Bearer ${token.access_token}` } })).status).toBe(401)
  }
  expect((await f.mcp(f.browserToken())).status).toBe(401)
  expect((await f.request('/api/agent/mcp', { headers: { 'Cf-Access-Jwt-Assertion': 'synthetic-old-assertion' } })).status).toBe(401)
})

test('只读授权按工具返回 HTTP 403，业务失败仍使用原 MCP 封装', async () => {
  const f = oauthFixture()
  const client = await f.client()
  const token = await f.issue(client.clientId, [mcpScopes[0]])
  expect((await f.mcp(token.access_token, 'list_ledger_accounts')).status).toBe(200)
  for (const [name, scope] of [['create_ledger_entry', mcpScopes[1]], ['create_ledger_refund', mcpScopes[2]]]) {
    const denied = await f.mcp(token.access_token, name)
    expect(denied.status).toBe(403)
    expect(denied.headers.get('WWW-Authenticate')).toContain(`error="insufficient_scope", scope="${scope}"`)
    expect(await denied.json()).not.toHaveProperty('result')
  }
  expect(f.writes).toHaveLength(1)
  const stepUp = await f.issue(client.clientId, [mcpScopes[0], mcpScopes[1]])
  const invalid = await f.mcp(stepUp.access_token, 'create_ledger_entry', {})
  expect(invalid.status).toBe(200)
  expect(await invalid.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'INVALID_ENTRY' } } } })
})

test('同一客户端的多个用户、多个客户端与多个授权独立，owner 无法由参数覆盖', async () => {
  const f = oauthFixture()
  const client = await f.client()
  const first = await f.issue(client.clientId)
  const second = await f.issue(client.clientId, mcpScopes, oauthOther)
  const another = await f.issue((await f.client()).clientId)
  for (const token of [first, second, another]) expect((await f.mcp(token.access_token, 'list_ledger_accounts')).status).toBe(200)
  expect(f.writes.map(write => write.input.p_owner)).toEqual([oauthOwner, oauthOther, oauthOwner])
  const invalid = await f.mcp(first.access_token, 'list_ledger_accounts', { ownerId: oauthOther })
  expect(await invalid.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'INVALID_QUERY' } } } })
  const grant = [...f.grants.values()].find(grant => grant.ownerId === oauthOwner && grant.clientId === client.clientId)!
  expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id }, oauthOther)).status).toBe(404)
  f.kv.ignoreDeletes = true // Simulate a different region retaining every old KV record.
  expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id })).status).toBe(200)
  expect((await f.mcp(first.access_token)).status).toBe(401)
  expect((await f.mcp(second.access_token)).status).toBe(200)
  expect((await f.mcp(another.access_token)).status).toBe(200)
  expect((await f.tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.clientId })).status).toBe(400)
})

test('PKCE 错误、redirect/resource 不匹配、code 重放及跨地区 code 重放均拒绝', async () => {
  const f = oauthFixture()
  const client = await f.client()
  const consent = await f.approve(client.clientId)
  const args = { grant_type: 'authorization_code', code: consent.code, code_verifier: consent.verifier, redirect_uri: oauthRedirect, client_id: client.clientId, resource: oauthIssuer + '/api/agent/mcp' }
  for (const change of [{ code_verifier: 'a'.repeat(43) }, { redirect_uri: 'https://evil.example/callback' }, { resource: oauthIssuer + '/api/ledger' }, { client_id: (await f.client()).clientId }]) {
    expect((await f.tokenRequest({ ...args, ...change })).status).toBe(400)
  }
  const oldKv = new Map(f.kv.records)
  expect((await f.tokenRequest(args)).status).toBe(200)
  expect((await f.tokenRequest(args)).status).toBe(400)
  f.kv.records = oldKv // Replay against an edge that hasn't seen code consumption.
  expect((await f.tokenRequest(args)).status).toBe(400)
})

test('刷新轮换保留资源并禁止增权；RFC7009 token 撤销由官方库校验客户端', async () => {
  const f = oauthFixture()
  const client = await f.client()
  const token = await f.issue(client.clientId, [mcpScopes[0]])
  const args = { grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: client.clientId }
  expect((await f.tokenRequest({ ...args, resource: oauthIssuer + '/wrong' })).status).toBe(400)
  expect((await f.tokenRequest({ ...args, scope: mcpScopes.join(' ') })).status).toBe(400)
  const response = await f.tokenRequest(args)
  expect(response.status).toBe(200)
  const refreshed = await response.json() as { access_token: string; refresh_token: string; resource: string; scope: string }
  expect(refreshed.refresh_token).not.toBe(token.refresh_token)
  expect(refreshed.scope).toBe(mcpScopes[0])
  expect(refreshed.resource).toBe(oauthIssuer + '/api/agent/mcp')
  expect((await f.mcp(refreshed.access_token)).status).toBe(200)
  expect((await f.tokenRequest({ token: refreshed.access_token, client_id: (await f.client()).clientId })).status).toBe(200)
  expect((await f.mcp(refreshed.access_token)).status).toBe(200)
  expect((await f.tokenRequest({ token: refreshed.refresh_token, token_type_hint: 'refresh_token', client_id: client.clientId })).status).toBe(200)
  expect((await f.mcp(refreshed.access_token)).status).toBe(401)
})

test.each(['user-deleted', 'user-banned', 'user-unverified', 'whitelist', 'database', 'kv', 'expired', 'audience', 'issuer'] as const)('每次访问重新检查并拒绝：%s', async reason => {
  const f = oauthFixture()
  const token = await f.issue((await f.client()).clientId)
  if (reason === 'user-deleted') f.users.delete(oauthOwner)
  if (reason === 'user-banned') f.users.get(oauthOwner)!.banned_until = '2099-01-01T00:00:00Z'
  if (reason === 'user-unverified') f.users.get(oauthOwner)!.email_confirmed_at = ''
  if (reason === 'whitelist') f.env.AUTH_ALLOWED_EMAILS = 'removed@example.invalid'
  if (reason === 'database') f.failDatabase()
  if (reason === 'kv') f.kv.fail = true
  if (reason === 'expired') for (const [key, value] of f.kv.records) if (key.startsWith('token:')) { const record = JSON.parse(value.value); record.expiresAt = 1; value.value = JSON.stringify(record) }
  if (reason === 'audience') for (const [key, value] of f.kv.records) if (key.startsWith('token:')) { const record = JSON.parse(value.value); record.audience = oauthIssuer + '/api/ledger'; value.value = JSON.stringify(record) }
  if (reason === 'issuer') f.env.MCP_OAUTH_ISSUER = 'https://other.example.invalid'
  const response = await f.mcp(token.access_token, 'list_ledger_accounts')
  expect(response.status).toBe(['database', 'kv'].includes(reason) ? 503 : reason === 'whitelist' ? 403 : reason === 'issuer' ? 400 : 401)
  expect(f.writes).toHaveLength(0)
})

test('CIMD 自动识别、预注册优先以及按需 DCR 均走官方库', async () => {
  const f = oauthFixture()
  const clientId = 'https://cimd.example.invalid/metadata.json'
  f.documents.set(clientId, { client_id: clientId, client_name: 'CIMD 合成客户端', redirect_uris: [oauthRedirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  const token = await f.issue(clientId)
  expect((await f.mcp(token.access_token)).status).toBe(200)
  const consent = await f.start(clientId)
  expect(consent.details).toMatchObject({ clientName: 'CIMD 合成客户端', clientDomain: 'cimd.example.invalid', redirectHost: '127.0.0.1', redirectIsLoopback: true })
  f.env.MCP_OAUTH_DCR_ENABLED = 'true'
  const metadata = await (await f.request('/.well-known/oauth-authorization-server')).json()
  expect(metadata).toMatchObject({ registration_endpoint: oauthIssuer + '/oauth/register' })
  const registration = await f.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'DCR 合成客户端', redirect_uris: [oauthRedirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })
  expect(registration.status).toBe(201)
  const registered = await registration.json() as { client_id: string }
  expect((await f.mcp((await f.issue(registered.client_id)).access_token)).status).toBe(200)
})

test('拒绝授权、伪造浏览器绑定、账户变化和非法授权请求', async () => {
  const f = oauthFixture()
  const client = await f.client()
  const consent = await f.start(client.clientId)
  const body = { handle: consent.handle, decision: 'approve', scopes: mcpScopes }
  expect((await f.browser('/api/oauth/consent/finish', body, oauthOther, consent.cookies)).status).toBe(400)
  expect((await f.browser('/api/oauth/consent/finish', body)).status).toBe(400)
  const denied = await f.browser('/api/oauth/consent/finish', { ...body, decision: 'deny' }, oauthOwner, consent.cookies)
  expect(denied.status).toBe(200)
  const result = await denied.json() as { redirectTo: string }
  expect(new URL(result.redirectTo).searchParams.get('error')).toBe('access_denied')
  expect(f.grants.size).toBe(0)
  const invalidRequests: Record<string, string>[] = [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { redirect_uri: 'https://evil.example/cb' }, { scope: 'admin' }, { resource: oauthIssuer + '/api/adventure' }]
  for (const extra of invalidRequests) {
    expect((await f.start(client.clientId, mcpScopes, oauthOwner, extra)).response.status).toBe(400)
  }
})

test('Origin、CORS 与服务端路由有精确边界，DCR 默认不开放', async () => {
  const f = oauthFixture()
  const options = (origin: string) => f.request('/api/agent/mcp', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Headers': 'Authorization, MCP-Protocol-Version' } })
  expect((await options('https://evil.example')).status).toBe(403)
  expect((await options(oauthIssuer)).status).toBe(204)
  f.env.MCP_ALLOWED_ORIGINS = 'https://trusted-client.example'
  const trusted = await options('https://trusted-client.example')
  expect(trusted.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted-client.example')
  const metadata = await f.request('/.well-known/oauth-authorization-server')
  expect(metadata.headers.get('Access-Control-Allow-Origin')).toBeNull()
  expect((await f.request('/oauth/register', { method: 'POST' })).status).toBe(404)
  expect((await f.request('/.well-known/unknown')).status).toBe(404)
  f.env.MCP_ALLOWED_ORIGINS = '*'
  expect((await options('https://untrusted.example')).status).toBe(503)
})

test('授权列表可以分页管理较早的有效连接，不能用分页参数指定其他用户', async () => {
  const f = oauthFixture()
  const token = await f.issue((await f.client()).clientId)
  const template = [...f.grants.values()][0]
  f.grants.clear()
  for (let index = 0; index < 105; index++) {
    const id = `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
    f.grants.set(id, { ...template, id, createdAt: '2026-11-14T00:00:00Z' })
  }
  const response = await f.browser('/api/oauth/grants')
  const first = await response.json() as { grants: { id: string }[]; nextCursor: { before: string; beforeId: string } }
  expect(first.grants).toHaveLength(100)
  const second = await (await f.browser('/api/oauth/grants?' + new URLSearchParams(first.nextCursor))).json() as { grants: { id: string }[]; nextCursor: null }
  expect(second.grants).toHaveLength(5)
  expect(second.nextCursor).toBeNull()
  expect(new Set([...first.grants, ...second.grants].map(grant => grant.id)).size).toBe(105)
  expect((await f.browser('/api/oauth/grants?ownerId=' + oauthOther)).status).toBe(400)
  expect((await f.mcp(token.access_token)).status).toBe(401)
})
