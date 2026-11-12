import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json' }
afterEach(() => vi.unstubAllGlobals())

it('握手要求身份、不缓存；切换后旧重试路由明确拒绝且不调用数据库', async () => {
  let databaseCalls = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    databaseCalls++
    throw new Error('unexpected RPC')
  })
  expect((await app.request('/api/adventure/compatibility', {}, env)).status).toBe(401)
  expect((await app.request('/api/adventure/receipts/lookup', { method: 'POST', body: '{}' }, env)).status).toBe(401)
  expect((await app.request('/api/adventure/legacy-retry', { method: 'POST', body: '{}' }, env)).status).toBe(401)
  const handshake = await app.request('/api/adventure/compatibility', { headers }, env)
  expect(handshake.status).toBe(200)
  expect(handshake.headers.get('cache-control')).toBe('no-store')
  expect(await handshake.json()).toEqual({ model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false })
  for (const body of ['{}', 'invalid json']) {
    const response = await app.request('/api/adventure/legacy-retry', { method: 'POST', headers, body }, env)
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED', message: expect.stringContaining('不要刷新') } })
  }
  expect(databaseCalls).toBe(0)
})
