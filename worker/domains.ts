import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import type { DomainInfo, DomainsResult } from '../src/shared/contracts'
import { ApiError, upstream } from './upstream'

const responseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), subdomains: z.array(z.object({
    full_domain: z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i), status: z.string(), expires_at: z.string().nullish(),
    never_expires: z.union([z.boolean(), z.literal(0), z.literal(1), z.literal('0'), z.literal('1')]).optional(),
  })), pagination: z.object({ has_more: z.boolean() }).optional() }),
  z.object({ success: z.literal(false), error_code: z.string().optional() }),
])

// DNSHE 文档的日期不含时区；仅采用来源的日历日期，不推算注册年限或具体到期时刻。
function expiryDate(value: string | null | undefined): string | null {
  const date = value?.match(/^\d{4}-\d{2}-\d{2}(?=$|[ T])/)?.[0]
  if (!date || date.startsWith('0000-')) return null
  try { return Temporal.PlainDate.from(date).toString() } catch { return null }
}

export async function readDomains(env: Partial<CloudflareEnv>): Promise<DomainsResult> {
  if (!env.DNSHE_API_KEY || !env.DNSHE_API_SECRET) throw new ApiError('DOMAINS_NOT_CONFIGURED', 'DNSHE 信息尚未接入', 503)
  const domains = new Map<string, DomainInfo>()
  const deadline = Date.now() + 12000
  const signal = AbortSignal.timeout(12000)
  const url = new URL('https://api005.dnshe.com/index.php')
  url.search = new URLSearchParams({ m: 'domain_hub', endpoint: 'subdomains', action: 'list',
    fields: 'full_domain,status,expires_at,never_expires', per_page: '100' }).toString()
  for (let page = 1; ; page++) {
    if (Date.now() >= deadline) throw new ApiError('SOURCE_TIMEOUT', '域名信息读取超时，请稍后刷新', 504)
    if (page > 10) throw new ApiError('SOURCE_INVALID_RESPONSE', '域名来源返回的数据过多', 502)
    url.searchParams.set('page', String(page))
    const data = await upstream(url, responseSchema, { method: 'GET', redirect: 'manual', signal,
      headers: { 'X-API-Key': env.DNSHE_API_KEY, 'X-API-Secret': env.DNSHE_API_SECRET } })
    if (!data.success) {
      if (data.error_code?.startsWith('auth_') || data.error_code === 'api_access_disabled') {
        throw new ApiError('SOURCE_CONNECTION_INVALID', 'DNSHE 连接失效，请检查服务端配置', 502)
      }
      throw new ApiError('SOURCE_UNAVAILABLE', 'DNSHE 暂时不可用，请稍后刷新', 502)
    }
    for (const row of data.subdomains) {
      const name = row.full_domain.toLowerCase()
      const neverExpires = row.never_expires === true || row.never_expires === 1 || row.never_expires === '1'
      const sourceStatus = row.status.toLowerCase()
      const status = sourceStatus === 'registered' || sourceStatus === 'active' || sourceStatus === 'suspended' || sourceStatus === 'expired' ? sourceStatus : 'unknown'
      domains.set(name, { name, status, expiresOn: neverExpires ? null : expiryDate(row.expires_at), neverExpires })
    }
    if (data.pagination ? !data.pagination.has_more : data.subdomains.length < 100) break
  }
  return { fetchedAt: new Date().toISOString(), domains: [...domains.values()] }
}
