import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from './api'
import type { AiProvider } from '../shared/ai-status-contracts'
import './ai-status.css'

export const aiStatusDescription = '官方状态为汇总信息，具体是否影响工作请结合受影响服务自行判断。'

const labels = { normal: '正常', abnormal: '存在异常', unknown: '状态未知' }
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function useAiStatus() {
  const query = useQuery({ queryKey: ['ai-status'], queryFn: ({ signal }) => api.aiStatus(signal), staleTime: 3600000, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 3600000, refetchIntervalInBackground: false })
  const previous = useRef(new Map<string, AiProvider>())
  useEffect(() => {
    if (query.isError) return
    for (const provider of query.data?.providers ?? []) if (provider.status !== 'unknown') previous.current.set(provider.id, provider)
  }, [query.data, query.isError])
  return { query, previous: previous.current }
}

type StatusView = ReturnType<typeof useAiStatus>

function Incidents({ provider, detail = false }: { provider: AiProvider; detail?: boolean }) {
  return <ul className="ai-incidents">{provider.incidents.map(event => <li key={event.id}>
    <strong>{event.title}</strong><p>{event.description}</p>
    {detail && <><p>受影响服务：{event.affectedServices.join('、') || '官方未列出'}</p><small>事件更新：{time(event.updatedAt)}</small>
      {event.updates.length > 1 && <details><summary>官方更新记录</summary>{event.updates.map((update, index) => <div key={index}><small>{time(update.createdAt)}</small><p>{update.body}</p></div>)}</details>}</>}
  </li>)}</ul>
}

function Providers({ view, detail = false }: { view: StatusView; detail?: boolean }) {
  return <div className="ai-providers">{view.query.data?.providers.filter(provider => detail || view.query.isError || provider.status !== 'normal' || provider.subStatusError).map(provider => {
    const stale = view.query.isError || provider.status === 'unknown'
    const current = stale ? 'unknown' : provider.status
    const last = stale ? view.previous.get(provider.id) : undefined
    return <section className="ai-provider" key={provider.id} aria-label={`${provider.name} 状态`}>
      <div className="ai-provider-heading"><strong>{provider.name}</strong><span className={`ai-state ai-state-${current}`}>{current === 'normal' && provider.statusBasis === 'official-events' ? '可用' : labels[current]}</span></div>
      {provider.error && <p className="inline-error">{provider.error}</p>}
      {!view.query.isError && !provider.error && (detail || provider.status !== 'normal') && <p>{provider.description}</p>}
      {!detail && provider.subStatusError && <p>官网子状态暂不可获取</p>}
      {!stale && provider.status === 'abnormal' && <><Incidents provider={provider} detail={detail} />
        {provider.affectedServices.length > 0 && <p>受影响服务：{provider.affectedServices.join('、')}</p>}
        {provider.incidents.length === 0 && <p>原因待公布</p>}</>}
      {last && <div className="ai-stale"><small>上次结果 · {time(last.checkedAt)} · {labels[last.status]}，当前状态未确认</small><Incidents provider={last} detail={detail} /></div>}
      {detail && <><SubStatuses provider={provider} stale={view.query.isError} /><p className="ai-check">{view.query.isError ? '上次成功检查' : '最近检查'}：{time(provider.checkedAt)}</p><a href={provider.statusUrl} target="_blank" rel="noopener noreferrer">{provider.name} 官方状态页</a></>}
    </section>
  })}</div>
}

function SubStatuses({ provider, stale }: { provider: AiProvider; stale: boolean }) {
  const eventBased = provider.statusBasis === 'official-events'
  const heading = eventBased ? '子模块状态（按事件）' : '官网子状态'
  const listName = `${provider.name} ${eventBased ? '子模块状态' : '官网子状态'}`
  if (stale) return <div className="ai-substatus-section"><h3>{heading}</h3><p>本次获取失败，当前{eventBased ? '子模块状态' : '官网子状态'}未知</p></div>
  return <div className="ai-substatus-section"><h3>{heading}</h3>
    {eventBased && <p className="ai-basis-note">依据官方未解决事件判定：涉及模块标为异常，其余按本页规则视为可用。</p>}
    {provider.subStatusError && <p className="ai-substatus-unavailable" role="status">{provider.subStatusError}</p>}
    {!provider.subStatusError && !provider.subStatuses.length && <p>尚未取得官网子状态列表</p>}
    {provider.subStatuses.length > 0 && <ul className="ai-substatuses" aria-label={listName}>
      {provider.subStatuses.map(group => <li key={group.id}>
        <div className="ai-substatus-heading"><strong>{group.name}</strong>
          {!['Services', 'Third-party Services'].includes(group.name) && <span className={`ai-state ai-state-${group.status}`}>{group.statusLabel}</span>}
        </div>
        {group.components.length > 0 && <ul className="ai-components" aria-label={`${group.name} 子服务`}>{group.components.map(component => <li key={component.id}><span>{component.name}</span><span className={`ai-state ai-state-${component.status}`}>{component.statusLabel}</span></li>)}</ul>}
        {group.status !== 'unknown' && group.components.some(component => component.status === 'unknown') && <small>部分子服务状态未知</small>}
      </li>)}
    </ul>}
  </div>
}

export function AiStatusContent({ view }: { view: StatusView }) {
  const { query } = view
  const status = query.isError || !query.data ? 'unknown' : query.data.status
  return <div className="ai-content"><div className={`ai-overall ai-state-${status}`}><strong>{query.isPending ? '正在获取' : labels[status]}</strong><span>{query.data?.providers.map(provider => provider.name).join(' · ') || '官方服务运行状态'}</span></div>
    {query.isError && <p className="inline-error">本次获取失败，当前状态未知</p>}
    {query.data && <Providers view={view} />}
    {!query.data && !query.isPending && <p>请刷新重试，或进入详情查看官方状态页</p>}
  </div>
}

export function AiStatusDetail({ view }: { view: StatusView }) {
  return <>
    {view.query.isError && <p className="inline-error">本次获取失败，当前状态未知</p>}
    {view.query.data ? <Providers view={view} detail /> : <p>状态尚未获取。<a href="https://status.openai.com/" target="_blank" rel="noopener noreferrer">OpenAI 官方状态页</a> · <a href="https://status.x.ai/" target="_blank" rel="noopener noreferrer">xAI 官方状态页</a></p>}
  </>
}
