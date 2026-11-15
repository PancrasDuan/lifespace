import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'

const env = { SUPABASE_URL: 'https://synthetic-token.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', SUPABASE_SECRET_KEY: 'synthetic-server-only', AUTH_ALLOWED_EMAILS: 'demo@example.com' }
const claims = { sub: '00000000-0000-4000-8000-000000000209', session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 }
const jwt = `${btoa('{}').replace(/=/g, '')}.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.synthetic`
const auth = { Authorization: `Bearer ${jwt}` }
const post = (path: string, body: unknown, logged = false) => app.request(`/api/token/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(logged ? auth : {}) }, body: JSON.stringify(body) }, env)
const user = { id: claims.sub, email: 'demo@example.com', email_confirmed_at: '2026-11-15', is_anonymous: false }
afterEach(() => vi.unstubAllGlobals())

test.each(['usage?startDate=2026-01-01&endDate=2026-12-31', 'devices'])('Token browser query %s requires real online admission', async path => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect((await app.request(`/api/token/${path}`, {}, env)).status).toBe(401); expect(fetcher).not.toHaveBeenCalled()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...user, email: 'removed@example.com' })))
  const denied = await app.request(`/api/token/${path}`, { headers: auth }, env)
  expect(denied.status).toBe(403); expect(denied.headers.get('Cache-Control')).toBe('no-store')
})
test('approval and disable never accept device tokens as browser login', async () => {
  expect((await post('registrations/decide', {}, false)).status).toBe(401)
  expect((await post('devices/disable', {}, false)).status).toBe(401)
})
test('short code and device ID cannot replace high entropy claim credential', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  for (const claimSecret of ['ABCDEFGH', 'synthetic-device', '', 'a'.repeat(42)]) {
    expect((await post('registrations/claim', { requestId: claims.sub, claimSecret })).status).toBe(400)
  }
  expect(fetcher).not.toHaveBeenCalled()
})
test('registration/claim derivation survives a lost claim response without exposing token to browser APIs', async () => {
  let stored: Record<string, any> = {}
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const name = String(url).split('/').at(-1)
    expect(new Headers(init?.headers).get('apikey')).toBe(env.SUPABASE_SECRET_KEY)
    const params = JSON.parse(String(init?.body))
    if (name === 'token_registration_start') { stored = params; return Response.json({ requestId: params.p_id, expiresIn: 600, interval: 5 }) }
    if (name === 'token_registration_claim') {
      expect(params.p_claim_hash).toBe(stored.p_claim_hash)
      return Response.json({ status: 'claimed', deviceId: stored.p_device, generation: '1', tokenExpiresAt: null })
    }
    throw new Error('unexpected endpoint')
  }); vi.stubGlobal('fetch', fetcher)
  const started = await post('registrations/start', { deviceId: 'synthetic-device', hostname: 'same-host', platform: 'linux' })
  expect(started.status).toBe(201); const registration = await started.json() as any
  expect(registration.claimSecret).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(registration.code).toMatch(/^[A-Z2-9]{8}$/)
  expect(JSON.stringify(stored)).not.toContain(registration.claimSecret)
  const claim = { requestId: registration.requestId, claimSecret: registration.claimSecret }
  const first = await (await post('registrations/claim', claim)).json() as any
  const recovered = await (await post('registrations/claim', claim)).json()
  expect(first.uploadToken).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(first.uploadToken).not.toBe(registration.claimSecret); expect(recovered).toEqual(first)
  expect(JSON.stringify(stored)).not.toContain(first.uploadToken)
  expect(first.upload).toMatchObject({ header: 'X-LifeSpace-Device-Token', publishableKey: env.SUPABASE_PUBLISHABLE_KEY })
})
test('query filters are bounded, duplicates/unknown fields rejected before business RPC', async () => {
  const fetcher = vi.fn(async () => Response.json(user)); vi.stubGlobal('fetch', fetcher)
  for (const query of ['startDate=2020-01-01&endDate=2026-12-31', 'startDate=2026-11-15&endDate=2026-01-01', 'startDate=2026-01-01&endDate=2026-12-31&agent=codex&agent=other', 'startDate=2026-01-01&endDate=2026-12-31&modelKey=invalid', 'startDate=2026-01-01&endDate=2026-12-31&rawPath=x']) {
    expect((await app.request(`/api/token/usage?${query}`, { headers: auth }, env)).status).toBe(400)
  }
  expect(fetcher).toHaveBeenCalledTimes(5)
})
test('read RPC receives only validated filters, shared query stays behind existing admission', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json(user)
    expect(String(url)).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/token_dashboard_query`)
    expect(JSON.parse(String(init?.body))).toEqual({ p_query: { startDate: '2026-01-01', endDate: '2026-12-31', modelKey: 'null' } })
    return Response.json({ timeZone: 'Asia/Shanghai', scope: 'model', rows: [], nextCursor: null })
  }); vi.stubGlobal('fetch', fetcher)
  const response = await app.request('/api/token/usage?startDate=2026-01-01&endDate=2026-12-31&modelKey=null', { headers: auth }, env)
  expect(response.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(2)
})
test('malformed/oversized upstream data and server errors never return secrets or payload', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sensitive: 'synthetic-private-value' })))
  const response = await post('registrations/start', { deviceId: 'synthetic-device', hostname: 'host', platform: 'linux' })
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('synthetic-private-value')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'TOKEN_RATE_LIMIT' })))
  expect((await post('registrations/start', { deviceId: 'synthetic-device', hostname: 'host', platform: 'linux' })).status).toBe(429)
})
