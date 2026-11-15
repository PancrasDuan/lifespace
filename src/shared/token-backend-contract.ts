import { z } from 'zod'
import { tokenCostSchema, tokenMetricsSchema, tokenModelSchema, tokenUsageIdentitySchema, tokenUsageSnapshotSchema } from './token-usage-contract'

const deviceId = tokenUsageIdentitySchema.shape.deviceId
const generation = z.string().regex(/^[1-9]\d{0,18}$/)
const hostname = z.string().min(1).max(253)
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
// jsonb cannot encode NUL or lone UTF-16 surrogates; reject them before queuing
// a transport request, without changing the stage-01 content/hash contract.
function postgresJson(value: unknown): boolean {
  if (typeof value === 'string') return !value.includes('\0') && new TextDecoder().decode(new TextEncoder().encode(value)) === value
  if (Array.isArray(value)) return value.every(postgresJson)
  if (value !== null && typeof value === 'object') return Object.values(value).every(postgresJson)
  return true
}
export const tokenRegistrationSchema = z.strictObject({ deviceId, hostname, platform: z.enum(['macos', 'linux']) })
export const tokenClaimSchema = z.strictObject({ requestId: z.uuid(), claimSecret: secret })
export const tokenCodeSchema = z.string().regex(/^[A-Z2-9]{8}$/)
export const tokenDecisionSchema = z.strictObject({ requestId: z.uuid(), code: tokenCodeSchema, approve: z.boolean(), replaceExisting: z.boolean() })
export const tokenUploadSchema = z.strictObject({
  p_generation: generation, p_snapshot: tokenUsageSnapshotSchema.refine(s => s.metadata.snapshotVersion !== undefined && s.identity.date >= '0001-01-01' && s.content.models.items.length <= 500 && postgresJson(s)),
  p_hash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const tokenUploadReceiptSchema = z.strictObject({
  persisted: z.literal(true), deviceId, date: z.iso.date(), agent: tokenUsageIdentitySchema.shape.agent, generation,
  snapshotVersion: z.string().regex(/^[1-9]\d{0,39}$/), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.enum(['duplicate', 'replaced', 'unchanged']), receivedAt: z.string(),
})
export const tokenDashboardQuerySchema = z.strictObject({
  startDate: z.iso.date(), endDate: z.iso.date(), agent: tokenUsageIdentitySchema.shape.agent.optional(), deviceId: deviceId.optional(),
  // JSON.stringify(canonical modelId), including literal "null" for the unknown bucket.
  modelKey: z.string().max(1202).refine(s => { try { const m: unknown = JSON.parse(s); return (m === null || typeof m === 'string' && m.length > 0 && m.length <= 200) && JSON.stringify(m) === s } catch { return false } }).optional(),
  after: z.string().max(210).optional(),
}).refine(q => q.startDate <= q.endDate && (Date.parse(q.endDate) - Date.parse(q.startDate)) / 86400000 <= 366)
export const tokenDashboardPageSchema = z.strictObject({
  timeZone: z.literal('Asia/Shanghai'), scope: z.enum(['main', 'model']), nextCursor: z.string().nullable(),
  rows: z.array(z.strictObject({ deviceId, date: z.iso.date(), agent: tokenUsageIdentitySchema.shape.agent, generation,
    snapshotVersion: z.string(), contentHash: z.string(), metrics: tokenMetricsSchema, cost: tokenCostSchema,
    modelCoverage: z.enum(['complete', 'partial', 'missing']), models: z.array(tokenModelSchema).max(500), receivedAt: z.string(),
  })).max(250),
})
export const tokenDevicesPageSchema = z.strictObject({ nextCursor: z.string().nullable(), serverTime: z.string(), devices: z.array(z.strictObject({
  deviceId, hostname, platform: z.enum(['macos', 'linux']), enabled: z.boolean(), generation, lastReceivedAt: z.string().nullable(),
  syncHours: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(8), z.literal(12), z.literal(24)]), overdue: z.boolean(),
})).max(100) })
export type TokenDashboardPage = z.infer<typeof tokenDashboardPageSchema>
export type TokenDevicesPage = z.infer<typeof tokenDevicesPageSchema>
const summary = { metrics: tokenMetricsSchema, costs: z.array(tokenCostSchema) }
export const tokenDashboardSummarySchema = z.strictObject({
  timeZone: z.literal('Asia/Shanghai'), scope: z.enum(['main', 'model']), rowCount: z.number().int().nonnegative().max(100000),
  totals: z.strictObject(summary), daily: z.array(z.strictObject({ date: z.iso.date(), ...summary })).max(367),
  models: z.array(z.strictObject({ modelId: tokenModelSchema.shape.modelId, ...summary })),
})
export type TokenDashboardSummary = z.infer<typeof tokenDashboardSummarySchema>
