import type { TokenDashboardPage } from '../shared/token-backend-contract'
import { sumTokenCounts, sumTokenCosts, type TokenModel } from '../shared/token-usage-contract'
import { modelName } from './format'

export type TrendMetric = 'tokens' | 'cost'

function summarize(parts: TokenModel[]) {
  const currencies = [...new Set(parts.map(item => item.cost.currency))]
  return {
    total: sumTokenCounts(parts.map(item => item.metrics.total)),
    costs: currencies.map(currency => sumTokenCosts(parts.filter(item => item.cost.currency === currency).map(item => item.cost), currency)),
  }
}

// Compare canonical nonnegative decimal strings without rounding the API estimate.
function compareEstimates(a?: string | null, b?: string | null) {
  if (a == null || b == null) return Number(a != null) - Number(b != null)
  const [wholeA, fractionA = ''] = a.split('.'), [wholeB, fractionB = ''] = b.split('.')
  return wholeA.length - wholeB.length || (wholeA < wholeB ? -1 : wholeA > wholeB ? 1 : fractionA < fractionB ? -1 : fractionA > fractionB ? 1 : 0)
}

export function trendModels(rows: TokenDashboardPage['rows'], date: string, metric: TrendMetric, currency?: string) {
  const dayRows = rows.filter(row => row.date === date)
  const groups = new Map<string | null, TokenModel[]>()
  for (const row of dayRows) for (const model of row.models) {
    const parts = groups.get(model.modelId) ?? []
    parts.push(model)
    groups.set(model.modelId, parts)
  }
  const models = [...groups].map(([modelId, parts]) => ({ modelId, parts, ...summarize(parts) }))
  const estimate = (model: ReturnType<typeof summarize>) => model.costs.find(cost => cost.currency === currency)?.apiEstimate
  models.sort((a, b) => (metric === 'tokens' ? (b.total ?? -1) - (a.total ?? -1) : compareEstimates(estimate(b), estimate(a))) || JSON.stringify(a.modelId).localeCompare(JSON.stringify(b.modelId)))
  const entries = models.slice(0, 5).map(model => ({ key: JSON.stringify(model.modelId), name: modelName(model.modelId), total: model.total, costs: model.costs }))
  if (models.length > 5) entries.push({ key: 'other', name: '其他', ...summarize(models.slice(5).flatMap(model => model.parts)) })
  return { entries, incomplete: dayRows.some(row => row.modelCoverage !== 'complete') }
}
