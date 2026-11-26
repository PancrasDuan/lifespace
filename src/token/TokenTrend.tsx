import { useEffect, useMemo, useRef, useState } from 'react'
import type { TokenDashboardPage, TokenDashboardSummary } from '../shared/token-backend-contract'
import type { TokenCost } from '../shared/token-usage-contract'
import type { Resource } from './useResource'
import { datesBetween, shortDate, longDate, periodRange } from './dates'
import { compact, fullCount, estimateValue, costText, money, coverageLabel } from './format'
import { Feedback } from './Feedback'
import { matchesTrendDay, trendModels, type TrendMetric } from './trendModels'

type Props = { current: Resource<TokenDashboardSummary>; usage: Resource<TokenDashboardPage['rows']>; range: ReturnType<typeof periodRange>; selectedDate: string; selectDate: (date: string) => void; clearFilters: () => void; retryUsage: () => void; refresh: () => void }

function estimateText(costs: TokenCost[]) {
  return costs.length ? costs.map(cost => `${money(cost.apiEstimate, cost.currency)}${coverageLabel[cost.coverage] ? ` · ${coverageLabel[cost.coverage]}` : ''}`).join('；') : '未报告'
}

function estimateTitle(costs: TokenCost[]) {
  const exact = costs.flatMap(cost => typeof cost.apiEstimate === 'string' ? [`${cost.currency} ${cost.apiEstimate}`] : [])
  return `${costText(costs)}${exact.length ? `；精确 API 等价估算 ${exact.join('；')}` : ''}`
}

function costTick(amount: number, currency?: string) {
  const prefix = currency === 'USD' ? '$' : '' // Other currencies are named in the chart heading.
  const label = amount > 0 && (amount < .001 || amount >= 1e12)
    ? new Intl.NumberFormat('en-US', { notation: 'scientific', maximumFractionDigits: 1 }).format(amount).replace('E', 'e')
    : amount >= 1000 ? compact(amount).replace('.00', '') : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(amount)
  return prefix + label
}

export function TokenTrend({ current: resource, usage, range, selectedDate, selectDate, clearFilters, retryUsage, refresh }: Props) {
  const current = resource.data
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  const [hint, setHint] = useState<'pointer' | 'keyboard' | 'tap'>()
  const plot = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!plot.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, Math.round(entry.contentRect.width))))
    observer.observe(plot.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setHint(undefined) }, [current])
  useEffect(() => {
    if (!hint) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHint(undefined) }
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !figure.current?.contains(event.target)) setHint(undefined) }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside) }
  }, [hint])
  const days = datesBetween(range.startDate, range.endDate)
  const value = (day: TokenDashboardSummary['daily'][number] | undefined) => metric === 'tokens' ? day?.metrics.total ?? null : estimateValue(day?.costs)
  const currencies = new Set((current?.totals.costs ?? []).map(cost => cost.currency))
  const currency = [...currencies][0]
  const coverage = [...new Set(current?.totals.costs.map(cost => coverageLabel[cost.coverage]).filter(Boolean))].join(' / ')
  const incomparable = metric === 'cost' && currencies.size > 1
  const daily = new Map(current?.daily.map(day => [day.date, day]))
  const values = days.map(date => value(daily.get(date)))
  const known = values.filter((item): item is number => item !== null)
  const canInspect = current !== undefined
  const available = !!current?.rowCount && known.length > 0 && !incomparable
  const rawMaximum = Math.max(0, ...known) * 1.07
  const power = rawMaximum ? 10 ** Math.floor(Math.log10(rawMaximum)) : 1
  const maximum = rawMaximum ? Math.ceil(rawMaximum / power * 2) / 2 * power : metric === 'tokens' ? 1e6 : 1
  const labelWidth = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 33
    context.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    return Math.max(...datesBetween(range.startDate, range.endDate).map(date => context.measureText(shortDate(date)).width))
  }, [range.startDate, range.endDate])
  const height = 225, left = 44, right = width - Math.max(12, Math.ceil(labelWidth / 2) + 2), top = 15, bottom = height - 28
  const slot = (right - left) / days.length
  const x = (index: number) => left + (index + .5) * slot
  const y = (amount: number) => bottom - amount / maximum * (bottom - top)
  const barWidth = Math.min(27, slot * .66)
  const index = days.includes(selectedDate) ? days.indexOf(selectedDate) : days.length - 1
  const date = days[index], selected = daily.get(date)
  const breakdown = useMemo(() => trendModels(usage.data ?? [], date, metric, currency), [usage.data, date, metric, currency])
  const total = selected ? metric === 'tokens' ? `${fullCount(selected.metrics.total)} Token` : estimateText(selected.costs) : '没有记录'
  const details = breakdown.entries.map(model => ({ ...model, amount: metric === 'tokens' ? fullCount(model.total) : estimateText(model.costs) }))
  const modelNote = breakdown.incomplete ? '模型分类不完整，仅显示已报告子统计' : ''
  const changed = !!usage.data && (usage.data.length !== current?.rowCount || !matchesTrendDay(selected, breakdown.main, metric))
  const changeMessage = '同步中数据已变化，请刷新核对'
  const detailStatus = changed ? changeMessage : incomparable ? '费用币种不同，无法比较模型' : usage.loading || usage.error !== undefined ? '' : [details.map(model => `${model.name} ${model.amount}`).join('；') || '暂无模型明细', modelNote].filter(Boolean).join('；')
  const peak = current?.daily.reduce<TokenDashboardSummary['daily'][number] | undefined>((best, day) => typeof day.metrics.total === 'number' && day.metrics.total > (best?.metrics.total ?? -1) ? day : best, undefined)
  const active = current?.daily.filter(day => typeof day.metrics.total === 'number' && day.metrics.total > 0).length
  const selectPointer = (clientX: number, mode: 'pointer' | 'tap') => {
    if (!plot.current || !available) return
    const local = clientX - plot.current.getBoundingClientRect().left
    setHint(mode)
    selectDate(days[Math.max(0, Math.min(days.length - 1, Math.floor((local - left) / slot)))])
  }
  const tickCapacity = Math.floor(slot * (days.length - 1) / (labelWidth * 1.5 + 6)) + 1
  const tickCount = Math.min(days.length, tickCapacity >= 5 ? 5 : tickCapacity >= 3 ? 3 : 2)
  const tickIndices = tickCount === 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.floor((days.length - 1) * i / (tickCount - 1)))
  const showHint = canInspect && hint !== undefined
  const hintWidth = Math.min(width, 480)
  const hintOffset = Math.max(0, Math.min(width - hintWidth, x(index) - hintWidth / 2))
  return <section className="panel trend-panel" aria-labelledby="trend-title">
    <div className="panel-heading"><div><h2 id="trend-title">每日用量趋势</h2>{metric === 'cost' && <p>{[...currencies].join(' / ')}{currencies.size > 0 && ' · '}API 等价估算{coverage && ` · ${coverage}`}</p>}</div><div className="segmented" role="group" aria-label="趋势指标"><button type="button" aria-pressed={metric === 'tokens'} onClick={() => { setMetric('tokens'); setHint(undefined) }}>Token</button><button type="button" aria-pressed={metric === 'cost'} onClick={() => { setMetric('cost'); setHint(undefined) }}>费用</button></div></div>
    <figure className="chart-figure" ref={figure} onPointerLeave={() => { if (hint === 'pointer') setHint(undefined) }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHint(undefined) }}>
      <div className="plot" ref={plot} tabIndex={canInspect ? 0 : -1} role="group" aria-label="每日用量柱状图，左右方向键查看日期" aria-describedby="token-chart-description" onFocus={event => { if (canInspect && event.target === event.currentTarget && event.currentTarget.matches(':focus-visible')) setHint('keyboard') }} onPointerMove={event => { if (event.pointerType !== 'touch') selectPointer(event.clientX, 'pointer') }} onClick={event => { if (!(event.target instanceof Element && event.target.closest('button'))) selectPointer(event.clientX, 'tap') }} onKeyDown={event => {
        if (!canInspect || event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
        event.preventDefault(); setHint('keyboard')
        if (event.key === 'Enter' || event.key === ' ') return
        selectDate(days[event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : Math.max(0, Math.min(days.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))])
      }}>
        {!available ? <div className="chart-empty">{resource.loading ? <p className="token-loading">正在读取用量…</p> : <><strong>{!current ? '用量暂不可用' : !current.rowCount ? '暂无用量' : incomparable ? '费用币种不同，无法合为同一柱状图' : metric === 'cost' ? 'API 估算未知' : 'Token 未报告或未知'}</strong><button type="button" className="button" onClick={metric === 'cost' ? () => setMetric('tokens') : clearFilters}>{metric === 'cost' ? '查看 Token 用量' : '恢复筛选'}</button></>}</div>
          : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`每日${metric === 'tokens' ? 'Token 用量' : 'API 估算'}`}>
            {Array.from({ length: 5 }, (_, i) => { const amount = maximum / 4 * i; return <g key={i}><line className="chart-grid" x1={left} x2={right} y1={y(amount)} y2={y(amount)} /><text className="axis-label" x={0} y={y(amount) + 3}>{metric === 'tokens' ? compact(amount).replace('.00', '') : costTick(amount, currency)}</text></g> })}
            {tickIndices.map(i => <text key={i} className="axis-label date-label" x={x(i)} y={height - 5} textAnchor="middle">{shortDate(days[i])}</text>)}
            {values.map((amount, i) => amount === null ? null : <rect key={days[i]} className={`trend-bar${i === index ? ' trend-bar-selected' : ''}`} data-trend-date={days[i]} x={x(i) - barWidth / 2} y={Math.min(bottom - 1, y(amount))} width={barWidth} height={Math.max(1, bottom - y(amount))} rx={Math.min(1, barWidth / 2)} />)}
            <line className="cursor-line" x1={x(index)} x2={x(index)} y1={top} y2={values[index] === null ? bottom : y(values[index]!)} />
          </svg>}
      </div>
      <figcaption id="token-chart-description" className="sr-only">移动指针、轻触或按左右方向键查看每日总量和模型明细。日统计明细提供每日总量表格。</figcaption>
      {showHint && <div className="trend-hint" style={{ marginInlineStart: hintOffset }} role="region" aria-label="当日模型明细">
        <div className="trend-hint-heading"><span>{date.replaceAll('-', '/')}</span><strong title={metric === 'cost' ? estimateTitle(selected?.costs ?? []) : undefined}>{total}</strong></div>
        {changed ? <div className="trend-refresh"><p>{changeMessage}</p><button type="button" className="button" onClick={refresh}>刷新统计</button></div> : selected && <>{incomparable ? <p>费用币种不同，无法比较模型</p> : usage.loading || usage.error !== undefined ? <Feedback resource={usage} retry={retryUsage} label="正在读取完整模型明细…" /> : <>
          {details.length ? <dl className="trend-models">{details.map(model => <div className="detail-model" key={model.key}><dt>{model.name}</dt><dd title={metric === 'cost' ? estimateTitle(model.costs) : undefined}>{model.amount}</dd></div>)}</dl> : <p>暂无模型明细</p>}
          {modelNote && <p>{modelNote}</p>}
        </>}</>}
      </div>}
    </figure>
    <div className="inspection">{(available || selected || showHint) && <><span className="cursor-key" /><strong>{longDate(date)}</strong><strong title={total}>{selected && metric === 'tokens' ? `${compact(selected.metrics.total)} Token` : total}</strong></>}</div>
    <div className="sr-only" role="status" aria-atomic="true">{showHint && hint === 'keyboard' && `${longDate(date)}，${total}${(selected || changed) && detailStatus ? `；${detailStatus}` : ''}`}</div>
    <div className="trend-summary"><div><span>日均用量</span><strong>{current?.rowCount && typeof current.totals.metrics.total === 'number' ? `${compact(current.totals.metrics.total / range.days)} Token` : '—'}</strong></div><div><span>单日峰值</span><strong>{peak ? `${compact(peak.metrics.total)} · ${shortDate(peak.date)}` : '—'}</strong></div><div><span>活跃天数</span><strong>{current?.rowCount ? `${active} / ${range.days} 天` : '—'}</strong></div></div>
  </section>
}
