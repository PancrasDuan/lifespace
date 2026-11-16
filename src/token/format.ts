import type { TokenCost, TokenMetrics } from '../shared/token-usage-contract'

export const number = new Intl.NumberFormat('en-US')
export const compact = (value: number | null | undefined) => value == null ? '—' : value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : number.format(value)
export const fullCount = (value: number | null | undefined) => value === undefined ? '未报告' : value === null ? '未知' : number.format(value)
export const rate = (metrics?: TokenMetrics) => typeof metrics?.input === 'number' && metrics.input > 0 && typeof metrics.cacheRead === 'number' ? `${(metrics.cacheRead / metrics.input * 100).toFixed(1)}%` : '—'
export const coverageLabel = { complete: '', partial: '可计价部分', unverified: '计价未核实', unknown: '费用未知' }
// Display rounding uses decimal integers; the server's precise strings stay intact.
export function money(value: string | null | undefined, currency = 'USD') {
  if (value === undefined) return '未报告'
  if (value === null) return '未知'
  const symbol = currency === 'USD' ? '$' : `${currency} `
  const [whole, fraction = ''] = value.split('.')
  if (whole === '0' && value !== '0' && !/[1-9]/.test(fraction.slice(0, 2))) return `<${symbol}0.01`
  const rounded = BigInt(whole + fraction.padEnd(3, '0').slice(0, 2)) + (Number(fraction[2] ?? '0') >= 5 ? 1n : 0n)
  const digits = rounded.toString().padStart(3, '0')
  return `${symbol}${BigInt(digits.slice(0, -2)).toLocaleString('en-US')}.${digits.slice(-2)}`
}
export function costText(costs: TokenCost[]) {
  if (!costs.length) return '没有费用记录'
  return costs.map(cost => {
    const parts = (['actual', 'apiEstimate', 'unclassified'] as const).flatMap(key => cost[key] === undefined ? [] : [`${({ actual: '实际费用', apiEstimate: 'API 等价估算', unclassified: '未分类费用' })[key]} ${money(cost[key], cost.currency)}`])
    return `${parts.join(' · ') || '费用未报告'}${coverageLabel[cost.coverage] ? ` · ${coverageLabel[cost.coverage]}` : ''}`
  }).join('；')
}
export const modelName = (id: string | null) => id ?? '未知模型'
export const modelColor = (index: number) => ['#365d45', '#4b817a', '#a87943', '#84917b'][index % 4]
export function estimateValue(costs: TokenCost[] | undefined): number | null {
  if (costs?.length !== 1 || typeof costs[0].apiEstimate !== 'string') return null
  const value = Number(costs[0].apiEstimate)
  return Number.isFinite(value) && (value > 0 || costs[0].apiEstimate === '0') ? value : null
}
