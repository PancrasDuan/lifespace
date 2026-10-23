import { expect, type BrowserContext } from '@playwright/test'
import app from '../../worker/index'
import { planningPageSchema, planningReceiptSchema } from '../../src/shared/adventure-planning'
import { growthPageSchema } from '../../src/shared/adventure-growth'

export const localPlanningRpc = process.env.ADVENTURE_LOCAL_RPC_URL
const nativeFetch = globalThis.fetch
const env = {
  SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'actions@example.invalid',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

// Only identity is controlled; all business requests use the real Worker and local RPC.
export function planningDatabaseBrowser() {
  let owner = crypto.randomUUID()
  const request = (path: string, body?: unknown) => app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  const snapshot = async (query = '') => {
    const response = await request('/api/adventure' + query)
    expect(response.status).toBe(200)
    return planningPageSchema.parse(await response.json())
  }
  return {
    request, snapshot,
    async install(context: BrowserContext) {
      owner = crypto.randomUUID()
      const target = new URL(localPlanningRpc!)
      if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('只允许本机隔离 RPC')
      globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.origin !== env.SUPABASE_URL) return nativeFetch(input, init)
        if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'actions@example.invalid', email_confirmed_at: '2026-10-21', is_anonymous: false })
        if (!url.pathname.startsWith('/rest/v1/rpc/adventure_')) throw new Error('禁止非 RPC 请求')
        return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
      }
      await context.route('**/api/adventure**', async route => {
        const input = route.request(), url = new URL(input.url())
        const response = await request(url.pathname + url.search, input.method() === 'GET' ? undefined : input.postDataJSON())
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
      })
    },
    restore() { globalThis.fetch = nativeFetch },
    async write(command: unknown) {
      const response = await request('/api/adventure/commands', { expectedVersion: (await snapshot()).version, requestId: crypto.randomUUID(), command })
      expect(response.status).toBe(200)
      return planningReceiptSchema.parse(await response.json())
    },
    async growth() {
      const response = await request('/api/adventure/growth')
      expect(response.status).toBe(200)
      return growthPageSchema.parse(await response.json())
    },
  }
}
