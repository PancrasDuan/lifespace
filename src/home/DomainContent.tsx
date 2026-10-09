import type { UseQueryResult } from '@tanstack/react-query'
import { Temporal } from '@js-temporal/polyfill'
import { ExternalLink } from 'lucide-react'
import type { DomainInfo, DomainsResult } from '../shared/contracts'
import { dateKey } from './time'

const statuses = { registered: '已注册', active: '正常', suspended: '已暂停', expired: '已过期', unknown: '状态未知' }
function remainingDays(domain: DomainInfo, today: string): number | null {
  return domain.neverExpires || !domain.expiresOn ? null : Temporal.PlainDate.from(today).until(domain.expiresOn).days
}
function expiryText(domain: DomainInfo, today: string) {
  if (domain.neverExpires) return '永久有效'
  const days = remainingDays(domain, today)
  if (days === null) return '到期日期未知'
  if (days < 0) return `已超到期日期 ${Math.abs(days)} 天`
  if (days === 0) return '今日到期'
  return `剩余 ${days} 天`
}
function orderedDomains(domains: DomainInfo[]) {
  return [...domains].sort((a, b) => (a.neverExpires ? '9999' : a.expiresOn ?? '9999').localeCompare(b.neverExpires ? '9999' : b.expiresOn ?? '9999') || a.name.localeCompare(b.name))
}
export function DNSHELoginLink() {
  return <a href="https://my.dnshe.com/clientarea.php" target="_blank" rel="noopener noreferrer" className="domain-website">DNSHE 登录 <ExternalLink size={12} aria-hidden="true" /></a>
}
export function DomainContent({ query, now, localZone }: { query: UseQueryResult<DomainsResult, Error>; now: Date; localZone: string }) {
  if (!query.data) return <div className="data-message" role="status">{query.isPending ? '正在获取域名信息…' : query.error?.message ?? '域名信息获取失败'}</div>
  const domains = orderedDomains(query.data.domains)
  const today = dateKey(now, localZone)
  return <><div className="domain-content"><div className="domain-summary"><strong>{String(domains.length).padStart(2, '0')}</strong><span>个域名</span></div>
    {domains.length ? <div className="domain-list">{domains.slice(0, 3).map(domain => <div className="domain-row" key={domain.name}><strong>{domain.name}</strong><span>{statuses[domain.status]} · {expiryText(domain, today)}</span></div>)}{domains.length > 3 && <p className="quiet">点击查看全部 {domains.length} 个域名</p>}</div> : <p className="quiet">暂无域名</p>}
  </div>{query.isError && <p className="inline-error">更新失败 · 正在显示上次结果</p>}</>
}
export function DomainDetail({ query, now, localZone }: { query: UseQueryResult<DomainsResult, Error>; now: Date; localZone: string }) {
  const today = dateKey(now, localZone)
  return <>{query.data?.domains.length ? <><ul className="domain-detail-list">{orderedDomains(query.data.domains).map(domain => <li key={domain.name}><strong>{domain.name}</strong><span>{statuses[domain.status]}</span><p>{expiryText(domain, today)}{domain.expiresOn && <><br />到期日期 · {domain.expiresOn}</>}</p></li>)}</ul>{query.isError && <p className="inline-error">更新失败 · 正在显示上次结果</p>}</> : <DomainContent query={query} now={now} localZone={localZone} />}
    <DNSHELoginLink /></>
}
