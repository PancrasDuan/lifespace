import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { tokenInspectionSchema, tokenDashboardSummarySchema, tokenDashboardPageSchema, tokenDevicesPageSchema, tokenCodeSchema, tokenDecisionSchema, tokenRegistrationSchema } from '../shared/token-backend-contract'

export class TokenError extends Error {
  constructor(public code: string) { super(code) }
}
export function errorMessage(error: unknown) {
  const code = error instanceof TokenError ? error.code : ''
  return ({ TOKEN_QUERY_TOO_BROAD: '查询范围过大，请缩短时间或选择设备、Agent 后重试。', TOKEN_NOT_FOUND: '设备码未找到或已过期，请在终端重新登记。', TOKEN_REBIND_REQUIRED: '设备绑定已变化，请重新核对后确认替换。', TOKEN_STATE_CONFLICT: '申请状态已变化，请重新核对。', TOKEN_RATE_LIMIT: '操作过于频繁，请稍后重试。', AUTH_REQUIRED: '登录已失效，请重新登录。', AUTH_EXPIRED: '登录已失效，请重新登录。', AUTH_DENIED: '当前账户没有访问权限。' } as Record<string, string>)[code] ?? '服务暂时不可用，结果未确认，请重试或重新核对。'
}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(value)
    throw new TokenError(error.success ? error.data.error.code : 'TOKEN_UNAVAILABLE')
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new TokenError('TOKEN_UNAVAILABLE')
  return parsed.data
}
export type Query = { startDate: string; endDate: string; agent?: string; deviceId?: string; modelKey?: string }
export const readSummary = async (owner: string, query: Query, signal: AbortSignal) => parse(await authorizedFetch(`/api/token/summary?${new URLSearchParams(query)}`, signal, owner), tokenDashboardSummarySchema)
// Only a null cursor proves the range complete. Repeated cursors are a protocol error.
async function readPages<T>(get: (after?: string) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const items: T[] = [], seen = new Set<string>()
  let after: string | undefined
  do {
    const page = await get(after)
    items.push(...page.items)
    if (page.nextCursor === null) return items
    if (seen.has(page.nextCursor)) throw new TokenError('TOKEN_UNAVAILABLE')
    seen.add(page.nextCursor)
    after = page.nextCursor
  } while (true)
}
export const readUsage = (owner: string, query: Query, signal: AbortSignal) => readPages(async after => {
  const page = await parse(await authorizedFetch(`/api/token/usage?${new URLSearchParams({ ...query, ...(after ? { after } : {}) })}`, signal, owner), tokenDashboardPageSchema)
  return { items: page.rows, nextCursor: page.nextCursor }
})
export const readDevices = (owner: string, signal: AbortSignal) => readPages(async after => {
  const page = await parse(await authorizedFetch(`/api/token/devices${after ? `?${new URLSearchParams({ after })}` : ''}`, signal, owner), tokenDevicesPageSchema)
  return { items: page.devices, nextCursor: page.nextCursor }
})
export type Inspection = z.infer<typeof tokenInspectionSchema>
export const inspectRegistration = async (owner: string, code: string, signal: AbortSignal) => parse(await authorizedMutation('/api/token/registrations/inspect', JSON.stringify({ code: tokenCodeSchema.parse(code) }), signal, owner), tokenInspectionSchema)
export const decideRegistration = async (owner: string, input: z.infer<typeof tokenDecisionSchema>, signal: AbortSignal) => parse(await authorizedMutation('/api/token/registrations/decide', JSON.stringify(tokenDecisionSchema.parse(input)), signal, owner), z.strictObject({ status: z.enum(['approved', 'denied']) }))
export const disableDevice = async (owner: string, deviceId: string, signal: AbortSignal) => parse(await authorizedMutation('/api/token/devices/disable', JSON.stringify({ deviceId }), signal, owner), z.strictObject({ deviceId: z.string(), disabled: z.literal(true) }))
