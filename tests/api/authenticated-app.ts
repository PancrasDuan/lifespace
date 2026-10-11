import app from '../../worker/index'

const identity = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', email_confirmed_at: '2026-10-11', is_anonymous: false }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: identity.id, session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 })}.test-signature`

// 既有业务回归仍通过真实 Worker 鉴权，只在外部 Auth HTTP 边界提供已登录账户。
export default {
  async request(input: string | URL | Request, init: RequestInit = {}, env: Partial<CloudflareEnv> = {}) {
    const upstream = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      const href = url instanceof Request ? url.url : String(url)
      if (new URL(href).pathname === '/auth/v1/user') return Response.json(identity)
      return upstream(url, options)
    }
    try {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return await app.request(input, { ...init, headers }, {
        ...env, SUPABASE_URL: env.SUPABASE_URL ?? 'https://auth-test.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: identity.email,
      })
    } finally { globalThis.fetch = upstream }
  },
}
