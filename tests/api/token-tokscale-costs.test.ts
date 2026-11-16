import { expect, test } from 'vitest'
import { adaptTokscaleGraph, tokscaleVersion } from '../../tools/token-collector/tokscale-adapter'
import { sumTokenMoney, tokenUsageContentHash, tokenUsageContentSchema } from '../../src/shared/token-usage-contract'

const context = {
  deviceId: 'synthetic-cost-223',
  metadata: {
    schemaVersion: 1 as const, statisticsVersion: 'tokscale-codex-1',
    tool: { name: 'tokscale' as const, version: tokscaleVersion }, priceVersion: null,
    scannedAt: '2030-01-03T00:00:00Z',
  },
}
function graph(total: number, costs: number[]) {
  const tokens = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  return {
    meta: { version: tokscaleVersion },
    summary: { totalTokens: costs.length, totalCost: total },
    contributions: [{
      date: '2030-01-02', totals: { tokens: costs.length, cost: total },
      tokenBreakdown: { ...tokens, input: costs.length },
      clients: costs.map((cost, index) => ({
        client: 'codex', modelId: `synthetic-model-${index}`, tokens, cost,
        costProvenance: { kind: 'estimated', estimateSource: 'catalog' },
      })),
    }],
  }
}

// Synthetic graphs exercise independent f64 summations. No real model
// identities, usage records, device state or hosted data are included.
test.each([0.01, 0.1, 0.001])('repeated %s event costs reconcile with independently grouped model sums', unit => {
  const total = Array.from({ length: 10_000 }, () => unit).reduce((sum, cost) => sum + cost, 0)
  const sum = unit * 10_000
  const costs = [sum / 2, sum / 2]
  const result = adaptTokscaleGraph(graph(total, costs), context)[0]
  expect(result.content.models.items.map(item => item.cost.apiEstimate)).toEqual(costs.map(String))
  expect(result.content.cost.apiEstimate).toBe(sumTokenMoney(costs.map(String)))
})

test('the absolute and relative f64 budgets apply to daily and global aggregates', () => {
  for (const [total, sum] of [[1e-8 + 5e-13, 1e-8], [1e6 + 5e-7, 1e6]]) {
    expect(() => adaptTokscaleGraph(graph(total, [sum]), context)).not.toThrow()
    const global = graph(sum, [sum])
    global.summary.totalCost = total
    expect(() => adaptTokscaleGraph(global, context)).not.toThrow()
  }
})

test.each([
  [1e-8 + 1e-10, 1e-8],
  [12.5 + 1e-6, 12.5],
  [1e6 + 1e-3, 1e6],
])('significant daily or global cost mismatch %s versus %s is rejected', (total, sum) => {
  expect(() => adaptTokscaleGraph(graph(total, [sum]), context)).toThrow('日期费用无法对账')
  const global = graph(sum, [sum])
  global.summary.totalCost = total
  expect(() => adaptTokscaleGraph(global, context)).toThrow('全局与每日总量无法对账')
})

test('nonnegative costs cannot explain zero versus any positive cost by cancellation', () => {
  expect(() => adaptTokscaleGraph(graph(0, [0]), context)).not.toThrow()
  for (const [total, sum] of [[0, Number.MIN_VALUE], [Number.MIN_VALUE, 0]]) {
    expect(() => adaptTokscaleGraph(graph(total, [sum]), context)).toThrow()
    const global = graph(sum, [sum])
    global.summary.totalCost = total
    expect(() => adaptTokscaleGraph(global, context)).toThrow()
  }
})

test.each([-1, NaN, Infinity])('invalid cost %s is rejected in model, daily and global fields', cost => {
  for (const field of ['model', 'daily', 'global']) {
    const value = graph(2, [1, 1])
    if (field === 'model') value.contributions[0].clients[0].cost = cost
    if (field === 'daily') value.contributions[0].totals.cost = cost
    if (field === 'global') value.summary.totalCost = cost
    expect(() => adaptTokscaleGraph(value, context)).toThrow()
  }
})

test('finite individual costs whose aggregate overflows are rejected', () => {
  expect(() => adaptTokscaleGraph(graph(1e308, [1e308, 1e308]), context)).toThrow('日期费用无法对账')
  const global = graph(1e308, [1e308])
  global.contributions.push({ ...global.contributions[0], date: '2030-01-03' })
  global.summary.totalTokens = 2
  expect(() => adaptTokscaleGraph(global, context)).toThrow('全局与每日总量无法对账')
})

test('the f64 cost budget never relaxes integer token reconciliation', () => {
  const value = graph(1e6 + 5e-7, [1e6])
  for (const change of [
    (input: typeof value) => { input.contributions[0].totals.tokens++ },
    (input: typeof value) => { input.contributions[0].tokenBreakdown.input++ },
    (input: typeof value) => { input.summary.totalTokens++ },
  ]) {
    const changed = structuredClone(value)
    change(changed)
    expect(() => adaptTokscaleGraph(changed, context)).toThrow()
  }
})

test('accepted f64 residues remain exact decimals and still change canonical content hashes', async () => {
  const first = adaptTokscaleGraph(graph(2, [1, 1]), context)[0]
  const second = adaptTokscaleGraph(graph(2, [1, 1.0000000000005]), context)[0]
  expect(second.content.models.items[1].cost.apiEstimate).toBe('1.0000000000005')
  expect(second.content.cost.apiEstimate).toBe('2.0000000000005')
  expect(await tokenUsageContentHash(second.content)).not.toBe(await tokenUsageContentHash(first.content))
  second.content.cost.apiEstimate = '2'
  expect(tokenUsageContentSchema.safeParse(second.content).success).toBe(false)
})
