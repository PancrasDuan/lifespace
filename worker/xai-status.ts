import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { z } from 'zod'
import { ApiError, upstreamText } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'
import { xaiEventSubStatuses } from './xai-event-substatuses'

const feedSchema = z.object({ rss: z.object({ channel: z.object({
  title: z.literal('SpaceXAI System Status'), link: z.string(),
  item: z.array(z.object({ title: z.string(), link: z.string(), guid: z.string(), description: z.string(), pubDate: z.string(), category: z.array(z.string()) })).default([]),
}) }) })

function plainText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/<\/?(?:p|div|h[1-6]|br|hr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match
  }).replace(/\n\s*\n/g, '\n').trim()
}

export async function readXAI(): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  const xml = await upstreamText(new URL('https://status.x.ai/feed.xml'))
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件订阅内容无效', 502)
  const parsed: unknown = new XMLParser({ processEntities: false, parseTagValue: false, isArray: name => name === 'item' || name === 'category' }).parse(xml)
  const decoded = feedSchema.safeParse(parsed)
  if (!decoded.success || !['https://status.x.ai', 'https://status.x.ai/'].includes(decoded.data.rss.channel.link)) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件订阅内容无效', 502)
  const incidents = new Map<string, AiProvider['incidents'][number]>()
  const affectedModules = new Map<string, string>()
  for (const item of decoded.data.rss.channel.item) {
    const state = item.category.find(category => ['investigating', 'identified', 'monitoring', 'resolved'].includes(category))
    if (!state) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件订阅状态无效', 502)
    if (state === 'resolved') continue
    const title = plainText(item.title).match(/^\[([^\]]+)\]\s*(.*)$/)
    const created = Date.parse(item.pubDate)
    if (!title || !Number.isFinite(created)) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件订阅内容无效', 502)
    const link = new URL(item.link)
    const parts = link.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (link.origin !== 'https://status.x.ai' || link.username || link.password || parts.length !== 2 || !/^[a-z0-9-]+$/.test(parts[0]) || parts[1] !== item.guid) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件模块归属无效', 502)
    affectedModules.set(parts[0], title[1])
    const updates = [...item.description.matchAll(/<div>([\s\S]*?)<\/div>/gi)].map(match => {
      const date = match[1].match(/<strong>([^<]+)<\/strong>/i)?.[1]
      const at = date ? Date.parse(date) : NaN
      if (!Number.isFinite(at)) throw new ApiError('SOURCE_INVALID_RESPONSE', '官方事件更新时间无效', 502)
      const body = plainText(match[1].replace(/^\s*<p><strong>[\s\S]*?<\/strong><\/p>\s*<h3>[\s\S]*?<\/h3>/i, ''))
      return { body, createdAt: new Date(at).toISOString() }
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const service = title[1]
    const existing = incidents.get(item.guid)
    if (existing) {
      if (!existing.affectedServices.includes(service)) existing.affectedServices.push(service)
      existing.updates = [...new Map([...existing.updates, ...updates].map(update => [JSON.stringify([update.createdAt, update.body]), update])).values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      existing.description = existing.updates.find(update => update.body.trim())?.body ?? '原因待公布'
      existing.updatedAt = existing.updates[0]?.createdAt ?? existing.updatedAt
      continue
    }
    incidents.set(item.guid, { id: item.guid, title: title[2] || service, status: state, description: updates.find(update => update.body.trim())?.body ?? '原因待公布', affectedServices: [service], updatedAt: updates[0]?.createdAt ?? new Date(created).toISOString(), updates })
  }
  const events = [...incidents.values()]
  return { statusBasis: 'official-events', checkedAt: new Date().toISOString(), status: events.length ? 'abnormal' : 'normal', description: events.length ? '存在未解决官方事件，涉及的子模块标为异常' : '无未解决官方事件，按事件规则可用', incidents: events, affectedServices: [...new Set(events.flatMap(event => event.affectedServices))], error: null, subStatuses: xaiEventSubStatuses(affectedModules), subStatusError: null }
}
