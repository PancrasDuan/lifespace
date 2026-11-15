import { z } from 'zod'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from './auth'
import { publicConfig } from './auth'
import { ApiError } from './upstream'
import { readBoundedBody } from './read-body'
import { tokenInspectionSchema, tokenClaimSchema, tokenCodeSchema, tokenDashboardPageSchema, tokenDashboardQuerySchema, tokenDashboardSummarySchema, tokenDecisionSchema, tokenDevicesPageSchema, tokenRegistrationSchema } from '../src/shared/token-backend-contract'

type TokenContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
const failure = (code = 'TOKEN_UNAVAILABLE', status: 400 | 404 | 409 | 429 | 503 = 503) => new ApiError(code, ({ TOKEN_UNAVAILABLE: 'Token 服务暂时不可用，未确认操作可沿用原请求重试', TOKEN_INVALID: '请求格式无效', TOKEN_NOT_FOUND: '登记请求不存在或已过期', TOKEN_STATE_CONFLICT: '登记状态已变化', TOKEN_REBIND_REQUIRED: '请明确确认替换现有设备授权', TOKEN_RATE_LIMIT: '请求过于频繁，请稍后重试' } as Record<string, string>)[code] ?? 'Token 请求失败', status)
const errorStatuses = { TOKEN_INVALID: 400, TOKEN_QUERY_TOO_BROAD: 400, TOKEN_TOTAL_OVERFLOW: 400, TOKEN_NOT_FOUND: 404, TOKEN_STATE_CONFLICT: 409, TOKEN_REBIND_REQUIRED: 409, TOKEN_RATE_LIMIT: 429 } as const
async function rpc<T>(c: TokenContext, name: string, params: object, schema: z.ZodType<T>): Promise<T> {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = c.env
  if (!base || !key) throw failure()
  try {
    const url = new URL(`/rest/v1/rpc/${name}`, base)
    if (url.protocol !== 'https:' || url.username || url.password) throw failure()
    const headers = new Headers({ apikey: key, 'Content-Type': 'application/json' })
    if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params), redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (!response.body) throw failure()
    const value: unknown = JSON.parse(await readBoundedBody(response.body, 8_388_608, 10000))
    const error = z.object({ error: z.enum(Object.keys(errorStatuses) as [keyof typeof errorStatuses, ...(keyof typeof errorStatuses)[]]) }).safeParse(value)
    if (error.success) throw failure(error.data.error, errorStatuses[error.data.error])
    if (!response.ok) {
      const databaseError = z.object({ message: z.enum(Object.keys(errorStatuses) as [keyof typeof errorStatuses, ...(keyof typeof errorStatuses)[]]) }).safeParse(value)
      if (databaseError.success) throw failure(databaseError.data.message, errorStatuses[databaseError.data.message])
    }
    if (!response.ok) throw failure()
    return schema.parse(value)
  } catch (error) { if (error instanceof ApiError) throw error; throw failure() }
}
async function input<T>(c: TokenContext, schema: z.ZodType<T>): Promise<T> {
  if (Object.keys(c.req.query()).length || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw failure('TOKEN_INVALID', 400)
  try { return schema.parse(JSON.parse(await readBoundedBody(c.req.raw.body!, 4096, 5000))) } catch { throw failure('TOKEN_INVALID', 400) }
}
function encoded(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
// Domain-separated HKDF output is a 256-bit upload credential; only its hash
// reaches storage. Retrying claim re-derives the same token without keeping one.
async function uploadCredential(claimSecret: string, requestId: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(claimSecret), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(requestId), info: new TextEncoder().encode('lifespace-device-upload-v1') }, material, 256)
  return encoded(new Uint8Array(bits))
}
export async function startTokenRegistration(c: TokenContext) {
  const value = await input(c, tokenRegistrationSchema)
  const requestId = crypto.randomUUID(), claimSecret = encoded(crypto.getRandomValues(new Uint8Array(32)))
  const uploadToken = await uploadCredential(claimSecret, requestId)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % 32]).join('')
  const result = await rpc(c, 'token_registration_start', { p_id: requestId, p_code: code, p_claim_hash: await digest(claimSecret), p_token_hash: await digest(uploadToken),
    p_device: value.deviceId, p_hostname: value.hostname, p_platform: value.platform,
    p_ip_hash: await digest(c.req.header('CF-Connecting-IP') ?? 'local-unknown') }, z.strictObject({ requestId: z.uuid(), expiresIn: z.literal(600), interval: z.literal(5) }))
  return c.json({ ...result, code, claimSecret, verificationPath: '/token/devices/confirm' }, 201)
}
export async function claimTokenRegistration(c: TokenContext) {
  const value = await input(c, tokenClaimSchema)
  const state = z.strictObject({ status: z.enum(['pending', 'denied', 'expired', 'slow_down', 'superseded']), interval: z.literal(5).optional() })
  const claimed = z.strictObject({ status: z.literal('claimed'), deviceId: tokenRegistrationSchema.shape.deviceId, generation: z.string(), tokenExpiresAt: z.null() })
  const result = await rpc(c, 'token_registration_claim', { p_id: value.requestId, p_claim_hash: await digest(value.claimSecret) }, z.union([state, claimed]))
  if (result.status !== 'claimed') return c.json(result)
  try {
    const token = await uploadCredential(value.claimSecret, value.requestId)
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw failure()
    return c.json({ status: 'claimed', deviceId: result.deviceId, generation: result.generation, uploadToken: token, tokenExpiresAt: null,
      upload: { url: `${publicConfig(c.env).url}/rest/v1/rpc/token_usage_upload`, publishableKey: publicConfig(c.env).publishableKey, header: 'X-LifeSpace-Device-Token' } })
  } catch { throw failure() }
}
export async function inspectTokenRegistration(c: TokenContext) {
  const { code } = await input(c, z.strictObject({ code: tokenCodeSchema }))
  return c.json(await rpc(c, 'token_registration_inspect', { p_owner: c.get('identity').id, p_code: code }, tokenInspectionSchema))
}
export async function decideTokenRegistration(c: TokenContext) {
  const value = await input(c, tokenDecisionSchema)
  return c.json(await rpc(c, 'token_registration_decide', { p_owner: c.get('identity').id, p_id: value.requestId, p_code: value.code, p_approve: value.approve, p_replace: value.replaceExisting }, z.strictObject({ status: z.enum(['approved', 'denied']) })))
}
export async function disableTokenDevice(c: TokenContext) {
  const { deviceId } = await input(c, z.strictObject({ deviceId: tokenRegistrationSchema.shape.deviceId }))
  return c.json(await rpc(c, 'token_device_disable', { p_device: deviceId }, z.strictObject({ deviceId: z.string(), disabled: z.literal(true) })))
}
export async function queryTokenDashboard(c: TokenContext) {
  if (Object.values(c.req.queries()).some(v => v.length !== 1)) throw failure('TOKEN_INVALID', 400)
  const query = tokenDashboardQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('TOKEN_INVALID', 400)
  return c.json(await rpc(c, 'token_dashboard_query', { p_query: query.data }, tokenDashboardPageSchema))
}
export async function queryTokenDevices(c: TokenContext) {
  if (Object.values(c.req.queries()).some(v => v.length !== 1)) throw failure('TOKEN_INVALID', 400)
  const query = z.strictObject({ after: z.string().max(128).optional() }).safeParse(c.req.query())
  if (!query.success) throw failure('TOKEN_INVALID', 400)
  return c.json(await rpc(c, 'token_devices_query', { p_after: query.data.after ?? '' }, tokenDevicesPageSchema))
}
export async function summarizeTokenDashboard(c: TokenContext) {
  if (Object.values(c.req.queries()).some(v => v.length !== 1)) throw failure('TOKEN_INVALID', 400)
  const query = tokenDashboardQuerySchema.safeParse(c.req.query())
  if (!query.success || query.data.after !== undefined) throw failure('TOKEN_INVALID', 400)
  return c.json(await rpc(c, 'token_dashboard_summary', { p_query: query.data }, tokenDashboardSummarySchema))
}
