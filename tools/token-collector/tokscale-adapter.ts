import { z } from 'zod'
import {
  compareTokenModels, sumTokenCosts, sumTokenCounts, tokenMetricKeys, tokenModelKey, tokenUsageSnapshotSchema,
  type TokenCost, type TokenMetrics, type TokenModel, type TokenUsageSnapshot,
} from '../../src/shared/token-usage-contract.ts'

export const tokscaleVersion = '4.23.0'
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const amount = z.number().nonnegative().finite()
const provenance = z.object({
  kind: z.enum(['unknown', 'providerReported', 'estimated', 'mixed']),
  estimateSource: z.enum(['catalog', 'custom', 'unknown', 'mixed']).optional(),
})
const breakdown = z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, reasoning: count })
const row = z.object({
  client: z.literal('codex'), modelId: z.string().min(1).max(200), providerId: z.string().max(200).optional(),
  tokens: breakdown, cost: amount, costProvenance: provenance.optional(),
})
export const tokscaleGraphSchema = z.object({
  meta: z.object({ version: z.literal(tokscaleVersion) }),
  summary: z.object({ totalTokens: count, totalCost: amount }),
  contributions: z.array(z.object({
    date: z.iso.date(), totals: z.object({ tokens: count, cost: amount }),
    tokenBreakdown: breakdown, clients: z.array(row),
  })),
})
type Graph = z.infer<typeof tokscaleGraphSchema>
type Row = z.infer<typeof row>

// Retain the upstream number's shortest round-trip decimal, including its
// floating-point residue. Expand exponent notation without price recalculation.
export function tokscaleMoney(value: number): string {
  amount.parse(value)
  const [coefficient, exponent] = value.toString().split('e')
  if (exponent === undefined) return coefficient
  const [whole, fraction = ''] = coefficient.split('.')
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length)
  return `${digits.slice(0, point)}.${digits.slice(point)}`
}

function adaptCost(value: Row): TokenCost {
  const base = { currency: 'USD' }
  switch (value.costProvenance?.kind) {
    case 'providerReported': return { ...base, actual: tokscaleMoney(value.cost), coverage: 'complete' }
    // Local graph is lenient: even PartialEstimate can be labelled estimated.
    case 'estimated': return { ...base, apiEstimate: tokscaleMoney(value.cost), coverage: 'unverified' }
    case 'mixed': return { ...base, unclassified: tokscaleMoney(value.cost), coverage: 'partial' }
    default:
      return value.cost > 0
        ? { ...base, unclassified: tokscaleMoney(value.cost), coverage: 'partial' }
        : { ...base, ...(value.costProvenance ? { apiEstimate: null } : {}), coverage: 'unknown' }
  }
}

function rawTotal(tokens: Row['tokens']): number {
  return sumTokenCounts(Object.values(tokens))!
}

function adaptModel(value: Row): TokenModel {
  const tokens = value.tokens
  const metrics: TokenMetrics = {
    input: sumTokenCounts([tokens.input, tokens.cacheRead, tokens.cacheWrite]),
    output: sumTokenCounts([tokens.output, tokens.reasoning]), total: rawTotal(tokens),
    cacheRead: tokens.cacheRead, reasoning: tokens.reasoning,
    // Codex has no cache-write measurement; the CLI's zero is a default bucket.
  }
  return {
    modelId: value.modelId === 'unknown' ? null : value.modelId,
    providerId: !value.providerId || value.providerId === 'unknown' ? null : value.providerId,
    metrics, cost: adaptCost(value),
  }
}

function costMatches(total: number, parts: number[]): boolean {
  const sum = parts.reduce((value, part) => value + part, 0)
  if (!Number.isFinite(sum)) return false
  // Nonnegative costs have no cancellation: zero versus positive is distinct.
  if (total === 0 || sum === 0) return total === sum
  // Upstream groups event-level f64 sums in different orders; model/day count
  // does not bound that error. Budget one trillionth USD or one part per
  // trillion, only for aggregate validation. Never round model amounts or
  // apply this tolerance to exact decimal strings, integer tokens or hashes.
  return Math.abs(total - sum) <= Math.max(1e-12, 1e-12 * Math.max(total, sum))
}

function validateJointTotals(graph: Graph) {
  const dates = new Set<string>()
  for (const day of graph.contributions) {
    if (dates.has(day.date)) throw new Error('Tokscale 日期重复')
    dates.add(day.date)
    if (day.totals.tokens !== rawTotal(day.tokenBreakdown)
      || day.totals.tokens !== sumTokenCounts(day.clients.map(client => rawTotal(client.tokens)))) {
      throw new Error('Tokscale 日期与联合明细 Token 无法对账')
    }
    for (const key of Object.keys(day.tokenBreakdown) as Array<keyof Row['tokens']>) {
      if (day.tokenBreakdown[key] !== sumTokenCounts(day.clients.map(client => client.tokens[key]))) {
        throw new Error('Tokscale 联合明细分量无法对账')
      }
    }
    if (!costMatches(day.totals.cost, day.clients.map(client => client.cost))) throw new Error('Tokscale 日期费用无法对账')
    const keys = day.clients.map(client => tokenModelKey(adaptModel(client)))
    if (new Set(keys).size !== keys.length) throw new Error('Tokscale 联合模型键重复')
  }
  if (graph.summary.totalTokens !== sumTokenCounts(graph.contributions.map(day => day.totals.tokens))
    || !costMatches(graph.summary.totalCost, graph.contributions.map(day => day.totals.cost))) {
    throw new Error('Tokscale 全局与每日总量无法对账')
  }
}

export type TokenCollectionContext = {
  deviceId: string
  metadata: TokenUsageSnapshot['metadata']
}

export function adaptTokscaleGraph(input: unknown, context: TokenCollectionContext): TokenUsageSnapshot[] {
  const graph = tokscaleGraphSchema.parse(input)
  if (context.metadata.tool.name !== 'tokscale' || context.metadata.tool.version !== tokscaleVersion) {
    throw new Error('Tokscale 元数据版本不匹配')
  }
  validateJointTotals(graph)
  return graph.contributions.filter(day => day.clients.length > 0).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).map(day => {
    const items = day.clients.map(adaptModel).sort(compareTokenModels)
    const metrics: TokenMetrics = {}
    for (const key of tokenMetricKeys) {
      const total = sumTokenCounts(items.map(item => item.metrics[key]))
      if (total !== undefined) metrics[key] = total
    }
    return tokenUsageSnapshotSchema.parse({
      identity: { deviceId: context.deviceId, date: day.date, agent: 'codex' },
      content: { metrics, cost: sumTokenCosts(items.map(item => item.cost), 'USD'), models: { coverage: 'complete', items } },
      metadata: context.metadata,
    })
  })
}
