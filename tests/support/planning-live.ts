import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import app from '../../worker/index'
import { planningPageSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

export const liveEnabled = process.env.ADVENTURE_LIVE_TEST === '1'
type User = { id: string; email: string; token: string; session: Record<string, unknown> }

export async function livePlanning() {
  const url = process.env.ADVENTURE_TEST_URL!
  const secret = process.env.ADVENTURE_TEST_SECRET!
  const publishable = process.env.ADVENTURE_TEST_PUBLISHABLE!
  if (!url || !secret || !publishable) throw new Error('需要显式提供隔离验收配置')
  const headers = { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}), 'Content-Type': 'application/json' }
  const ids: string[] = []
  const users: User[] = []
  const auth = async (path: string, init: RequestInit) => {
    const response = await fetch(`${url}/auth/v1/${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`隔离账户准备失败 HTTP ${response.status}`)
    return response.json()
  }
  const cleanup = async () => {
    // Only users created by this invocation are removed. Business probe rows are listed for scoped SQL cleanup.
    mkdirSync('.cache', { recursive: true })
    let previous: string[] = []
    try { previous = JSON.parse(readFileSync('.cache/adventure54-probe-owners.json', 'utf8')) } catch {}
    writeFileSync('.cache/adventure54-probe-owners.json', JSON.stringify([...new Set([...previous, ...ids])]))
    for (const id of ids) await auth(`admin/users/${id}`, { method: 'DELETE' })
  }
  try {
    for (let i = 0; i < 2; i++) {
      const email = `lifespace54-${crypto.randomUUID()}@example.invalid`
      const password = `${crypto.randomUUID()}Aa1!`
      const user = z.object({ id: z.uuid() }).parse(await auth('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }))
      ids.push(user.id)
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: publishable, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`隔离登录失败 HTTP ${response.status}`)
      const session = z.object({ access_token: z.string(), refresh_token: z.string(), expires_at: z.number(), user: z.object({ id: z.uuid() }).passthrough() }).passthrough().parse(await response.json())
      users.push({ id: user.id, email, token: session.access_token, session })
    }
  } catch (error) { await cleanup(); throw error }
  const env = { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: publishable, AUTH_ALLOWED_EMAILS: users.map(user => user.email).join(',') }
  const request = (index = 0, path = '/api/adventure', body?: unknown) => app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${users[index].token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  const read = async (index = 0, page = 1, pageSize = 20) => {
    const response = await request(index, `/api/adventure?page=${page}&pageSize=${pageSize}`)
    if (!response.ok) throw new Error(`正式页面读取失败 HTTP ${response.status}`)
    return planningPageSchema.parse(await response.json())
  }
  const command = async (command: PlanningCommand, index = 0) => {
    const page = await read(index)
    const response = await request(index, '/api/adventure/commands', { requestId: crypto.randomUUID(), expectedVersion: page.version, command })
    if (!response.ok) throw new Error(`正式命令失败 HTTP ${response.status}`)
    return planningReceiptSchema.parse(await response.json())
  }
  const database = (path: string, init: RequestInit = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) })
  return { users, env, request, read, command, database, cleanup }
}
export type LivePlanning = Awaited<ReturnType<typeof livePlanning>>
