import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { newsResultSchema } from '../../src/shared/news-contracts'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const permitted = { NEWS_READ_LIMITER: { limit: async () => ({ success: true }) } }
const topics = { schemaVersion: 1, count: 2, items: [
  { rank: 1, id: 'first', title: ' AI 热点一 ', links: { story: 'https://aihot.virxact.com/story/event-one', aihot: 'https://aihot.news/items/first', original: 'https://example.com/original' } },
  { rank: 3, id: 'second', title: 'AI 热点二', links: { aihot: 'https://aihot.news/items/second' } },
] }

test('AIHOT 默认关闭，官方热点 API 保留排名并打开事件详情或 AIHOT 阅读页', async () => {
  const fetch = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.href).toBe('https://aihot.news/api/v1/hot-topics')
    const headers = new Headers(init.headers)
    expect(headers.has('Cookie')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
    return Response.json(topics)
  })
  vi.stubGlobal('fetch', fetch)
  const metadata = await (await app.request('/api/news/sources')).json() as { sources: { id: string; defaultEnabled: boolean; label: string }[] }
  expect(metadata.sources.at(-1)).toMatchObject({ id: 'aihot', label: 'AIHOT 热点榜', defaultEnabled: false })
  const response = await app.request('/api/news/source?id=aihot', { headers: { Cookie: 'private', Authorization: 'private' } }, permitted)
  expect(response.status).toBe(200)
  const body = newsResultSchema.parse(await response.json())
  expect(body.items).toEqual([
    { id: 'first', title: 'AI 热点一', url: 'https://aihot.news/story/event-one', rank: 1 },
    { id: 'second', title: 'AI 热点二', url: 'https://aihot.news/items/second', rank: 3 },
  ])
  expect(body).toMatchObject({ sourceId: 'aihot', sourceUpdatedAt: null, stale: false })
})

test('AIHOT 仅保留前十项，过滤危险链接和无效排名，不将最新进展误报为榜单更新时间', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ schemaVersion: 1, items: [
    { rank: 1, title: '危险链接', links: { story: 'javascript:alert(1)', aihot: 'https://other.example/' } },
    { rank: 2, title: '安全回退', links: { story: 'https://private@aihot.news/story/x', aihot: 'https://aihot.news/items/safe' }, latestAt: '2026-10-08T01:00:00Z' },
    { rank: 0, title: '无效排名', links: { aihot: 'https://aihot.news/items/bad' } },
    ...Array.from({ length: 9 }, (_, i) => ({ rank: i + 4, title: '热点' + i, links: { story: 'https://aihot.news/story/' + i } })),
  ] }))
  const body = newsResultSchema.parse(await (await app.request('/api/news/source?id=aihot', {}, permitted)).json())
  expect(body.items).toHaveLength(8)
  expect(body.items[0]).toMatchObject({ title: '安全回退', rank: 2, url: 'https://aihot.news/items/safe' })
  expect(body.items.at(-1)).toMatchObject({ rank: 10 })
  expect(body.sourceUpdatedAt).toBeNull()
})

test('AIHOT 复用新鲜缓存，过期失败回退原时间，合法空榜单恢复且无效版本拒绝', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  const entries = new Map<string, Response>()
  vi.stubGlobal('caches', { open: async () => ({
    match: async (key: Request) => entries.get(key.url)?.clone(),
    put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()) },
  }) })
  const fetch = vi.fn(async () => Response.json(topics)); vi.stubGlobal('fetch', fetch)
  const read = async () => newsResultSchema.parse(await (await app.request('/api/news/source?id=aihot', {}, permitted)).json())
  const original = await read()
  expect(await read()).toEqual({ ...original, cacheHit: true })
  expect(fetch).toHaveBeenCalledOnce()
  vi.setSystemTime(new Date('2026-10-08T00:06:00Z'))
  fetch.mockImplementation(async () => new Response('private-detail', { status: 503 }))
  expect(await read()).toMatchObject({ items: original.items, fetchedAt: original.fetchedAt, stale: true, warning: { code: 'SOURCE_UNAVAILABLE' } })
  fetch.mockImplementation(async () => Response.json({ ...topics, items: [] }))
  expect(await read()).toMatchObject({ items: [], stale: false, warning: null })
  entries.clear()
  fetch.mockImplementation(async () => Response.json({ ...topics, schemaVersion: 2 }))
  expect((await app.request('/api/news/source?id=aihot', {}, permitted)).status).toBe(502)
})
