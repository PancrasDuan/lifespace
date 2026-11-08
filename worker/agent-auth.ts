import { z } from 'zod'
import { allowedEmails, publicConfig, type AuthEnv, type Identity } from './auth'
import { readBoundedBody } from './read-body'
import { ApiError } from './upstream'
import { transaction } from './database'

export type AgentAuthEnv = AuthEnv & { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string }

const invalid = () => new ApiError('AUTH_INVALID', 'Agent 凭据无效或已失效', 401)
const unavailable = () => new ApiError('AUTH_UNAVAILABLE', '认证服务暂时不可用，请稍后重试', 503)
const denied = () => new ApiError('AUTH_DENIED', '此账户暂未获准访问', 403)
const authHeader = z.object({ alg: z.literal('RS256'), kid: z.string().min(1).max(128) })
const authClaims = z.object({
  iss: z.string(), aud: z.union([z.string(), z.array(z.string()).max(32)]),
  exp: z.number().finite(), nbf: z.number().finite().optional(), sub: z.literal(''),
  common_name: z.string().min(1).max(256),
})
const publicKey = z.object({
  kid: z.string().min(1).max(128), kty: z.literal('RSA'), n: z.string().min(1), e: z.string().min(1),
  alg: z.literal('RS256').optional(), use: z.literal('sig').optional(),
}).passthrough()
const publicKeys = z.object({ keys: z.array(z.unknown()).max(32) })
const binding = z.object({ ownerId: z.uuid() }).nullable()
const timestamp = z.string().min(1).refine(value => Number.isFinite(Date.parse(value)))
const authUser = z.object({
  id: z.uuid(), email: z.email(), email_confirmed_at: timestamp, is_anonymous: z.literal(false),
  banned_until: timestamp.nullable().optional(), deleted_at: timestamp.nullable().optional(),
})

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid()
  try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)) }
  catch { throw invalid() }
}
function decodeJson(value: string): unknown {
  try { return JSON.parse(new TextDecoder().decode(decode(value))) }
  catch { throw invalid() }
}
function config(env: AgentAuthEnv) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || env.CF_ACCESS_AUD.length > 256 || !env.SUPABASE_SECRET_KEY) throw unavailable()
  try {
    const url = new URL(env.CF_ACCESS_TEAM_DOMAIN)
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || url.origin !== env.CF_ACCESS_TEAM_DOMAIN) throw unavailable()
    return { issuer: url.origin, audience: env.CF_ACCESS_AUD, secret: env.SUPABASE_SECRET_KEY, base: publicConfig(env).url.replace(/\/$/, '') }
  } catch { throw unavailable() }
}
async function jsonResponse(url: string, init: RequestInit): Promise<{ status: number; value: unknown }> {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { status: response.status, value: null }
    if (!response.body) throw unavailable()
    return { status: response.status, value: JSON.parse(await readBoundedBody(response.body, 65536, 5000)) }
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
}

export async function verifyAgentIdentity(env: AgentAuthEnv, assertion?: string): Promise<Identity> {
  if (!assertion || assertion.length > 16384) throw invalid()
  const { issuer, audience, secret, base } = config(env)
  const parts = assertion.split('.')
  if (parts.length !== 3) throw invalid()
  const header = authHeader.safeParse(decodeJson(parts[0]))
  const claims = authClaims.safeParse(decodeJson(parts[1]))
  if (!header.success || !claims.success) throw invalid()
  const now = Date.now() / 1000
  const audiences = typeof claims.data.aud === 'string' ? [claims.data.aud] : claims.data.aud
  if (claims.data.iss !== issuer || !audiences.includes(audience) || claims.data.exp <= now ||
    (claims.data.nbf !== undefined && claims.data.nbf > now)) throw invalid()

  const jwks = await jsonResponse(`${issuer}/cdn-cgi/access/certs`, {})
  const parsedKeys = publicKeys.safeParse(jwks.value)
  if (jwks.status !== 200 || !parsedKeys.success) throw unavailable()
  const matching = parsedKeys.data.keys.filter(key => typeof key === 'object' && key !== null && 'kid' in key && key.kid === header.data.kid)
  if (matching.length !== 1) throw invalid()
  const selected = publicKey.safeParse(matching[0])
  if (!selected.success) throw invalid()
  try {
    const key = await crypto.subtle.importKey('jwk', selected.data, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), message)) throw invalid()
  } catch (error) { if (error instanceof ApiError) throw error; throw invalid() }
  if (claims.data.exp <= Date.now() / 1000) throw invalid()

  const headers = new Headers({ apikey: secret, 'Content-Type': 'application/json' })
  if (secret.startsWith('eyJ')) headers.set('Authorization', `Bearer ${secret}`)
  let resolved: unknown
  try {
    resolved = await transaction(env, null, async db => (await db.rows(
      'select owner_id as "ownerId" from public.agent_identity_bindings where client_id=$1 and enabled',
      [claims.data.common_name],
    ))[0] ?? null)
  } catch { throw unavailable() }
  const owner = binding.safeParse(resolved)
  if (!owner.success) throw unavailable()
  if (!owner.data) throw invalid()

  const current = await jsonResponse(`${base}/auth/v1/admin/users/${owner.data.ownerId}`, { headers })
  if (current.status === 404) throw invalid()
  const parsed = authUser.safeParse(current.value)
  if (current.status !== 200) throw unavailable()
  if (!parsed.success || parsed.data.id !== owner.data.ownerId || parsed.data.deleted_at) throw invalid()
  if (parsed.data.banned_until) {
    const until = Date.parse(parsed.data.banned_until)
    if (!Number.isFinite(until) || until > Date.now()) throw invalid()
  }
  const email = parsed.data.email.trim().toLowerCase()
  if (!allowedEmails(env).has(email)) throw denied()
  if (claims.data.exp <= Date.now() / 1000) throw invalid()
  return { id: parsed.data.id, email }
}
