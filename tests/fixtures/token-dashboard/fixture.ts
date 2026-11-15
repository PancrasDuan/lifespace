import fixture from './prototype.json' with { type: 'json' }
import type { TokenDashboardPage, TokenDashboardSummary, TokenDevicesPage } from '../../../src/shared/token-backend-contract'
import { sumTokenCosts, sumTokenCounts, tokenMetricKeys, type TokenCost, type TokenMetrics } from '../../../src/shared/token-usage-contract'

export const fixedToday = fixture.today
export const fixtureDevices: TokenDevicesPage['devices'] = fixture.devices.map(device => ({ deviceId: device.id, hostname: device.name, platform: device.id === 'mac' ? 'macos' : 'linux', enabled: true, generation: '1', syncHours: 1, lastReceivedAt: `2026-11-15T${device.id === 'mac' ? '06:29' : '04:48'}:00Z`, overdue: device.overdue }))
function metrics(items: Array<{ metrics: TokenMetrics }>) {
  return Object.fromEntries(tokenMetricKeys.map(key => [key, sumTokenCounts(items.map(item => item.metrics[key]))])) as TokenMetrics
}
function costs(items: Array<{ cost: TokenCost }>) {
  return [...new Set(items.map(item => item.cost.currency))].map(currency => sumTokenCosts(items.filter(item => item.cost.currency === currency).map(item => item.cost), currency))
}
const grouped = new Map<string, typeof fixture.rows>()
for (const row of fixture.rows) { const key = `${row.date}/${row.device}/${row.agent}`; grouped.set(key, [...(grouped.get(key) ?? []), row]) }
export const fixtureRows: TokenDashboardPage['rows'] = [...grouped].map(([, group]) => {
  const first = group[0]
  // The approved unknown model has no prices, including its zero-token rest days.
  const models = group.map(row => ({ modelId: row.model === 'unknown' ? null : fixture.models.find(model => model.id === row.model)!.name, providerId: null, metrics: { input: row.input, output: row.output, total: row.total, cacheRead: row.cached }, cost: { currency: 'USD', apiEstimate: row.model === 'unknown' || row.cost === null ? null : String(row.cost), coverage: row.model === 'unknown' || row.cost === null ? 'unknown' as const : 'complete' as const } }))
  return { date: first.date, deviceId: first.device, agent: first.agent, generation: '1', snapshotVersion: '1', contentHash: 'a'.repeat(64), metrics: metrics(models), cost: costs(models)[0], models, modelCoverage: 'complete', receivedAt: '2026-11-15T06:29:00Z' }
})
export function selectRows(query: URLSearchParams, rows = fixtureRows) {
  return rows.filter(row => row.date >= query.get('startDate')! && row.date <= query.get('endDate')! && (!query.get('agent') || row.agent === query.get('agent')) && (!query.get('deviceId') || row.deviceId === query.get('deviceId'))).flatMap(row => {
    if (!query.has('modelKey')) return [row]
    const model = row.models.find(model => JSON.stringify(model.modelId) === query.get('modelKey'))
    return model ? [{ ...row, metrics: model.metrics, cost: model.cost, models: [model] }] : []
  })
}
export function summarize(rows: TokenDashboardPage['rows'], model = false): TokenDashboardSummary {
  const models = rows.flatMap(row => row.models)
  return { timeZone: 'Asia/Shanghai', scope: model ? 'model' : 'main', rowCount: rows.length, totals: { metrics: metrics(rows), costs: costs(rows) }, daily: [...new Set(rows.map(row => row.date))].map(date => {
    const items = rows.filter(row => row.date === date)
    return { date, metrics: metrics(items), costs: costs(items) }
  }), models: [...new Set(models.map(model => model.modelId))].map(modelId => {
    const items = models.filter(model => model.modelId === modelId)
    return { modelId, metrics: metrics(items), costs: costs(items) }
  }) }
}
