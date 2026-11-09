import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { clearTraceSpan, installTraceSpan, type TestSpan } from '../support/cloudflare-workers'

afterEach(() => { vi.unstubAllGlobals(); clearTraceSpan() })

const env = {
  SUPABASE_URL: 'https://auth-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
  SUPABASE_SECRET_KEY: 'sb_secret_test-only',
  AUTH_ALLOWED_EMAILS: 'demo@example.com',
}
const userId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const claims = { sub: userId, session_id: sessionId, exp: 4102444800 }
const token = `${encode({ alg: 'HS256' })}.${encode(claims)}.test-signature`
const user = { id: userId, email: 'demo@example.com', email_confirmed_at: '2026-10-11T00:00:00Z', is_anonymous: false }
let span: TestSpan

beforeEach(() => { span = installTraceSpan() })

function forbidSecrets() {
  const serialized = JSON.stringify(span.attributes)
  expect(serialized).not.toContain('demo@example.com')
  expect(serialized).not.toContain(token)
  expect(serialized).not.toContain('sb_secret_test-only')
  expect(serialized).not.toContain('sb_publishable_test-only')
  expect(serialized).not.toContain('do-not-trace')
  expect(serialized).not.toContain('sekret')
  expect(serialized).not.toContain('database down')
}

test('认证成功后把身份、会话和路径写到根 span，且不改变响应', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(user)))
  const response = await app.request('/api/auth/me?do-not-trace=1', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ user: { id: userId, email: 'demo@example.com' } })
  expect(span.attributes).toEqual({ 'user.id': userId, 'session.id': sessionId, 'http.route': '/api/auth/me' })
  forbidSecrets()
})

test('没有活动 span 时认证响应保持不变', async () => {
  clearTraceSpan()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(user)))
  const response = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ user: { id: userId, email: 'demo@example.com' } })
})

test('未登录失败只写错误码和路径', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  const response = await app.request('/api/tasks/today?do-not-trace=1', {}, env)
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED', message: '请先登录' } })
  expect(upstream).not.toHaveBeenCalled()
  expect(span.attributes).toEqual({ 'error.code': 'AUTH_REQUIRED', 'http.route': '/api/tasks/today' })
  forbidSecrets()
})

test.each([
  ['上游 HTTP 500', async () => new Response('database down sekret', { status: 500 }), { 'upstream.http.status_code': 500 }],
  ['网络失败', async () => { throw new TypeError('network down') }, { 'upstream.failure': 'network' }],
  ['超时', async () => { throw new DOMException('timed out', 'TimeoutError') }, { 'upstream.failure': 'timeout' }],
  ['无效响应', async () => new Response('not-json', { status: 200 }), { 'upstream.failure': 'invalid-response' }],
] as const)('认证上游%s时写入失败上下文且保持 503 正文', async (_label, respond, extra) => {
  vi.stubGlobal('fetch', vi.fn(respond))
  const response = await app.request('/api/news/sources', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: { code: 'AUTH_UNAVAILABLE', message: '认证服务暂时不可用，请稍后重试' } })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(span.attributes).toEqual({ 'error.code': 'AUTH_UNAVAILABLE', 'http.route': '/api/news/sources', ...extra })
  forbidSecrets()
})

test('上游拒绝凭据时不把 401 当成上游故障', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'sekret' }, { status: 401 })))
  const response = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: { code: 'AUTH_INVALID', message: '登录已失效，请重新登录' } })
  expect(span.attributes).toEqual({ 'error.code': 'AUTH_INVALID', 'http.route': '/api/auth/me' })
  forbidSecrets()
})

function ledgerFetch(accounts: () => Response | Promise<Response>) {
  return vi.fn(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url).pathname === '/auth/v1/user') return Response.json(user)
    return accounts()
  })
}

test('查询串不会进入 span，账户校验失败也不读取账单上游', async () => {
  const upstream = ledgerFetch(() => { throw new Error('should not read ledger') })
  vi.stubGlobal('fetch', upstream)
  const response = await app.request('/api/ledger/accounts?ownerId=do-not-trace', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: { code: 'INVALID_QUERY', message: '日期或分页参数无效' } })
  expect(upstream).toHaveBeenCalledOnce()
  expect(span.attributes).toEqual({
    'user.id': userId, 'session.id': sessionId, 'http.route': '/api/ledger/accounts', 'error.code': 'INVALID_QUERY',
  })
  forbidSecrets()
})

test.each([
  ['上游 HTTP 502', async () => Response.json({ message: 'database down', token: 'sekret' }, { status: 502 }), { 'upstream.http.status_code': 502 }],
  ['网络失败', async () => { throw new TypeError('network down') }, { 'upstream.failure': 'network' }],
  ['超时', async () => { throw new DOMException('timed out', 'TimeoutError') }, { 'upstream.failure': 'timeout' }],
  ['响应无法解析', async () => Response.json({ accounts: 'sekret' }, { status: 200 }), { 'upstream.failure': 'invalid-response' }],
] as const)('读取账户时账单上游%s仍返回原来的 503', async (_label, accounts, extra) => {
  vi.stubGlobal('fetch', ledgerFetch(accounts))
  const response = await app.request('/api/ledger/accounts', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: { code: 'LEDGER_UNAVAILABLE', message: '暂时无法读取账户，请稍后重试' } })
  expect(span.attributes).toEqual({
    'user.id': userId, 'session.id': sessionId, 'http.route': '/api/ledger/accounts', 'error.code': 'LEDGER_UNAVAILABLE', ...extra,
  })
  forbidSecrets()
})

test('其他上游 fetch 失败时也写入 HTTP 状态，不改变天气错误正文', async () => {
  vi.stubGlobal('fetch', ledgerFetch(async () => new Response('sekret', { status: 503 })))
  const response = await app.request('/api/weather/locations?q=do-not-trace', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ error: { code: 'SOURCE_UNAVAILABLE', message: '数据源暂时不可用，请稍后刷新' } })
  expect(span.attributes).toEqual({
    'user.id': userId, 'session.id': sessionId, 'http.route': '/api/weather/locations',
    'error.code': 'SOURCE_UNAVAILABLE', 'upstream.http.status_code': 503,
  })
  forbidSecrets()
})
