import { z } from 'zod'
import { allowedEmails, publicConfig, type AuthEnv, type Identity } from './auth'
import { readBoundedBody } from './read-body'
import { ApiError } from './upstream'
import { traceUpstreamFailure, traceUpstreamStatus, upstreamFailureType } from './trace'

const invalid = () => new ApiError('AUTH_INVALID', 'Agent 凭据无效或已失效', 401)
const unavailable = () => new ApiError('AUTH_UNAVAILABLE', '认证服务暂时不可用，请稍后重试', 503)
const denied = () => new ApiError('AUTH_DENIED', '此账户暂未获准访问', 403)
const timestamp = z.string().min(1).refine(value => Number.isFinite(Date.parse(value)))
const authUser = z.object({
  id: z.uuid(), email: z.email(), email_confirmed_at: timestamp, is_anonymous: z.literal(false),
  banned_until: timestamp.nullable().optional(), deleted_at: timestamp.nullable().optional(),
})

async function jsonResponse(url: string, init: RequestInit): Promise<{ status: number; value: unknown }> {
  let response: Response | undefined
  try {
    response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (!response.ok) { traceUpstreamStatus(response.status); return { status: response.status, value: null } }
    if (!response.body) { traceUpstreamFailure('invalid-response'); throw unavailable() }
    return { status: response.status, value: JSON.parse(await readBoundedBody(response.body, 65536, 5000)) }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (response && !response.ok) traceUpstreamStatus(response.status)
    else traceUpstreamFailure(upstreamFailureType(error))
    throw unavailable()
  }
}

// OAuth grants re-check current user state and admission without a browser session.
export async function verifyAgentUser(env: AuthEnv, ownerId: string): Promise<Identity> {
  if (!env.SUPABASE_SECRET_KEY) throw unavailable()
  const base = publicConfig(env).url.replace(/\/$/, '')
  const secret = env.SUPABASE_SECRET_KEY
  const headers = new Headers({ apikey: secret })
  if (secret.startsWith('eyJ')) headers.set('Authorization', `Bearer ${secret}`)
  const current = await jsonResponse(`${base}/auth/v1/admin/users/${ownerId}`, { headers })
  if (current.status === 404) throw invalid()
  const parsed = authUser.safeParse(current.value)
  if (current.status !== 200) throw unavailable()
  if (!parsed.success || parsed.data.id !== ownerId || parsed.data.deleted_at) throw invalid()
  if (parsed.data.banned_until) {
    const until = Date.parse(parsed.data.banned_until)
    if (!Number.isFinite(until) || until > Date.now()) throw invalid()
  }
  const email = parsed.data.email.trim().toLowerCase()
  if (!allowedEmails(env).has(email)) throw denied()
  return { id: parsed.data.id, email }
}
