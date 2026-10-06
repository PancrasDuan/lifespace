import { z } from 'zod'
import { newsSources } from '../src/shared/news-sources'
import { newsFreshMs, newsResultSchema, type NewsItem, type NewsResult } from '../src/shared/news-contracts'
import { ApiError, upstream } from './upstream'

// 与已验证的官方 MCP 请求保持一致；普通读取不需要用户认证。
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function normalizeItem(value: unknown, sourceId: string, rank: number): NewsItem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const item = value as Record<string, unknown>
  if (typeof item.title !== 'string' || !item.title.trim() || typeof item.url !== 'string') return []
  let url: URL
  try { url = new URL(item.url.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')) } catch { return [] }
  if (!['http:', 'https:'].includes(url.protocol)) return []
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim()
    : typeof item.id === 'number' && Number.isFinite(item.id) ? String(item.id) : `${sourceId}:${url.href}`
  return [{ id, title: item.title.trim(), url: url.href, rank }]
}

function sourceTime(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const date = new Date(numeric)
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null
}

export async function readNews(env: Partial<CloudflareEnv>, id: string | undefined): Promise<NewsResult> {
  const source = newsSources.find(source => source.id === id)
  if (!source) throw new ApiError('NEWS_SOURCE_INVALID', '新闻来源无效，请选择可用来源', 400)
  const key = new Request(`https://lifespace.onepeace.cc.cd/__private-cache/news-v1/${source.id}`)
  let cache: Cache | undefined
  try {
    cache = typeof caches !== 'undefined' ? await caches.open('lifespace-news-v1') : undefined
    const cached = await cache?.match(key)
    if (cached) {
      const decoded = newsResultSchema.safeParse(await cached.json())
      if (decoded.success) {
        const age = Date.now() - Date.parse(decoded.data.fetchedAt)
        if (decoded.data.sourceId === source.id && !decoded.data.stale && decoded.data.warning === null && age >= 0 && age < newsFreshMs) {
          return { ...decoded.data, cacheHit: true }
        }
      }
    }
  } catch { /* 缓存不可用时，仍经过读取保护；不放开上游调用。 */ }
  if (!env.NEWS_READ_LIMITER) throw new ApiError('NEWS_NOT_CONFIGURED', '新闻读取保护尚未配置', 503)
  let allowed: boolean
  try { allowed = (await env.NEWS_READ_LIMITER.limit({ key: 'lifespace:news:read' })).success }
  catch { throw new ApiError('NEWS_PROTECTION_UNAVAILABLE', '新闻读取保护暂时不可用，请稍后重试', 503) }
  if (!allowed) throw new ApiError('SOURCE_RATE_LIMITED', '新闻读取过于频繁，请稍后刷新', 429)
  const url = new URL('https://newsnow.busiyi.world/api/s')
  url.searchParams.set('id', source.id)
  const schema = z.object({ id: z.literal(source.id), status: z.enum(['success', 'cache']), updatedTime: z.unknown().optional(), items: z.array(z.unknown()) })
  const result = await upstream(url, schema, { method: 'GET', headers: { 'User-Agent': userAgent } })
  const items = result.items.slice(0, 30).flatMap((item, index) => normalizeItem(item, source.id, index + 1))
  if (result.items.length && !items.length) throw new ApiError('SOURCE_INVALID_RESPONSE', '新闻源返回了无效榜单，请稍后重试', 502)
  const normalized: NewsResult = {
    sourceId: source.id, fetchedAt: new Date().toISOString(), sourceUpdatedAt: sourceTime(result.updatedTime),
    upstreamStatus: result.status, cacheHit: false, stale: false, warning: null, items,
  }
  try { await cache?.put(key, Response.json(normalized, { headers: { 'Cache-Control': 'public, max-age=86400' } })) }
  catch { /* 保存失败不影响本次经过校验的成功读取。 */ }
  return normalized
}
