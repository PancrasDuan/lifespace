import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, RotateCcw, X } from 'lucide-react'
import type { TokenDashboardSummary } from '../shared/token-backend-contract'
import { beijingToday, periodRange, periods, type Period } from './dates'
import { readSummary, readUsage, readDevices, type Query } from './api'
import { useResource, type Resource } from './useResource'
import { compact, fullCount, rate, money, coverageLabel, costText, modelName, modelColor } from './format'
import { TokenTrend } from './TokenTrend'
import { TokenCalendar } from './TokenCalendar'
import { TokenDevices } from './TokenDevices'
import { Feedback } from './Feedback'

const agentNames: Record<string, string> = { codex: 'Codex', grok: 'Grok Build', hermes: 'Hermes Agent', claude: 'Claude Code', workbuddy: 'WorkBuddy', cursor: 'Cursor' }
const agentName = (agent: string) => agentNames[agent] ?? agent

export function TokenDashboard() {
  const [today, setToday] = useState(beijingToday)
  useEffect(() => {
    const update = () => setToday(beijingToday())
    const timer = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  const [period, setPeriod] = useState<Period>('30')
  const [agent, setAgent] = useState('')
  const [deviceId, setDevice] = useState('')
  const [modelKey, setModel] = useState('')
  const [version, setVersion] = useState(0)
  const [selectedDate, selectDate] = useState(today)
  const retry = () => setVersion(value => value + 1)
  const range = periodRange(period, today)
  const query: Query = { startDate: range.startDate, endDate: today, ...(agent ? { agent } : {}), ...(deviceId ? { deviceId } : {}), ...(modelKey ? { modelKey } : {}) }
  const key = JSON.stringify(query) + version
  const current = useResource(key, (owner, signal) => readSummary(owner, query, signal))
  const previous = useResource(`${key}:previous`, (owner, signal) => readSummary(owner, { ...query, startDate: range.previousStart, endDate: range.previousEnd }, signal))
  const annualQuery = { ...query, startDate: `${today.slice(0, 4)}-01-01`, endDate: `${today.slice(0, 4)}-12-31` }
  const annual = useResource(JSON.stringify(annualQuery) + version, (owner, signal) => readSummary(owner, annualQuery, signal))
  // Options are queried outside the model/device/Agent filters. Their identities do not vanish on selection.
  const catalogue = useResource(`${range.startDate}:${today}:catalogue:${version}`, (owner, signal) => readSummary(owner, { startDate: range.startDate, endDate: today }, signal))
  const usage = useResource(`${key}:usage`, (owner, signal) => readUsage(owner, query, signal))
  const devices = useResource(`devices:${version}`, readDevices)
  const modelOptions = useMemo(() => {
    const values = new Map<string, string>()
    for (const item of [...(catalogue.data?.models ?? []), ...(current.data?.models ?? [])]) values.set(JSON.stringify(item.modelId), modelName(item.modelId))
    if (modelKey && !values.has(modelKey)) values.set(modelKey, modelName(JSON.parse(modelKey)))
    return values
  }, [catalogue.data, current.data, modelKey])
  const modelColors = useMemo(() => {
    let index = 0
    return new Map([...modelOptions.keys()].map(key => [key, key === 'null' ? modelColor(3) : modelColor(index++ % 3)]))
  }, [modelOptions])
  const [agents, setAgents] = useState(['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor'])
  useEffect(() => {
    if (usage.data) setAgents(known => [...new Set([...known, ...usage.data!.map(row => row.agent)])])
  }, [usage.data])
  const reset = () => { setPeriod('30'); setAgent(''); setDevice(''); setModel(''); selectDate(today) }
  const totals = current.data?.rowCount ? current.data.totals : undefined
  const previousTotal = previous.data?.rowCount ? previous.data.totals.metrics.total : undefined
  const delta = typeof totals?.metrics.total === 'number' && typeof previousTotal === 'number' && previousTotal > 0 ? (totals.metrics.total / previousTotal - 1) * 100 : null
  const [expanded, setExpanded] = useState(() => !('onbeforematch' in HTMLElement.prototype))
  const details = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = details.current
    if (!element) return
    const reveal = () => setExpanded(true)
    element.addEventListener('beforematch', reveal)
    return () => element.removeEventListener('beforematch', reveal)
  }, [])
  useLayoutEffect(() => {
    if (expanded) details.current?.removeAttribute('hidden')
    else details.current?.setAttribute('hidden', 'until-found')
  }, [expanded])
  const daily = current.data?.daily ?? []
  return <>
    <section aria-labelledby="page-title">
      <div className="page-heading"><h1 id="page-title" tabIndex={-1}>Token 用量</h1></div>
      <search><form className="filters" aria-label="用量筛选" onSubmit={event => event.preventDefault()}>
        <label><span id="token-period-label">时间范围</span><select aria-labelledby="token-period-label" name="period" value={period} onChange={event => setPeriod(event.target.value as Period)}>{(['1', 'week', 'month', '7', '30', '90', 'year'] as Period[]).map(value => <option value={value} key={value}>{periods[value]}</option>)}</select></label>
        <label><span id="token-agent-label">Agent</span><select aria-labelledby="token-agent-label" name="agent" value={agent} onChange={event => setAgent(event.target.value)}><option value="">全部 Agent</option>{agents.map(value => <option key={value} value={value}>{agentName(value)}</option>)}</select></label>
        <label><span id="token-device-label">设备</span><select aria-labelledby="token-device-label" name="device" value={deviceId} onChange={event => setDevice(event.target.value)}><option value="">全部设备</option>{devices.data?.map(device => <option key={device.deviceId} value={device.deviceId}>{device.hostname}{!device.enabled ? '（已停用）' : ''}</option>)}</select></label>
        <label><span id="token-model-label">模型</span><select aria-labelledby="token-model-label" name="model" value={modelKey} onChange={event => setModel(event.target.value)}><option value="">全部模型</option>{[...modelOptions].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button type="button" className="reset-button" disabled={period === '30' && !agent && !deviceId && !modelKey} onClick={reset}><RotateCcw size={15} />重置</button><span className="timezone">北京时间</span>
      </form></search>
      <div className="scope-line"><span>{range.startDate.replaceAll('-', '/')} — {today.replaceAll('-', '/')}</span><span>{deviceId ? devices.data?.find(device => device.deviceId === deviceId)?.hostname ?? '所选设备' : devices.data ? `${devices.data.length} 台设备` : '设备查询中'} · {agent ? agentName(agent) : '全部 Agent'}</span></div>
      <Feedback resource={current} retry={retry} />
      <div className="metric-band" aria-label="筛选范围内的统计" aria-busy={current.loading}>
        <div className="metric metric-primary"><span className="metric-label">{periods[period]}总用量</span><div className="metric-number"><strong data-testid="token-total" data-value={totals?.metrics.total ?? ''} title={totals ? fullCount(totals.metrics.total) : '没有记录'}>{compact(totals?.metrics.total)}</strong><span>Token</span></div><span className={`metric-foot ${delta == null ? '' : delta >= 0 ? 'positive' : 'negative'}`}>{delta === null ? current.loading ? '读取中' : totals ? previous.error ? '对比暂不可用' : `暂无${range.comparison}` : '暂无数据' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}% · 相比${range.comparison}`}</span>{previous.error !== undefined && <button className="text-button" type="button" onClick={retry}>重试对比</button>}</div>
        <div className="metric"><span className="metric-label">输入 / 输出</span><div className="metric-number pair"><strong title={fullCount(totals?.metrics.input)}>{compact(totals?.metrics.input)}</strong><span>/</span><strong title={fullCount(totals?.metrics.output)}>{compact(totals?.metrics.output)}</strong></div><span className="metric-foot">含缓存读取</span></div>
        <div className="metric"><span className="metric-label">缓存命中率</span><div className="metric-number"><strong>{rate(totals?.metrics)}</strong></div><span className="metric-foot">{totals ? `缓存读取 ${typeof totals.metrics.cacheRead === 'number' ? compact(totals.metrics.cacheRead) : fullCount(totals.metrics.cacheRead)}` : '缓存读取 / 输入 Token'}</span></div>
        <div className="metric"><span className="metric-label">API 等价估算</span><div className="metric-number token-cost-number">{totals ? totals.costs.map(cost => <span className="token-cost" key={cost.currency}><strong title={cost.apiEstimate ?? fullCount(undefined)}>{money(cost.apiEstimate, cost.currency)}</strong><span>{cost.currency}</span></span>) : <strong>—</strong>}</div><span className="metric-foot" title={totals ? costText(totals.costs) : undefined}>{totals?.costs.map(cost => coverageLabel[cost.coverage]).filter(Boolean).join(' · ') || (totals ? '按 API 用量估算' : '')}</span>{totals?.costs.some(cost => cost.actual !== undefined || cost.unclassified !== undefined) && <span className="metric-foot">{totals.costs.flatMap(cost => [cost.actual !== undefined ? `实际 ${money(cost.actual, cost.currency)}` : '', cost.unclassified !== undefined ? `未分类 ${money(cost.unclassified, cost.currency)}` : '']).filter(Boolean).join(' · ')}</span>}</div>
      </div>
    </section>
    <div className="analysis-grid">
      <TokenTrend current={current.data} previous={previous.data} usage={usage} colors={modelColors} range={range} selectedDate={selectedDate} selectDate={selectDate} clearFilters={reset} retry={retry} />
      <ModelComposition current={current} catalogue={catalogue} modelColors={modelColors} modelKey={modelKey} setModel={setModel} retry={retry} />
    </div>
    <TokenCalendar today={today} resource={annual} selectedDate={selectedDate} selectDate={selectDate} retry={retry} />
    <div className="bottom-grid">
      <TokenDevices resource={devices} deviceId={deviceId} refresh={retry} />
      <section className="panel daily-panel" aria-labelledby="daily-title"><h2 id="daily-title"><button type="button" className="daily-toggle" aria-expanded={expanded} aria-controls="token-daily-details" onClick={() => setExpanded(value => !value)}><ChevronDown className="disclosure-icon" size={16} /><span>日统计明细</span><span className="small-note">{daily.length} 天</span></button></h2><div id="token-daily-details" ref={details} tabIndex={expanded ? 0 : -1} className="table-scroll" role="region" aria-label="每日统计表"><div className="table-inner"><Feedback resource={usage} retry={retry} label="正在读取完整明细…" />{usage.data && <><table><thead><tr><th scope="col">日期</th><th scope="col">总 Token</th><th scope="col">缓存命中</th><th scope="col">API 估算</th></tr></thead><tbody>{[...daily].reverse().map(day => <tr key={day.date}><th scope="row">{day.date.replaceAll('-', '/')}</th><td>{fullCount(day.metrics.total)}</td><td>{rate(day.metrics)}</td><td title={costText(day.costs)}>{day.costs.map(cost => `${money(cost.apiEstimate, cost.currency)}${coverageLabel[cost.coverage] ? `（${coverageLabel[cost.coverage]}）` : ''}`).join('；')}</td></tr>)}{!daily.length && <tr><td colSpan={4}>当前筛选下没有记录</td></tr>}</tbody></table><p className="small-note">已读取 {usage.data.length} 份设备日汇总{usage.data.length !== current.data?.rowCount ? ' · 同步中数据已变化，请刷新核对' : ''}</p></>}</div></div></section>
    </div>
  </>
}

const MODEL_PREVIEW_LIMIT = 5

type ModelSummary = TokenDashboardSummary['models'][number]

function ModelRowContent({ model, color, share, selected, filterable = false }: { model: ModelSummary; color: string; share: number | null; selected: boolean; filterable?: boolean }) {
  return <>
    <span className="model-row-heading">
      <span className="model-name"><i style={{ background: color }} />{modelName(model.modelId)}</span>
      <span className="model-row-action"><span className="model-share">{share === null ? '—' : `${share.toFixed(1)}%`}</span>{selected ? <Check size={13} aria-hidden="true" /> : filterable && <ArrowRight size={13} aria-hidden="true" />}</span>
    </span>
    <span className="model-row-values"><strong title={fullCount(model.metrics.total)}>{compact(model.metrics.total)}</strong><span title={costText(model.costs)}>{model.costs.map(cost => cost.apiEstimate === null ? '费用未知' : money(cost.apiEstimate, cost.currency)).join(' · ')}{model.costs.some(cost => typeof cost.apiEstimate === 'string' && cost.coverage !== 'complete') && <small className="model-cost-coverage">{model.costs.map(cost => coverageLabel[cost.coverage]).filter(Boolean).join(' · ')}</small>}</span></span>
    <span className="share-track"><span style={{ inlineSize: `${Math.min(100, share ?? 0)}%`, background: color }} /></span>
  </>
}

function ModelComposition({ current, catalogue, modelColors, modelKey, setModel, retry }: {
  current: Resource<TokenDashboardSummary>; catalogue: Resource<TokenDashboardSummary>; modelColors: Map<string, string>; modelKey: string; setModel: (key: string) => void; retry: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const total = current.data?.rowCount ? current.data.totals.metrics.total : undefined
  const rows = [...(current.data?.models ?? [])].sort((a, b) => (b.metrics.total ?? -1) - (a.metrics.total ?? -1)).map((model, index) => {
    const key = JSON.stringify(model.modelId), color = modelColors.get(key) ?? modelColor(index)
    const share = typeof model.metrics.total === 'number' && typeof total === 'number' && total > 0 ? model.metrics.total / total * 100 : null
    return { key, model, color, share, selected: modelKey === key }
  })
  const empty = <div className="chart-empty"><strong>{current.loading ? '正在读取模型…' : current.error !== undefined ? '模型暂不可用' : '暂无模型数据'}</strong></div>
  const open = () => {
    // Keep the actual invoker focused even when the user clicks the card background.
    opener.current?.focus({ preventScroll: true })
    dialog.current?.showModal()
    setListOpen(true)
  }
  return <>
    <section className="panel model-panel" aria-labelledby="models-title" onClick={event => {
      if (!(event.target instanceof Element) || !event.target.closest('button')) open()
    }}>
      <div className="panel-heading">
        <h2 id="models-title">模型构成</h2>
        <button ref={opener} type="button" className="text-button model-list-open" aria-haspopup="dialog" onClick={open}>查看完整列表<ArrowRight size={13} aria-hidden="true" /></button>
      </div>
      <p className="small-note model-list-note">Token 占比{current.data && ` · ${rows.length > MODEL_PREVIEW_LIMIT ? `前 ${MODEL_PREVIEW_LIMIT} / ` : ''}共 ${rows.length} 项`}</p>
      <div className="model-list">{rows.length ? rows.slice(0, MODEL_PREVIEW_LIMIT).map(({ key, ...row }) => <div className={`model-row${row.selected ? ' model-row-selected' : ''}`} key={key}><ModelRowContent {...row} /></div>) : empty}</div>
      {modelKey && <button type="button" className="text-button model-clear" onClick={() => setModel('')}>清除模型筛选<ArrowRight size={13} aria-hidden="true" /></button>}
      <Feedback resource={{ ...catalogue, loading: false }} retry={retry} />
    </section>
    <dialog ref={dialog} className="model-dialog" aria-labelledby="model-dialog-title" onClose={() => setListOpen(dialog.current?.open ?? false)}>
      <header className="model-dialog-heading">
        <div><h1 id="model-dialog-title">完整模型列表</h1><p className="small-note">Token 占比{current.data && ` · 共 ${rows.length} 项`}{rows.length > 0 && ' · 点击模型筛选'}</p></div>
        <form method="dialog"><button type="submit" className="button model-dialog-close" aria-label="关闭完整模型列表" autoFocus><X size={18} aria-hidden="true" /></button></form>
      </header>
      {listOpen && <div className="model-dialog-list" aria-busy={current.loading}>
        {rows.length ? rows.map(({ key, ...row }) => <button type="button" className="model-row" key={key} aria-pressed={row.selected} aria-label={`${row.selected ? '取消筛选' : '筛选'}${modelName(row.model.modelId)}`} aria-description={`${fullCount(row.model.metrics.total)} Token · 占比 ${row.share === null ? '未知' : `${row.share.toFixed(1)}%`} · ${costText(row.model.costs)}`} onClick={() => {
          dialog.current?.close()
          setModel(row.selected ? '' : key)
        }}><ModelRowContent {...row} filterable /></button>) : empty}
        {current.error !== undefined && <Feedback resource={current} retry={retry} />}
      </div>}
    </dialog>
  </>
}

export type SummaryDay = TokenDashboardSummary['daily'][number]
