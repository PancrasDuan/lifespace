import { describe, test, expect } from 'vitest'
import { beijingToday, periodRange, datesBetween } from '../../src/token/dates'
import { compact, fullCount, money, rate, costText } from '../../src/token/format'
import { selectRows, summarize, fixtureRows } from '../fixtures/token-dashboard/fixture'
import { tokenUsageContentSchema } from '../../src/shared/token-usage-contract'

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
