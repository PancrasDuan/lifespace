import { createServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import type workerApp from '../../worker/index'
import { alapiSuccess } from './horoscope'
import { beijingDate } from '../../src/shared/horoscope-contracts'

export const horoscopeTestUser = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', email_confirmed_at: '2026-10-11', is_anonymous: false }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
export const horoscopeTestToken = `${encode({ alg: 'HS256' })}.${encode({ sub: horoscopeTestUser.id, session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 })}.test-signature`

// 仅供测试/本地预览使用。正式 Worker 不导入此文件，也没有测试专用路由。
export async function startHoroscopeWorker(options: { day?: string; longText?: boolean } = {}) {
  const modules = await createViteServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
  const app: typeof workerApp = (await modules.ssrLoadModule('/worker/index.ts')).default
  const entries = new Map<string, string>()
  const calls = { alapi: 0, kvReads: 0, kvWrites: 0, api: 0, auth: 0 }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://auth-test.supabase.co/auth/v1/user') {
      calls.auth++
      return new Headers(init?.headers).get('Authorization') === `Bearer ${horoscopeTestToken}` ? Response.json(horoscopeTestUser) : new Response(null, { status: 401 })
    }
    if (url === 'https://v3.alapi.cn/api/star') {
      calls.alapi++
      const body = alapiSuccess(options.day ?? beijingDate(Date.now()))
      if (options.longText) body.data.day.health_text = '健康正文末尾。'.repeat(180) + '完整解读结束'
      return Response.json(body)
    }
    throw new Error('测试未允许访问此上游')
  }
  const kv = {
    get: async (key: string) => { calls.kvReads++; return entries.get(key) ?? null },
    put: async (key: string, value: string) => { calls.kvWrites++; entries.set(key, value) },
  } as unknown as KVNamespace
  const server = createServer(async (req, res) => {
    try {
      calls.api++
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      const response = await app.request(`http://127.0.0.1${req.url}`, { method: req.method, headers }, {
        SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: horoscopeTestUser.email,
        ALAPI_TOKEN: 'test-horoscope-credential', HOROSCOPE_KV: kv,
      })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
    } catch { res.writeHead(500); res.end('测试 Worker 失败') }
  })
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }) }
  catch (error) { globalThis.fetch = originalFetch; await modules.close(); throw error }
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试端口不可用')
  return {
    url: `http://127.0.0.1:${address.port}`, calls, entries,
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); globalThis.fetch = originalFetch; await modules.close() },
  }
}
