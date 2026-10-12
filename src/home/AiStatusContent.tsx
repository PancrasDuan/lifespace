import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
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
const identities = {
  openai: { mark: 'O', category: 'AI 服务' }, xai: { mark: 'x', category: 'AI 服务' },
  resend: { mark: 'R', category: '邮件服务' }, github: { mark: 'G', category: '代码与协作' },
  cloudflare: { mark: 'C', category: '云与网络' }, supabase: { mark: 'S', category: '数据平台' },
  notion: { mark: 'N', category: '知识与办公' },
}


function Incidents({ provider, detail = false }: { provider: AiProvider; detail?: boolean }) {
  return <ul className="ai-incidents">{provider.incidents.map(event => <li key={event.id}>
    <strong>{event.title}</strong><p>{event.description}</p>
    {detail && <><p>受影响服务：{event.affectedServices.join('、') || '官方未列出'}</p><small>事件更新：{time(event.updatedAt)}</small>
      {event.updates.length > 1 && <details><summary>官方更新记录</summary>{event.updates.map((update, index) => <div key={index}><small>{time(update.createdAt)}</small><p>{update.body}</p></div>)}</details>}</>}
  </li>)}</ul>
}

function Providers({ view, detail = false }: { view: StatusView; detail?: boolean }) {
  return <div className={`ai-providers${detail ? ' service-detail-providers' : ''}`}>{view.query.data?.providers.filter(provider => detail || view.query.isError || provider.status !== 'normal' || provider.subStatusError).map(provider => {
    const stale = view.query.isError || provider.status === 'unknown'
    const currentSnapshot = !view.query.isError && (!stale || provider.subStatusError === null)
    const current = stale ? 'unknown' : provider.status
    const last = stale ? view.previous.get(provider.id) : undefined
    return <section className={`ai-provider${detail ? ' service-provider-card' : ''}`} data-provider={provider.id} data-status={current} key={provider.id} aria-label={`${provider.name} 状态`}>
      <div className="ai-provider-heading">
        {detail ? <div className="service-identity"><span className="service-mark" aria-hidden="true">{identities[provider.id].mark}</span><div><strong>{provider.name}</strong><small>{identities[provider.id].category}</small></div></div> : <strong>{provider.name}</strong>}
        <span className={`ai-state ai-state-${current}`}>{current === 'normal' && provider.statusBasis === 'official-events' ? '可用' : labels[current]}</span>
      </div>
      {provider.error && <p className="inline-error">{provider.error}</p>}
      {!view.query.isError && !provider.error && (detail || provider.status !== 'normal') && <p>{provider.description}</p>}
      {!detail && provider.subStatusError && <p>官网子状态暂不可获取</p>}
      {detail && provider.id === 'resend' && <p>汇总仅关注 SMTP、General API、Single Email；其余组件和事件见下方详情。</p>}
      {currentSnapshot && (provider.status === 'abnormal' || detail) && <><Incidents provider={provider} detail={detail} />
        {provider.affectedServices.length > 0 && <p>受影响服务：{(detail ? provider.affectedServices.slice(0, 3) : provider.affectedServices).join('、')}{detail && provider.affectedServices.length > 3 && <small> 等 {provider.affectedServices.length} 项，展开子服务查看</small>}</p>}
        {provider.status === 'abnormal' && provider.incidents.length === 0 && <p>原因待公布</p>}</>}
      {last && <div className="ai-stale"><small>上次结果 · {time(last.checkedAt)} · {labels[last.status]}，当前状态未确认</small><Incidents provider={last} detail={detail} /></div>}
      {detail && <><SubStatuses provider={provider} stale={view.query.isError} /><footer className="service-provider-footer"><span>{view.query.isError ? '上次成功检查' : '最近检查'}：{time(provider.checkedAt)}</span><a href={provider.statusUrl} target="_blank" rel="noopener noreferrer">{provider.name} 官方状态页 <ExternalLink size={12} aria-hidden="true" /></a></footer></>}
    </section>
  })}</div>
}

function SubStatuses({ provider, stale }: { provider: AiProvider; stale: boolean }) {
  const eventBased = provider.statusBasis === 'official-events'
  const heading = eventBased ? '子模块状态（按事件）' : '官网子状态'
  const listName = `${provider.name} ${eventBased ? '子模块状态' : '官网子状态'}`
  const modules = provider.subStatuses.flatMap(group => group.components.length ? group.components : [group])
  const abnormal = modules.filter(module => module.status === 'abnormal').length
  const unknown = modules.filter(module => module.status === 'unknown').length
  return <details className="ai-substatus-section service-substatus-fold">
    <summary aria-label={`${provider.name} 子服务`}><span><ChevronDown size={15} aria-hidden="true" />{heading}<small>{modules.length} 项</small></span>
      <span className="service-fold-hint">{stale || provider.subStatusError ? '当前未知' : abnormal ? `${abnormal} 项异常` : unknown ? `${unknown} 项未知` : '展开查看'}</span>
    </summary>
    <div className="service-substatus-body">
      {stale ? <p>本次获取失败，当前{eventBased ? '子模块状态' : '官网子状态'}未知</p> : <>
        {eventBased && <p className="ai-basis-note">依据官方未解决事件判定：涉及模块标为异常，其余按本页规则视为可用。</p>}
        {provider.subStatusError && <p className="ai-substatus-unavailable" role="status">{provider.subStatusError}</p>}
        {!provider.subStatusError && !provider.subStatuses.length && <p>尚未取得官网子状态列表</p>}
        <ul className="ai-substatuses" aria-label={listName}>{provider.subStatuses.map(group => <li key={group.id}>
          {group.components.length ? <details className="service-subgroup">
            <summary aria-label={`${provider.name} ${group.name} 子服务`}><span><ChevronDown size={13} aria-hidden="true" /><strong>{group.name}</strong><small>{group.components.length} 项</small></span><span className={`ai-state ai-state-${group.status}`}>{group.statusLabel}</span></summary>
            <ul className="ai-components" aria-label={`${group.name} 子服务`}>{group.components.map(component => <li key={component.id}><span>{component.name}</span><span className={`ai-state ai-state-${component.status}`}>{component.statusLabel}</span></li>)}</ul>
            {group.status !== 'unknown' && group.components.some(component => component.status === 'unknown') && <small>部分子服务状态未知</small>}
          </details> : <div className="ai-substatus-heading"><strong>{group.name}</strong><span className={`ai-state ai-state-${group.status}`}>{group.statusLabel}</span></div>}
        </li>)}</ul>
      </>}
    </div>
  </details>
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
    {view.query.data && <div className="service-detail-overview"><span>已接入 <strong>{view.query.data.providers.length}</strong> 个服务</span><span>子服务默认收起 · 按需展开</span></div>}
    {view.query.data ? <Providers view={view} detail /> : <p>状态尚未获取。<a href="https://status.openai.com/" target="_blank" rel="noopener noreferrer">OpenAI 官方状态页</a> · <a href="https://status.x.ai/" target="_blank" rel="noopener noreferrer">xAI 官方状态页</a> · <a href="https://resend-status.com/" target="_blank" rel="noopener noreferrer">Resend 官方状态页</a> · <a href="https://www.githubstatus.com/" target="_blank" rel="noopener noreferrer">GitHub 官方状态页</a> · <a href="https://www.cloudflarestatus.com/" target="_blank" rel="noopener noreferrer">Cloudflare 官方状态页</a> · <a href="https://status.supabase.com/" target="_blank" rel="noopener noreferrer">Supabase 官方状态页</a> · <a href="https://www.notion-status.com/" target="_blank" rel="noopener noreferrer">Notion 官方状态页</a></p>}
  </>
}
