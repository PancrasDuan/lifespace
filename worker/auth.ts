import { z } from 'zod'
import { ApiError } from './upstream'
import { Webhook } from 'standardwebhooks'
import { BodyLimitError, readBoundedBody } from './read-body'

export type AuthEnv = Partial<CloudflareEnv>
export type Identity = { id: string; email: string }
const unavailable = () => new ApiError('AUTH_UNAVAILABLE', '认证服务暂时不可用，请稍后重试', 503)
const invalid = () => new ApiError('AUTH_INVALID', '登录已失效，请重新登录', 401)
const email = z.email()
export function allowedEmails(env: AuthEnv): Set<string> {
  const values = env.AUTH_ALLOWED_EMAILS?.split(',').map(value => value.trim().toLowerCase())
  if (!values?.length || values.some(value => !email.safeParse(value).success)) throw unavailable()
  return new Set(values)
}
export function publicConfig(env: AuthEnv) {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key?.startsWith('sb_publishable_')) throw unavailable()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.port) throw unavailable()
  } catch { throw unavailable() }
  return { url, publishableKey: key }
}

export async function registrationHook(env: AuthEnv, request: Request) {
  const denied = { error: { http_code: 403, message: '此邮箱暂未获准注册' } }
  const allowed = allowedEmails(env)
  if (!env.AUTH_HOOK_SECRET) throw unavailable()
  if (!request.body) return { body: denied, status: 403 as const }
  let raw: string
  try { raw = await readBoundedBody(request.body, 65536, 5000) }
  catch (error) { if (error instanceof BodyLimitError) return { body: denied, status: 403 as const }; throw unavailable() }
  let payload: unknown
  let webhook: Webhook
  try { webhook = new Webhook(env.AUTH_HOOK_SECRET.replace(/^v1,/, '')) } catch { throw unavailable() }
  try { payload = webhook.verify(raw, Object.fromEntries(request.headers)) }
  catch { return { body: denied, status: 403 as const } }
  const result = z.object({ user: z.object({ email: z.email(), is_anonymous: z.boolean().optional() }) }).safeParse(payload)
  if (!result.success || result.data.user.is_anonymous || !allowed.has(result.data.user.email.trim().toLowerCase())) return { body: denied, status: 403 as const }
  return { body: {}, status: 200 as const }
}

const claimsSchema = z.object({ sub: z.uuid(), session_id: z.uuid(), exp: z.number().int() })
const userSchema = z.object({ id: z.uuid(), email: z.email(), email_confirmed_at: z.string().min(1), is_anonymous: z.literal(false) })

export async function verifyIdentity(env: AuthEnv, authorization?: string): Promise<Identity> {
  if (!authorization) throw new ApiError('AUTH_REQUIRED', '请先登录', 401)
  const match = /^Bearer ([\w.-]+)$/.exec(authorization)
  if (!match || match[1].length > 16384) throw invalid()
  const token = match[1]
  // 此处仅检查格式。签名、过期与会话存在性由 Auth 的在线 /user 检查确认。
  let claims: z.infer<typeof claimsSchema>
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw invalid()
    claims = claimsSchema.parse(JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))))
  } catch { throw invalid() }
  const allowed = allowedEmails(env)
  const config = publicConfig(env)
  try {
    const response = await fetch(`${config.url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: authorization },
      signal: AbortSignal.timeout(5000), redirect: 'manual',
    })
    if (response.status === 401 || response.status === 403) {
      if (claims.exp <= Date.now() / 1000) throw new ApiError('AUTH_EXPIRED', '登录凭据已过期', 401)
      throw invalid()
    }
    if (!response.ok) throw unavailable()
    if (!response.body) throw unavailable()
    const parsed = userSchema.safeParse(JSON.parse(await readBoundedBody(response.body, 65536, 5000)))
    if (!parsed.success || parsed.data.id !== claims.sub || claims.exp <= Date.now() / 1000) throw invalid()
    const normalized = parsed.data.email.trim().toLowerCase()
    if (!allowed.has(normalized)) throw new ApiError('AUTH_DENIED', '此账户暂未获准访问', 403)
    return { id: parsed.data.id, email: normalized }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  }
}
