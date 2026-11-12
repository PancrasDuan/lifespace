import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json' }
afterEach(() => vi.unstubAllGlobals())

it('只读回执关联当前查询并拒绝无效 nonce', async () => {
  const nonce = 'a'.repeat(64)
  const envelope = { requestId: 'legacy-request-001', expectedVersion: 2, command: { type: 'createGoal', destination: '', title: '旧目标', standards: ['标准'] }, nonce }
  const receipt = { version: 3, result: { entityId: owner, message: '已保存' } }
  const calls: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push(JSON.parse(String(init?.body)))
    return Response.json(receipt)
  })
  const request = (body: unknown) => app.request('/api/adventure/receipts/lookup', { method: 'POST', headers, body: JSON.stringify(body) }, env)
  for (const value of ['bad', 'A'.repeat(64), 'a'.repeat(63), null]) {
    expect((await request({ ...envelope, nonce: value })).status).toBe(400)
  }
  const { nonce: _nonce, ...withoutNonce } = envelope
  expect((await request(withoutNonce)).status).toBe(400)
  expect(calls).toHaveLength(0)
  const response = await request(envelope)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-lifespace-adventure-model')).toBe('goal-categories-1')
  expect(await response.json()).toEqual({ requestId: envelope.requestId, nonce, receipt })
  expect(calls).toEqual([{ p_owner: owner, p_request_id: envelope.requestId, p_command: envelope.command }])
})

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
