import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartNoAxesColumn, ChartNoAxesCombined } from 'lucide-react'
import type { TokenDashboardPage, TokenDashboardSummary } from '../shared/token-backend-contract'
import { sumTokenCounts, sumTokenCosts, type TokenCost } from '../shared/token-usage-contract'
import type { Resource } from './useResource'
import { datesBetween, shortDate, longDate, periodRange } from './dates'
import { compact, fullCount, estimateValue, costText, modelColor, modelName } from './format'
import { Feedback } from './Feedback'

type Props = { current?: TokenDashboardSummary; previous?: TokenDashboardSummary; usage: Resource<TokenDashboardPage['rows']>; colors: Map<string, string>; range: ReturnType<typeof periodRange>; selectedDate: string; selectDate: (date: string) => void; clearFilters: () => void; retry: () => void }
export function TokenTrend({ current, previous, usage, colors, range, selectedDate, selectDate, clearFilters, retry }: Props) {
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const [chart, setChart] = useState<'line' | 'stack'>('line')
  const [keyboard, setKeyboard] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!plot.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, Math.round(entry.contentRect.width))))
    observer.observe(plot.current)
    return () => observer.disconnect()
  }, [])
  const days = datesBetween(range.startDate, range.endDate)
  const previousDays = datesBetween(range.previousStart, range.previousEnd)
  const value = (day: TokenDashboardSummary['daily'][number] | undefined) => metric === 'tokens' ? day?.metrics.total ?? null : estimateValue(day?.costs)
  const currencies = new Set([...(current?.totals.costs ?? []), ...(previous?.totals.costs ?? [])].map(cost => cost.currency))
  const incomparable = metric === 'cost' && currencies.size > 1
  const values = days.map(date => value(current?.daily.find(day => day.date === date)))
  const previousValues = previousDays.map(date => value(previous?.daily.find(day => day.date === date)))
  const known = values.filter((item): item is number => item !== null)
  const available = !!current?.rowCount && known.length > 0 && !incomparable
  const models = [...(current?.models ?? [])].sort((a, b) => (b.metrics.total ?? -1) - (a.metrics.total ?? -1))
  const colorFor = (modelId: string | null, index: number) => colors.get(JSON.stringify(modelId)) ?? modelColor(index)
  const modelDays = useMemo(() => {
    const result = new Map<string, TokenDashboardPage['rows'][number]['models']>()
    for (const row of usage.data ?? []) for (const model of row.models) {
      const key = JSON.stringify([row.date, model.modelId])
      const items = result.get(key) ?? []; items.push(model); result.set(key, items)
    }
    return result
  }, [usage.data])
  const stackSummaries = days.map(date => models.map(model => {
    const parts = modelDays.get(JSON.stringify([date, model.modelId])) ?? []
    if (!parts.length) return undefined
    const currencies = [...new Set(parts.map(item => item.cost.currency))]
    const costs: TokenCost[] = currencies.map(currency => sumTokenCosts(parts.filter(item => item.cost.currency === currency).map(item => item.cost), currency))
    return { total: sumTokenCounts(parts.map(item => item.metrics.total)), costs }
  }))
  const stackDays = stackSummaries.map(items => items.map(item => metric === 'tokens' ? item?.total ?? null : estimateValue(item?.costs)))
  const stackMax = Math.max(0, ...stackDays.map(items => items.reduce<number>((sum, item) => sum + (item ?? 0), 0)))
  const rawMaximum = Math.max(0, ...known, ...previousValues.filter((item): item is number => item !== null), chart === 'stack' ? stackMax : 0) * 1.07
  const power = rawMaximum ? 10 ** Math.floor(Math.log10(rawMaximum)) : 1
  const maximum = rawMaximum ? Math.ceil(rawMaximum / power * 2) / 2 * power : metric === 'tokens' ? 1e6 : 1
  const height = 225, left = 44, right = width - 12, top = 15, bottom = height - 28
  const x = (index: number) => days.length === 1 ? (left + right) / 2 : left + index / (days.length - 1) * (right - left)
  const y = (amount: number) => bottom - amount / maximum * (bottom - top)
  const path = (data: Array<number | null>) => {
    let connected = false
    return data.map((amount, index) => {
      if (amount === null) { connected = false; return '' }
      const segment = `${connected ? 'L' : 'M'}${x(index).toFixed(2)},${y(amount).toFixed(2)}`
      connected = true
      return segment
    }).join(' ')
  }
  const index = days.includes(selectedDate) ? days.indexOf(selectedDate) : days.length - 1
  const selected = current?.daily.find(day => day.date === days[index])
  const peak = current?.daily.reduce<(NonNullable<Props['current']>['daily'][number]) | undefined>((best, day) => typeof day.metrics.total === 'number' && day.metrics.total > (best?.metrics.total ?? -1) ? day : best, undefined)
  const active = current?.daily.filter(day => typeof day.metrics.total === 'number' && day.metrics.total > 0).length
  const selectPointer = (clientX: number) => {
    if (!plot.current || !available) return
    const local = clientX - plot.current.getBoundingClientRect().left
    setKeyboard(false)
    selectDate(days[Math.max(0, Math.min(days.length - 1, Math.round((local - left) / (right - left) * (days.length - 1))))])
  }
  const labelWidth = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 33
    context.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    return Math.max(...datesBetween(range.startDate, range.endDate).map(date => context.measureText(shortDate(date)).width))
  }, [range.startDate, range.endDate])
  const tickCapacity = Math.floor((right - left) / (labelWidth * 1.5 + 6)) + 1
  const tickCount = Math.min(days.length, tickCapacity >= 5 ? 5 : tickCapacity >= 3 ? 3 : 2)
  const tickIndices = tickCount === 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.floor((days.length - 1) * i / (tickCount - 1)))
  return <section className="panel trend-panel" aria-labelledby="trend-title">
    <div className="panel-heading"><div><h2 id="trend-title">每日用量趋势</h2>{metric === 'cost' && <p>{[...currencies].join(' / ')} · API 估算{current?.totals.costs.some(cost => cost.coverage !== 'complete') ? ' · 可计价部分 / 计价未核实' : ''}</p>}</div><div className="segmented" aria-label="趋势指标"><button type="button" aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Token</button><button type="button" aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>费用</button></div></div>
    <div className="chart-toolbar"><div className="chart-legend">{chart === 'line' ? <><span><i />当前周期</span>{previousValues.some(value => value !== null) && !incomparable && <span><i className="previous-key" />{range.comparison}</span>}</> : models.map((model, i) => <span key={JSON.stringify(model.modelId)}><i className="model-key" style={{ background: colorFor(model.modelId, i) }} />{modelName(model.modelId)}</span>)}</div><div className="chart-view" aria-label="趋势展示方式"><button type="button" className="icon-button" aria-label="总量曲线" aria-pressed={chart === 'line'} onClick={() => setChart('line')}><ChartNoAxesCombined size={17} /></button><button type="button" className="icon-button" aria-label="模型堆叠" aria-pressed={chart === 'stack'} onClick={() => setChart('stack')}><ChartNoAxesColumn size={17} /></button></div></div>
    <figure className="chart-figure"><div className="plot" ref={plot} tabIndex={0} role="group" aria-label="每日用量图，左右方向键查看日期" aria-describedby="token-chart-description" onPointerMove={event => { if (event.pointerType !== 'touch') selectPointer(event.clientX) }} onClick={event => { if (!(event.target instanceof Element && event.target.closest('button'))) selectPointer(event.clientX) }} onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); setKeyboard(true)
      selectDate(days[event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : Math.max(0, Math.min(days.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))])
    }}>
      {chart === 'stack' && (usage.loading || usage.error !== undefined) ? <div className="chart-empty"><Feedback resource={usage} retry={retry} label="正在读取完整模型明细…" /></div>
        : !available ? <div className="chart-empty"><strong>{!current ? '用量暂不可用' : !current.rowCount ? '暂无用量' : incomparable ? '费用币种不同，无法合为一条曲线' : metric === 'cost' ? 'API 估算未知' : 'Token 未报告或未知'}</strong><button type="button" className="button" onClick={metric === 'cost' ? () => setMetric('tokens') : clearFilters}>{metric === 'cost' ? '查看 Token 用量' : '恢复筛选'}</button></div>
        : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`每日${metric === 'tokens' ? 'Token 用量' : 'API 估算'}`}>
          {Array.from({ length: 5 }, (_, i) => { const amount = maximum / 4 * i; return <g key={i}><line className="chart-grid" x1={left} x2={right} y1={y(amount)} y2={y(amount)} /><text className="axis-label" x={0} y={y(amount) + 3}>{metric === 'tokens' ? compact(amount).replace('.00', '') : `${currencies.has('USD') ? '$' : [...currencies][0] + ' '}${amount > 0 && amount < .01 ? new Intl.NumberFormat('en-US', { notation: 'scientific', maximumFractionDigits: 1 }).format(amount).replace('E', 'e') : amount.toFixed(amount < 5 ? 1 : 0)}`}</text></g> })}
          {tickIndices.map(i => <text key={i} className="axis-label date-label" x={x(i)} y={height - 5} textAnchor={days.length === 1 ? 'middle' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>{shortDate(days[i])}</text>)}
          {chart === 'line' ? <>{values.every(v => v !== null) && days.length > 1 && <path className="data-area" d={`${path(values)} L${right},${bottom} L${left},${bottom}Z`} />}<path className="previous-line" d={path(previousValues)} /><path className="data-line" d={path(values)} />{days.length === 1 && values[0] !== null && <circle cx={x(0)} cy={y(values[0])} r={3} fill="#365d45" />}</>
            : stackDays.map((items, dayIndex) => { let running = 0; const barWidth = Math.min(27, (right - left) / Math.max(days.length, 2) * .66); return items.map((amount, modelIndex) => { if (amount == null || amount === 0) return null; const base = running; running += amount; return <rect key={`${dayIndex}/${modelIndex}`} x={x(dayIndex) - barWidth / 2} y={y(running)} width={barWidth} height={Math.max(0, y(base) - y(running))} rx={1} fill={colorFor(models[modelIndex].modelId, modelIndex)} /> }) })}
          {values[index] !== null && <g><line className="cursor-line" x1={x(index)} x2={x(index)} y1={top} y2={bottom} /><circle className="cursor-dot" cx={x(index)} cy={y(values[index]!)} r={4} /></g>}
        </svg>}
    </div><figcaption id="token-chart-description" className="sr-only">移动指针或按左右方向键查看每日统计。日统计明细提供相同数据的表格。</figcaption></figure>
    <div className="inspection" aria-live={keyboard ? 'polite' : 'off'}>{selected && <><span className="cursor-key" /><strong>{longDate(selected.date)}</strong><strong title={metric === 'tokens' ? fullCount(selected.metrics.total) : costText(selected.costs)}>{metric === 'tokens' ? `${compact(selected.metrics.total)} Token` : costText(selected.costs)}</strong>{chart === 'line' ? <span>输入 {compact(selected.metrics.input)} / 输出 {compact(selected.metrics.output)}</span> : models.map((model, modelIndex) => <span key={JSON.stringify(model.modelId)} className="detail-model"><i style={{ background: colorFor(model.modelId, modelIndex) }} />{modelName(model.modelId)} {metric === 'tokens' ? compact(stackDays[index][modelIndex]) : costText(stackSummaries[index][modelIndex]?.costs ?? [])}</span>)}</>}{!selected && available && `${longDate(days[index])} · 没有记录`}</div>
    {chart === 'stack' && usage.data?.some(row => row.modelCoverage !== 'complete') && <p className="small-note">模型分类不完整，堆叠仅显示已报告子统计</p>}
    <div className="trend-summary"><div><span>日均用量</span><strong>{current?.rowCount && typeof current.totals.metrics.total === 'number' ? `${compact(current.totals.metrics.total / range.days)} Token` : '—'}</strong></div><div><span>单日峰值</span><strong>{peak ? `${compact(peak.metrics.total)} · ${shortDate(peak.date)}` : '—'}</strong></div><div><span>活跃天数</span><strong>{current?.rowCount ? `${active} / ${range.days} 天` : '—'}</strong></div></div>
  </section>
}
