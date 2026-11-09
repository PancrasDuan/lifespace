import app from '../../worker/index'

export const tasksRpc = process.env.TASKS_LOCAL_RPC_URL ?? process.env.LEDGER_LOCAL_RPC_URL
export const tasksEnv = {
  SUPABASE_URL: 'https://tasks-local-test.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only',
  AUTH_ALLOWED_EMAILS: 'tasks@example.invalid',
}
const nativeFetch = globalThis.fetch
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

export function tasksRequest(owner: string, timeZone: string) {
  return app.request(
    '/api/tasks/today?timeZone=' + encodeURIComponent(timeZone),
    {
      headers: {
        Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`,
      },
    },
    tasksEnv
  )
}

// Control identity and the Data API address; the Worker still uses the real
// production REST path and a real PostgREST/PostgreSQL instance.
export function installTasksDatabase() {
  const target = new URL(tasksRpc!)
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password)
    throw new Error('仅允许本机隔离数据库')
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== tasksEnv.SUPABASE_URL) return nativeFetch(input, init)
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init?.headers).get('Authorization')!.split('.')[1]
      const { sub } = JSON.parse(atob(token)) as { sub: string }
      return Response.json({ id: sub, email: 'tasks@example.invalid', email_confirmed_at: '2026-10-01', is_anonymous: false })
    }
    if (url.pathname !== '/rest/v1/tasks') throw new Error('禁止非任务来源请求')
    return nativeFetch(new URL('/tasks' + url.search, target), init)
  }
  return () => { globalThis.fetch = nativeFetch }
}
