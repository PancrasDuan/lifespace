import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'allowed@example.invalid' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const owner = '00000000-0000-4000-8000-000000000054'
const token = `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`
afterEach(() => vi.unstubAllGlobals())

it('旧版命令在认证前固定失败关闭，新版和其他接口仍执行认证', async () => {
  let authCalls = 0, databaseCalls = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') {
      authCalls++
      return Response.json({ id: owner, email: 'denied@example.invalid', email_confirmed_at: '2026-10-20', is_anonymous: false })
    }
    databaseCalls++
    throw new Error('unexpected database call')
  })
  for (const authorization of [undefined, 'Bearer expired', token]) {
    const headers = { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }
    const response = await app.request('/api/adventure/commands', { method: 'POST', headers, body: '{}' }, env)
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED', message: expect.stringContaining('不要刷新') } })
  }
  expect(authCalls).toBe(0)
  expect(databaseCalls).toBe(0)
  const current = await app.request('/api/adventure/commands', { method: 'POST', headers: { Authorization: token, 'X-Adventure-Client-Version': 'goal-categories-1' }, body: '{}' }, env)
  expect(current.status).toBe(403)
  expect(await current.json()).toMatchObject({ error: { code: 'AUTH_DENIED' } })
  expect(authCalls).toBe(1)
  const forged = await app.request('/api/adventure/commands', { method: 'POST', headers: { 'X-Adventure-Client-Version': 'goal-categories-1', Authorization: 'Bearer expired' }, body: '{}' }, env)
  expect(forged.status).toBe(401)
  expect((await app.request('/api/adventure/commands', { method: 'GET' }, env)).status).toBe(401)
  expect((await app.request('/api/adventure/commands/', { method: 'POST', body: '{}' }, env)).status).toBe(401)
  expect((await app.request('/api/adventure/receipts/lookup', { method: 'POST', body: '{}' }, env)).status).toBe(401)
  expect((await app.request('/api/adventure/compatibility', {}, env)).status).toBe(401)
  expect((await app.request('/api/adventure/legacy-retry', { method: 'POST', body: '{}' }, env)).status).toBe(401)
  expect(databaseCalls).toBe(0)
})
