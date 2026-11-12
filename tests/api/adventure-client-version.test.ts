import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json' }
afterEach(() => vi.unstubAllGlobals())

it('旧客户端不能执行仍合法的写入，新客户端可以发送同一封套', async () => {
  let writes = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    writes++
    return Response.json({ version: 1, result: { entityId: owner, message: '已创建' } })
  })
  const body = JSON.stringify({ requestId: 'client-version-test', expectedVersion: 0, command: { type: 'createTask', title: '行动', description: '', plannedOn: '2026-11-12', destination: '' } })
  for (const version of [undefined, 'old', '']) {
    const response = await app.request('/api/adventure/commands', { method: 'POST', headers: { ...headers, ...(version === undefined ? {} : { 'X-Adventure-Client-Version': version }) }, body }, env)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED', message: expect.stringContaining('不要刷新') } })
  }
  expect(writes).toBe(0)
  expect((await app.request('/api/adventure/commands', { method: 'POST', headers: { ...headers, 'X-Adventure-Client-Version': 'goal-categories-1' }, body }, env)).status).toBe(200)
  expect(writes).toBe(1)
})
