import { generateKeyPairSync, sign } from 'node:crypto'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { transaction } from '../../worker/database'
vi.mock('../../worker/database', () => ({ transaction: vi.fn() }))
beforeEach(() => vi.mocked(transaction).mockReset().mockResolvedValue({ ownerId: owner }))

const owner = '00000000-0000-4000-8000-000000000001'
const clientId = 'agent-test-client.access'
const team = 'https://agent-test.cloudflareaccess.com'
const audience = 'test-agent-audience'
const env = {
  CF_ACCESS_TEAM_DOMAIN: team,
  CF_ACCESS_AUD: audience,
  SUPABASE_URL: 'https://auth-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
  SUPABASE_SECRET_KEY: 'sb_secret_test-only',
  AUTH_ALLOWED_EMAILS: 'agent@example.invalid',
}
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const assertion = (claims: Record<string, unknown> = {}) => {
  const message = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: team, aud: audience, exp: Math.floor(Date.now() / 1000) + 300, sub: '', common_name: clientId, ...claims })}`
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), pair.privateKey).toString('base64url')}`
}
const user = { id: owner, email: 'agent@example.invalid', email_confirmed_at: '2026-11-01T00:00:00Z', is_anonymous: false }
const call = (token?: string, bindings = env) => app.request('/api/agent/mcp', {
  method: 'POST', headers: { ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } }),
}, bindings)

afterEach(() => vi.unstubAllGlobals())

test('Agent 入口验签、查找绑定并在线核对用户后，进入独立路由', async () => {
  const upstream = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })

    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(user)
    throw new Error('unexpected upstream')
  })
  vi.stubGlobal('fetch', upstream)
  const response = await call(assertion())
  expect(response.status).toBe(200)
  expect(upstream).toHaveBeenCalledTimes(2)
  expect(transaction).toHaveBeenCalledOnce()
})

test('其他不相关的 Cloudflare 公钥不阻止匹配的 RSA 公钥完成验证', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [{ kid: 'unrelated-key', kty: 'EC', crv: 'P-256' }, jwk] })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(user)
    throw new Error('unexpected upstream')
  }))
  expect((await call(assertion())).status).toBe(200)
})

test('身份断言在获取公钥期间过期时不查询绑定', async () => {
  const now = Date.now()
  const token = assertion({ exp: Math.floor(now / 1000) + 2 })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const upstream = vi.fn(async () => {
    clock.mockReturnValue(now + 3000)
    return Response.json({ keys: [jwk] })
  })
  vi.stubGlobal('fetch', upstream)
  expect((await call(token)).status).toBe(401)
  expect(upstream).toHaveBeenCalledOnce()
})

test('Supabase URL 末尾的斜杠不会改变绑定及用户查询地址', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(user)
    throw new Error('unexpected upstream')
  }))
  expect((await call(assertion(), { ...env, SUPABASE_URL: `${env.SUPABASE_URL}/` })).status).toBe(200)
})

test.each([
  ['没有凭据', undefined],
  ['错误 audience', () => assertion({ aud: 'different-audience' })],
  ['过期', () => assertion({ exp: Math.floor(Date.now() / 1000) - 1 })],
  ['尚未生效', () => assertion({ nbf: Math.floor(Date.now() / 1000) + 300 })],
  ['不是服务凭据', () => assertion({ sub: owner })],
  ['篡改身份', () => {
    const parts = assertion().split('.')
    parts[1] = encode({ iss: team, aud: audience, exp: Math.floor(Date.now() / 1000) + 300, sub: '', common_name: 'someone-else.access' })
    return parts.join('.')
  }],
] as const)('%s 时拒绝访问并不查询用户绑定', async (_label, makeToken) => {
  const upstream = vi.fn(async () => Response.json({ keys: [jwk] }))
  vi.stubGlobal('fetch', upstream)
  expect((await call(makeToken?.())).status).toBe(401)
  expect(upstream.mock.calls.length).toBeLessThanOrEqual(1)
})

test.each([
  ['绑定不存在或停用', null, user, 200, env, 401],
  ['账户已删除', { ownerId: owner }, user, 404, env, 401],
  ['账户匿名', { ownerId: owner }, { ...user, is_anonymous: true }, 200, env, 401],
  ['邮箱未验证', { ownerId: owner }, { ...user, email_confirmed_at: null }, 200, env, 401],
  ['邮箱确认时间无效', { ownerId: owner }, { ...user, email_confirmed_at: 'not-a-date' }, 200, env, 401],
  ['账户身份不匹配', { ownerId: owner }, { ...user, id: '00000000-0000-4000-8000-000000000002' }, 200, env, 401],
  ['账户被封禁', { ownerId: owner }, { ...user, banned_until: '2099-01-01T00:00:00Z' }, 200, env, 401],
  ['账户软删除', { ownerId: owner }, { ...user, deleted_at: '2026-11-01T00:00:00Z' }, 200, env, 401],
  ['删除状态格式异常', { ownerId: owner }, { ...user, deleted_at: '' }, 200, env, 401],
  ['移出白名单', { ownerId: owner }, user, 200, { ...env, AUTH_ALLOWED_EMAILS: 'another@example.invalid' }, 403],
  ['用户服务故障', { ownerId: owner }, user, 503, env, 503],
] as const)('%s 时拒绝 Agent 请求', async (_label, ownerResult, currentUser, userStatus, bindings, expected) => {
  vi.mocked(transaction).mockResolvedValue(ownerResult)
  const upstream = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(currentUser, { status: userStatus })
    throw new Error('unexpected upstream')
  })
  vi.stubGlobal('fetch', upstream)
  expect((await call(assertion(), bindings)).status).toBe(expected)
  expect(upstream.mock.calls.length).toBeLessThanOrEqual(3)
})

test('Agent 凭据不能访问现有业务接口或其他 Agent 路径', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  for (const path of ['/api/ledger/accounts', '/api/agent/other', '/api/agent/mcp/other']) {
    const response = await app.request(path, { headers: { 'Cf-Access-Jwt-Assertion': assertion() } }, env)
    expect(response.status).toBe(401)
  }
  expect(upstream).not.toHaveBeenCalled()
})

test('每次请求都重新查询绑定，停用后不能复用先前身份', async () => {
  let active = true
  vi.mocked(transaction).mockImplementation(async () => active ? { ownerId: owner } : null)
  const upstream = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(user)
    throw new Error('unexpected upstream')
  })
  vi.stubGlobal('fetch', upstream)
  expect((await call(assertion())).status).toBe(200)
  active = false
  expect((await call(assertion())).status).toBe(401)
  expect(upstream).toHaveBeenCalledTimes(3)
  expect(transaction).toHaveBeenCalledTimes(2)
})

test.each([
  ['新格式密钥', 'sb_secret_test-only', null],
  ['旧 JWT 格式密钥', 'eyJ-test-only', 'Bearer eyJ-test-only'],
] as const)('%s 只通过服务端请求携带', async (_label, secret, bearer) => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    const headers = new Headers(init?.headers)
    expect(headers.get('apikey')).toBe(secret)
    expect(headers.get('Authorization')).toBe(bearer)
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`) return Response.json(user)
    throw new Error('unexpected upstream')
  }))
  const response = await call(assertion(), { ...env, SUPABASE_SECRET_KEY: secret })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(JSON.stringify(await response.json())).not.toContain(secret)
})

test('非法 Cloudflare 域名配置不会发出上游请求', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  const response = await call(assertion(), { ...env, CF_ACCESS_TEAM_DOMAIN: 'https://example.invalid' })
  expect(response.status).toBe(503)
  expect(upstream).not.toHaveBeenCalled()
})
