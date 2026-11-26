import { describe, test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { beijingToday, periodRange, datesBetween } from '../../src/token/dates'
import { compact, fullCount, money, rate, costText } from '../../src/token/format'
import { selectRows, summarize, fixtureRows } from '../fixtures/token-dashboard/fixture'
import { trendModels } from '../../src/token/trendModels'
import { tokenUsageContentSchema, type TokenModel } from '../../src/shared/token-usage-contract'

describe('Token frontend date and display contract', () => {
  test.each([
    ['2026-11-15T15:59:59Z', '2026-11-15'], ['2026-11-15T16:00:00Z', '2026-11-16'],
    ['2026-12-31T16:00:00Z', '2027-01-01'], ['2024-02-28T16:00:00Z', '2024-02-29'],
  ])('Beijing day across midnight %s', (instant, day) => expect(beijingToday(Date.parse(instant))).toBe(day))
  test('Monday and Sunday compare equal elapsed calendar weekdays', () => {
    expect(periodRange('week', '2026-11-16')).toMatchObject({ startDate: '2026-11-16', previousStart: '2026-11-09', previousEnd: '2026-11-09', days: 1 })
    expect(periodRange('week', '2026-11-15')).toMatchObject({ startDate: '2026-11-09', previousEnd: '2026-11-08', days: 7 })
  })
  test('month start, short month, leap month and year rollover clamp correctly', () => {
    expect(periodRange('month', '2026-03-31')).toMatchObject({ previousStart: '2026-02-01', previousEnd: '2026-02-28' })
    expect(periodRange('month', '2024-03-31').previousEnd).toBe('2024-02-29')
    expect(periodRange('month', '2027-01-01')).toMatchObject({ previousStart: '2026-12-01', previousEnd: '2026-12-01' })
    expect(datesBetween('2024-01-01', '2024-12-31')).toHaveLength(366)
    expect(periodRange('30', '2026-11-15')).toMatchObject({ startDate: '2026-10-17', previousStart: '2026-09-17', previousEnd: '2026-10-16' })
  })
  test('missing, unknown and zero; cache ratio uses aggregate input denominator', () => {
    expect([fullCount(undefined), fullCount(null), fullCount(0)]).toEqual(['未报告', '未知', '0'])
    expect(compact(0)).toBe('0'); expect(rate({ input: 1000, cacheRead: 250 })).toBe('25.0%')
    expect(rate({ input: 0, cacheRead: 0 })).toBe('—'); expect(rate({ input: null, cacheRead: 0 })).toBe('—')
  })
  test('precise decimals, tiny nonzero, currencies and provenance survive display', () => {
    expect(money('0.00000000000000001')).toBe('<$0.01')
    expect(money('0')).toBe('$0.00'); expect(money(null)).toBe('未知'); expect(money(undefined)).toBe('未报告')
    expect(money('9007199254740993.015')).toBe('$9,007,199,254,740,993.02')
    expect(costText([{ currency: 'CNY', actual: '1', apiEstimate: '0.1', unclassified: '2', coverage: 'unverified' }])).toContain('实际费用 CNY 1.00 · API 等价估算 CNY 0.10 · 未分类费用 CNY 2.00 · 计价未核实')
  })
  test('approved prototype fixture reconciles main/model children and 51,938,778 baseline', () => {
    for (const row of fixtureRows) tokenUsageContentSchema.parse({ metrics: row.metrics, cost: row.cost, models: { coverage: row.modelCoverage, items: row.models } })
    const summary = summarize(selectRows(new URLSearchParams({ startDate: '2026-10-17', endDate: '2026-11-15' })))
    expect(summary.totals.metrics.total).toBe(51938778)
  })
})

describe('Token Agent display contract', () => {
  test('dashboard exposes all six Agents without renaming stored client ids', async () => {
    const source = await readFile('src/token/TokenDashboard.tsx', 'utf8')
    expect(source).toContain("grok: 'Grok Build'")
    expect(source).toContain("hermes: 'Hermes Agent'")
    expect(source).toContain("claude: 'Claude Code'")
    expect(source).toContain("workbuddy: 'WorkBuddy'")
    expect(source).toContain("cursor: 'Cursor'")
    expect(source).toContain("useState(['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor'])")
    expect(source).not.toContain('尚未接入')
    expect(source).toContain("agentName(agent)")
  })
})

describe('Daily trend model aggregation', () => {
  test('decimal ranks are exact, model identity merges across devices, unknown is not zero', () => {
    const row = fixtureRows[0]
    const model = (modelId: string | null, total: number | null | undefined, apiEstimate: string | null | undefined): TokenModel => ({
      modelId, providerId: null, metrics: { total }, cost: { currency: 'USD', apiEstimate, coverage: apiEstimate == null ? 'unknown' : 'unverified' },
    })
    const models = [model('A', 2, '1.000000000000000001'), model('B', 3, '1.000000000000000002'), model(null, 0, '0'), model('missing', undefined, undefined), model('unknown', null, null), model('C', 10, '4'), model('D', 9, '3')]
    const rows = [{ ...row, models, modelCoverage: 'partial' as const }, { ...row, deviceId: 'other-device', agent: 'claude', models: [model('A', 2, '0.000000000000000001')] }, { ...row, date: '2026-11-15', models: [model('Z', 999, '999')] }]
    const tokens = trendModels(rows, row.date, 'tokens', 'USD')
    expect(tokens.entries.map(item => [item.name, item.total])).toEqual([['C', 10], ['D', 9], ['A', 4], ['B', 3], ['未知模型', 0], ['其他', undefined]])
    expect(tokens.incomplete).toBe(true)
    const costs = trendModels(rows, row.date, 'cost', 'USD')
    expect(costs.entries.map(item => item.name)).toEqual(['C', 'D', 'A', 'B', '未知模型', '其他'])
    expect(costs.entries[2].costs[0].apiEstimate).toBe('1.000000000000000002')
    expect(costs.entries[5].costs[0]).toMatchObject({ apiEstimate: null, coverage: 'unknown' })
    const exact = trendModels([{ ...row, models: models.slice(0, 2) }], row.date, 'cost', 'USD')
    expect(exact.entries.map(item => item.name)).toEqual(['B', 'A'])
  })
})
