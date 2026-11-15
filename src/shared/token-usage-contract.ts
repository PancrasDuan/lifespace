import { z } from 'zod'

// Omitted = not reported; null = explicitly unknown; 0 = known zero.
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional()
export const tokenMetricsSchema = z.strictObject({
  input: count, output: count, total: count, cacheRead: count, cacheWrite: count, reasoning: count,
}).superRefine((value, ctx) => {
  if (typeof value.input === 'number' && typeof value.output === 'number' && typeof value.total === 'number'
    && value.total !== value.input + value.output) ctx.addIssue({ code: 'custom', message: 'total 必须等于 input + output' })
  for (const [part, whole] of [['cacheRead', 'input'], ['cacheWrite', 'input'], ['reasoning', 'output']] as const) {
    if (typeof value[part] === 'number' && typeof value[whole] === 'number' && value[part]! > value[whole]!) {
      ctx.addIssue({ code: 'custom', path: [part], message: `${part} 是 ${whole} 的包含分量` })
    }
  }
})
export type TokenMetrics = z.infer<typeof tokenMetricsSchema>
export const tokenMetricKeys = ['input', 'output', 'total', 'cacheRead', 'cacheWrite', 'reasoning'] as const

// No exponent, leading zeros, trailing fractional zeros or negative zero.
const money = z.string().max(400).regex(/^(0|[1-9]\d*)(\.\d*[1-9])?$/)
export const tokenCostSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  actual: money.nullable().optional(),
  apiEstimate: money.nullable().optional(),
  // Upstream mixed provenance cannot always be split into actual/estimate.
  unclassified: money.nullable().optional(),
  coverage: z.enum(['complete', 'partial', 'unverified', 'unknown']),
}).superRefine((value, ctx) => {
  const amounts = [value.actual, value.apiEstimate, value.unclassified]
  const known = amounts.some(amount => typeof amount === 'string')
  if ((value.coverage === 'unknown' && known) || (value.coverage !== 'unknown' && !known)
    || (value.coverage === 'complete' && amounts.includes(null))) {
    ctx.addIssue({ code: 'custom', message: '费用覆盖状态与已知/未知金额不一致' })
  }
})
export type TokenCost = z.infer<typeof tokenCostSchema>

const modelId = z.string().min(1).max(200)
export const tokenModelSchema = z.strictObject({
  // null is a single explicit unknown bucket, never a guessed model.
  modelId: modelId.nullable(), providerId: modelId.nullable(),
  metrics: tokenMetricsSchema, cost: tokenCostSchema,
})
export type TokenModel = z.infer<typeof tokenModelSchema>
export function tokenModelKey(model: Pick<TokenModel, 'modelId'>): string {
  // graph aggregates by canonical model, merging provider labels in one row.
  return JSON.stringify(model.modelId)
}
export function compareTokenModels(a: TokenModel, b: TokenModel): number {
  return tokenModelKey(a) < tokenModelKey(b) ? -1 : tokenModelKey(a) > tokenModelKey(b) ? 1 : 0
}

export function sumTokenCounts(values: Array<number | null | undefined>): number | null | undefined {
  if (values.includes(undefined)) return undefined
  if (values.includes(null)) return null
  const total = (values as number[]).reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(total)) throw new Error('Token 合计超出安全整数范围')
  return total
}

export function sumTokenMoney(values: string[]): string {
  const scale = values.reduce((max, value) => Math.max(max, value.split('.')[1]?.length ?? 0), 0)
  const sum = values.reduce((total, value) => {
    const [whole, fraction = ''] = value.split('.')
    return total + BigInt(whole + fraction.padEnd(scale, '0'))
  }, 0n).toString().padStart(scale + 1, '0')
  return scale === 0 ? sum : `${sum.slice(0, -scale)}.${sum.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '')
}

export function sumTokenCosts(costs: TokenCost[], currency: string): TokenCost {
  if (costs.some(cost => cost.currency !== currency)) throw new Error('不可合计不同币种')
  const result: TokenCost = { currency, coverage: 'complete' }
  for (const key of ['actual', 'apiEstimate', 'unclassified'] as const) {
    const values = costs.map(cost => cost[key])
    const known = values.filter((value): value is string => typeof value === 'string')
    // Known subtotal survives partial pricing; coverage carries the unknown remainder.
    if (known.length) result[key] = sumTokenMoney(known)
    else if (values.includes(null)) result[key] = null
  }
  const hasKnown = [result.actual, result.apiEstimate, result.unclassified].some(value => typeof value === 'string')
  if (!hasKnown) result.coverage = 'unknown'
  else if (costs.some(cost => cost.coverage === 'partial' || cost.coverage === 'unknown')) result.coverage = 'partial'
  else if (costs.some(cost => cost.coverage === 'unverified')) result.coverage = 'unverified'
  return result
}

export const tokenUsageContentSchema = z.strictObject({
  metrics: tokenMetricsSchema,
  cost: tokenCostSchema,
  models: z.strictObject({ coverage: z.enum(['complete', 'partial', 'missing']), items: z.array(tokenModelSchema) }),
}).superRefine((value, ctx) => {
  const keys = value.models.items.map(tokenModelKey)
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: '模型子项键重复' })
  if (value.models.coverage === 'missing' && keys.length) ctx.addIssue({ code: 'custom', message: '缺失分类不能携带模型子项' })
  if (value.models.items.some(model => model.cost.currency !== value.cost.currency)) {
    ctx.addIssue({ code: 'custom', message: '主汇总与子统计币种不一致' })
  }
  if (value.models.coverage !== 'complete') return
  try {
    for (const key of tokenMetricKeys) {
      if (value.metrics[key] !== sumTokenCounts(value.models.items.map(model => model.metrics[key]))) {
        ctx.addIssue({ code: 'custom', path: ['metrics', key], message: '完整模型分类与主汇总不一致' })
      }
    }
    const cost = sumTokenCosts(value.models.items.map(model => model.cost), value.cost.currency)
    if (cost.actual !== value.cost.actual || cost.apiEstimate !== value.cost.apiEstimate
      || cost.unclassified !== value.cost.unclassified || cost.coverage !== value.cost.coverage) {
      ctx.addIssue({ code: 'custom', path: ['cost'], message: '完整模型费用与主汇总不一致' })
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: '模型合计超出支持范围' })
  }
})
export type TokenUsageContent = z.infer<typeof tokenUsageContentSchema>

export const tokenUsageIdentitySchema = z.strictObject({
  // Application-specific opaque ID; raw system identifiers never belong here.
  deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  date: z.iso.date(), agent: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
})
export const tokenUsageSnapshotSchema = z.strictObject({
  identity: tokenUsageIdentitySchema,
  content: tokenUsageContentSchema,
  metadata: z.strictObject({
    schemaVersion: z.literal(1), statisticsVersion: z.string().min(1).max(100),
    tool: z.strictObject({ name: z.literal('tokscale'), version: z.string().min(1).max(40) }),
    priceVersion: z.string().max(200).nullable(),
    hostname: z.string().min(1).max(253).optional(), scannedAt: z.iso.datetime({ offset: true }),
    // Allocation/persistence belongs to the later SQLite/upload stage.
    snapshotVersion: z.string().regex(/^[1-9]\d*$/).max(40).optional(),
  }),
})
export type TokenUsageSnapshot = z.infer<typeof tokenUsageSnapshotSchema>

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalTokenUsageContent(input: unknown): string {
  const content = tokenUsageContentSchema.parse(input)
  content.models.items.sort(compareTokenModels)
  return canonicalJson(content)
}

// Web Crypto works in Node, browsers and Workers; no CLI or Node imports here.
export async function tokenUsageContentHash(content: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalTokenUsageContent(content))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function tokenUsageSnapshotHash(snapshot: unknown): Promise<string> {
  return tokenUsageContentHash(tokenUsageSnapshotSchema.parse(snapshot).content)
}
