import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { oauthFixture } from '../support/mcp-oauth'

const legacy = '/api/agent/legacy/mcp'
const notFound = { error: { code: 'NOT_FOUND', message: '接口不存在' } }
afterEach(() => vi.unstubAllGlobals())

// Keep stale settings only as a negative fixture: they must never enable a route.
const staleEnv = {
  MCP_LEGACY_ENABLED: 'true',
  CF_ACCESS_TEAM_DOMAIN: 'https://agent-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-agent-audience',
}
const credentials: HeadersInit[] = [
  {},
  { 'Cf-Access-Jwt-Assertion': 'synthetic.invalid.assertion' },
  { 'CF-Access-Client-Id': 'synthetic-retired.access', 'CF-Access-Client-Secret': 'synthetic-retired-secret' },
  { Authorization: 'Bearer synthetic.invalid.token' },
  { Cookie: 'CF_Authorization=synthetic-retired-session', Origin: 'https://attacker.example.invalid' },
]

test.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('旧路径 %s 对所有旧凭据和残留开关在鉴权前返回 404', async method => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  for (const env of [{}, staleEnv]) for (const headers of credentials) {
    const response = await app.request(legacy, { method, headers }, env)
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('WWW-Authenticate')).toBe(false)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    if (method !== 'HEAD') expect(await response.json()).toEqual(notFound)
  }
  expect(upstream).not.toHaveBeenCalled()
})

test('有效 OAuth 和网页登录凭据也不能复活旧路径，不读取 body、KV 或上游', async () => {
  const f = oauthFixture()
  const token = await f.issue((await f.client()).clientId)
  const upstream = vi.mocked(fetch)
  upstream.mockClear()
  const kvRead = vi.spyOn(f.kv, 'get')
  f.kv.fail = true
  for (const credential of [token.access_token, f.browserToken()]) {
    const request = new Request('https://mcp.example.invalid' + legacy, {
      method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: {} } }),
    })
    const response = await app.fetch(request, { ...f.env, ...staleEnv })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual(notFound)
    expect(request.bodyUsed).toBe(false)
  }
  expect(kvRead).not.toHaveBeenCalled()
  expect(upstream).not.toHaveBeenCalled()
  expect(f.writes).toHaveLength(0)
})

test('旧 Access 断言不能访问网页 REST 或其他 Agent 路径', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  for (const path of ['/api/ledger/accounts', '/api/ledger/entries/synthetic/refunds', '/api/agent/other', '/api/agent/mcp/other']) {
    const response = await app.request(path, { headers: { 'Cf-Access-Jwt-Assertion': 'synthetic.retired.assertion' } }, staleEnv)
    expect(response.status).toBe(401)
  }
  expect(upstream).not.toHaveBeenCalled()
})
