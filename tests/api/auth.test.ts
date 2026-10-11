import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { Webhook } from 'standardwebhooks'

afterEach(() => vi.unstubAllGlobals())

const env = {
  SUPABASE_URL: 'https://auth-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
  AUTH_ALLOWED_EMAILS: 'demo@example.com',
}
const claims = { sub: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode(claims)}.test-signature`

test('未登录用户不能读取业务接口', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  const response = await app.request('/api/tasks/today', {}, {})
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
  expect(upstream).not.toHaveBeenCalled()
})

test('名单内已验证账户经在线会话检查后取得最小准入身份', async () => {
  const upstream = vi.fn(async (_input: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
    return Response.json({ id: claims.sub, email: 'demo@example.com', email_confirmed_at: '2026-10-11T00:00:00Z', is_anonymous: false })
  })
  vi.stubGlobal('fetch', upstream)
  const response = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ user: { id: claims.sub, email: 'demo@example.com' } })
  expect(upstream).toHaveBeenCalledOnce()
})

test.each([
  ['AUTH_DENIED', 403, { ...env, AUTH_ALLOWED_EMAILS: 'other@example.com' }, 200],
  ['AUTH_UNAVAILABLE', 503, { ...env, AUTH_ALLOWED_EMAILS: '' }, 200],
  ['AUTH_INVALID', 401, env, 401],
  ['AUTH_UNAVAILABLE', 503, env, 500],
] as const)('%s 拒绝业务访问（%s）', async (code, status, bindings, upstreamStatus) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: claims.sub, email: 'demo@example.com', email_confirmed_at: '2026-10-11', is_anonymous: false }, { status: upstreamStatus })))
  const response = await app.request('/api/news/sources', { headers: { Authorization: `Bearer ${token}` } }, bindings)
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ error: { code } })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

test('公开配置只返回 SDK 所需公开标识', async () => {
  const response = await app.request('/api/auth/config', {}, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY })
})

const hookSecret = btoa('test-hook-secret-at-least-32-bytes')
test.each([['demo@example.com', 200], ['other@example.com', 403]])('签名注册 Hook 检查邮箱 %s', async (email, status) => {
  const body = JSON.stringify({ user: { email, is_anonymous: false } })
  const timestamp = new Date()
  const response = await app.request('/api/auth/hooks/before-user-created', {
    method: 'POST', body, headers: {
      'webhook-id': 'test-event', 'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': new Webhook(hookSecret).sign('test-event', timestamp, body),
    },
  }, { ...env, AUTH_HOOK_SECRET: `v1,${hookSecret}` })
  expect(response.status).toBe(status)
})
test('无签名不能调用注册 Hook', async () => {
  const response = await app.request('/api/auth/hooks/before-user-created', { method: 'POST', body: '{}' }, { ...env, AUTH_HOOK_SECRET: hookSecret })
  expect(response.status).toBe(403)
})

test.each([
  { id: claims.sub, email: 'demo@example.com', is_anonymous: true, email_confirmed_at: '2026-10-11' },
  { id: claims.sub, email: 'demo@example.com', is_anonymous: false, email_confirmed_at: null },
  { id: '00000000-0000-4000-8000-000000000009', email: 'demo@example.com', is_anonymous: false, email_confirmed_at: '2026-10-11' },
])('拒绝匿名、未验证或身份不匹配的会话 %#', async user => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(user)))
  const response = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(401)
})

test('缺少 session_id 的历史凭据不触发上游或业务读取', async () => {
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream)
  const oldToken = `${encode({ alg: 'HS256' })}.${encode({ sub: claims.sub, exp: claims.exp })}.test-signature`
  const response = await app.request('/api/news/sources', { headers: { Authorization: `Bearer ${oldToken}` } }, env)
  expect(response.status).toBe(401); expect(upstream).not.toHaveBeenCalled()
})

test('每次访问重新验证会话，已撤销会话不能复用准入结果', async () => {
  const upstream = vi.fn().mockResolvedValueOnce(Response.json({ id: claims.sub, email: 'demo@example.com', email_confirmed_at: '2026-10-11', is_anonymous: false })).mockResolvedValueOnce(Response.json({ code: 'session_not_found' }, { status: 401 }))
  vi.stubGlobal('fetch', upstream)
  const request = () => app.request('/api/news/sources', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect((await request()).status).toBe(200); expect((await request()).status).toBe(401)
  expect(upstream).toHaveBeenCalledTimes(2)
})

test('篡改签名原文或过期签名都不能注册', async () => {
  const body = JSON.stringify({ user: { email: 'demo@example.com' } })
  for (const stale of [false, true]) {
    const date = new Date(Date.now() - (stale ? 600000 : 0))
    const response = await app.request('/api/auth/hooks/before-user-created', {
      method: 'POST', body: stale ? body : `${body} `, headers: {
        'webhook-id': 'test-event', 'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
        'webhook-signature': new Webhook(hookSecret).sign('test-event', date, body),
      },
    }, { ...env, AUTH_HOOK_SECRET: hookSecret })
    expect(response.status).toBe(403)
  }
})
