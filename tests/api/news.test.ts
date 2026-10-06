import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { newsResultSchema, newsSourcesResultSchema } from '../../src/shared/news-contracts'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const permitted = { NEWS_READ_LIMITER: { limit: async () => ({ success: true }) } }
const upstreamList = (items: unknown[], id = 'baidu') => ({ id, status: 'success', items })

test('来源白名单拒绝缺失、任意 URL 和未知来源，接口不接受写入', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  for (const query of ['', '?id=unknown', '?id=https://example.com', '?id=baidu%2F..%2Fzhihu']) {
    const response = await app.request('/api/news/source' + query, {}, permitted)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'NEWS_SOURCE_INVALID' } })
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    expect((await app.request('/api/news/source?id=baidu', { method }, permitted)).status).toBe(404)
  }
  expect(fetch).not.toHaveBeenCalled()
})

test('过滤无效标题与危险链接，保留原编号和稳定 ID，只读原榜单前三十项', async () => {
  const items: unknown[] = [
    { title: ' ', url: 'https://example.com/empty' },
    { title: '<script>文本</script>', url: 'https://example.com/a?x=1&#38;y=2' },
    { title: '危险协议', url: 'javascript:alert(1)' },
    { title: '相对链接', url: '/relative' },
    ...Array.from({ length: 28 }, (_, i) => ({ id: i, title: '新闻' + i, url: 'http://example.com/' + i })),
  ]
  vi.stubGlobal('fetch', async () => Response.json(upstreamList(items)))
  const body = newsResultSchema.parse(await (await app.request('/api/news/source?id=baidu', {}, permitted)).json())
  expect(body.items).toHaveLength(27)
  expect(body.items[0]).toEqual({ id: 'baidu:https://example.com/a?x=1&y=2', title: '<script>文本</script>', url: 'https://example.com/a?x=1&y=2', rank: 2 })
  expect(body.items.at(-1)).toMatchObject({ id: '25', rank: 30 })
  expect(body.sourceUpdatedAt).toBeNull()
})

test('合法空榜单与全部无效条目区别处理，无效状态或来源不缓存', async () => {
  const entries = edgeCache()
  vi.stubGlobal('fetch', async () => Response.json(upstreamList([])))
  const empty = await app.request('/api/news/source?id=baidu', {}, permitted)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toMatchObject({ items: [], stale: false })
  entries.clear()
  for (const body of [upstreamList([{ title: '无链接' }]), upstreamList([], 'zhihu'), { ...upstreamList([]), status: 'error' }]) {
    vi.stubGlobal('fetch', async () => Response.json(body))
    const response = await app.request('/api/news/source?id=baidu', {}, permitted)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_INVALID_RESPONSE' } })
    expect(entries.size).toBe(0)
  }
})

test('缓存故障、限流拒绝和保护缺失均不能放开上游，错误不暴露内部内容', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('caches', { open: async () => { throw new Error('private-detail') } })
  for (const [env, status, code] of [
    [{}, 503, 'NEWS_NOT_CONFIGURED'],
    [{ NEWS_READ_LIMITER: { limit: async () => ({ success: false }) } }, 429, 'SOURCE_RATE_LIMITED'],
    [{ NEWS_READ_LIMITER: { limit: async () => { throw new Error('private-detail') } } }, 503, 'NEWS_PROTECTION_UNAVAILABLE'],
  ] as const) {
    const response = await app.request('/api/news/source?id=baidu&nonce=force', {}, env)
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: { code } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    if (status === 429) expect(response.headers.get('Retry-After')).toBe('60')
  }
  expect(fetch).not.toHaveBeenCalled()
})

test('过新鲜期失败保留快照但返回稳定错误，失败计入限流且不续期', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
  const entries = edgeCache()
  const limit = vi.fn(async () => ({ success: true }))
  const fetch = vi.fn(async () => Response.json(upstreamList([{ title: '热点', url: 'https://example.com/story' }])))
  vi.stubGlobal('fetch', fetch)
  const env = { NEWS_READ_LIMITER: { limit } }
  await app.request('/api/news/source?id=baidu', {}, env)
  const snapshot = [...entries.values()][0]
  vi.setSystemTime(new Date('2026-10-06T08:05:00Z'))
  fetch.mockImplementation(async () => { throw new Error('private-detail') })
  for (let i = 0; i < 2; i++) {
    const response = await app.request('/api/news/source?id=baidu', {}, env)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-detail')
  }
  expect([...entries.values()][0]).toBe(snapshot)
  expect(snapshot.expiresAt).toBe(Date.parse('2026-10-07T08:00:00Z'))
  expect(limit).toHaveBeenCalledTimes(3)
})

test.each([302, 401, 403, 429, 500])('新闻上游 HTTP %s 映射为脱敏错误，不跟随重定向', async status => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', async () => new Response('private-detail', { status, headers: { Location: 'https://other.example/' } }))
  const response = await app.request('/api/news/source?id=baidu', {}, permitted)
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ error: { code: status === 401 || status === 403 ? 'SOURCE_CONNECTION_INVALID' : 'SOURCE_UNAVAILABLE' } })
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-detail')
  log.mockRestore()
})

test('过大正文及时停止读取，不返回或缓存部分榜单', async () => {
  const entries = edgeCache()
  const cancel = vi.fn()
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)) }, cancel })))
  const response = await app.request('/api/news/source?id=baidu', {}, permitted)
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_INVALID_RESPONSE' } })
  expect(cancel).toHaveBeenCalledOnce()
  expect(entries.size).toBe(0)
})

test('新闻请求使用十秒超时信号，超时稳定映射为 504', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  vi.stubGlobal('fetch', async () => { throw new DOMException('private-detail', 'TimeoutError') })
  const response = await app.request('/api/news/source?id=baidu', {}, permitted)
  expect(response.status).toBe(504)
  expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_TIMEOUT' } })
  expect(timeout).toHaveBeenCalledWith(10000)
  timeout.mockRestore()
})

test('缓存按来源隔离，损坏快照不使用，写缓存故障仍可返回校验结果', async () => {
  const entries = edgeCache()
  vi.stubGlobal('fetch', async (url: URL) => Response.json(upstreamList([], url.searchParams.get('id')!)))
  await app.request('/api/news/source?id=baidu', {}, permitted)
  const zhihu = await app.request('/api/news/source?id=zhihu', {}, permitted)
  expect(await zhihu.json()).toMatchObject({ sourceId: 'zhihu', cacheHit: false })
  expect(entries.size).toBe(2)
  vi.stubGlobal('caches', { open: async () => ({
    match: async () => new Response('not-json'),
    put: async () => { throw new Error('private-detail') },
  }) })
  const response = await app.request('/api/news/source?id=baidu', {}, permitted)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ sourceId: 'baidu', cacheHit: false })
})

test('新闻来源接口给出完整清单和默认五源，不读取新闻上游', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/news/sources', {}, {})
  expect(response.status).toBe(200)
  const body = newsSourcesResultSchema.parse(await response.json())
  expect(body.sources.map(source => source.id)).toEqual([
    'baidu', 'cls-hot', 'tencent-hot', 'toutiao', 'zhihu',
    'bilibili-hot-search', 'chongbuluo-hot', 'coolapk', 'douban', 'douyin', 'freebuf',
    'github-trending-today', 'hackernews', 'hupu', 'ifeng', 'iqiyi-hot-ranklist', 'juejin',
    'nowcoder', 'producthunt', 'qqvideo-tv-hotsearch', 'sspai', 'steam', 'thepaper', 'tieba',
    'wallstreetcn-hot', 'weibo', 'xueqiu-hotstock',
  ])
  expect(body.sources.filter(source => source.defaultEnabled).map(source => [source.id, source.label])).toEqual([
    ['baidu', '百度热搜'], ['cls-hot', '财联社热门'], ['tencent-hot', '腾讯新闻综合早报'],
    ['toutiao', '今日头条'], ['zhihu', '知乎'],
  ])
  expect(body.sources.map(source => source.order)).toEqual(Array.from({ length: 27 }, (_, index) => index + 1))
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(fetch).not.toHaveBeenCalled()
})

test('新闻单源接口按官方 UA 只读访问并规范化榜单，不转发来访凭据', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    expect(input.href).toBe('https://newsnow.busiyi.world/api/s?id=baidu')
    const headers = new Headers(init.headers)
    expect(headers.get('User-Agent')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
    expect(headers.has('Cookie')).toBe(false); expect(headers.has('Authorization')).toBe(false)
    expect(init.redirect).toBe('manual')
    return Response.json({ id: 'baidu', status: 'cache', updatedTime: 1791270000000,
      items: [{ id: 42, title: ' 一条热点 ', url: 'https://example.com/news?a=1&amp;b=2', extra: { hover: '不公开字段' } }], info: { token: 'private-detail' } })
  })
  vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/news/source?id=baidu&latest=true&url=https://other.example', {
    headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-detail' },
  }, { NEWS_READ_LIMITER: { limit: async () => ({ success: true }) } })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    sourceId: 'baidu', fetchedAt: '2026-10-06T08:00:00.000Z', sourceUpdatedAt: '2026-10-06T07:00:00.000Z',
    upstreamStatus: 'cache', cacheHit: false, stale: false, warning: null,
    items: [{ id: '42', title: '一条热点', url: 'https://example.com/news?a=1&b=2', rank: 1 }],
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

function edgeCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>()
  vi.stubGlobal('caches', { open: async () => ({
    match: async (request: Request) => {
      const entry = entries.get(request.url)
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined
    },
    put: async (request: Request, response: Response) => {
      const seconds = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1])
      entries.set(request.url, { response: response.clone(), expiresAt: Date.now() + seconds * 1000 })
    },
  }) })
  return entries
}

test('新闻新鲜缓存复用五分钟并保留原时间，内部快照保留一天且额外参数不能绕过', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
  const entries = edgeCache()
  const fetch = vi.fn(async () => Response.json({ id: 'baidu', status: 'success', updatedTime: 1791270000000, items: [{ title: '热点', url: 'https://example.com/story' }] }))
  const limit = vi.fn(async () => ({ success: true }))
  vi.stubGlobal('fetch', fetch)
  const env = { NEWS_READ_LIMITER: { limit } }
  const first = newsResultSchema.parse(await (await app.request('/api/news/source?id=baidu', {}, env)).json())
  vi.setSystemTime(new Date('2026-10-06T08:04:59Z'))
  const cached = await app.request('/api/news/source?id=baidu&refresh=force&nonce=other', {}, env)
  expect(await cached.json()).toEqual({ ...first, cacheHit: true })
  expect(cached.headers.get('Cache-Control')).toBe('no-store')
  expect(fetch).toHaveBeenCalledTimes(1); expect(limit).toHaveBeenCalledTimes(1)
  expect(entries.size).toBe(1)
  expect([...entries.values()][0].response.headers.get('Cache-Control')).toBe('public, max-age=86400')
  vi.setSystemTime(new Date('2026-10-06T08:05:00Z'))
  const renewed = await (await app.request('/api/news/source?id=baidu', {}, env)).json()
  expect(renewed).toMatchObject({ fetchedAt: '2026-10-06T08:05:00.000Z', cacheHit: false, stale: false, warning: null })
  expect(fetch).toHaveBeenCalledTimes(2); expect(limit).toHaveBeenCalledTimes(2)
})

test('新闻源返回非 JSON 时报告内容错误而非连接错误，并脱敏原始内容', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>private-detail</html>'))
  const response = await app.request('/api/news/source?id=baidu', {}, { NEWS_READ_LIMITER: { limit: async () => ({ success: true }) } })
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ error: { code: 'SOURCE_INVALID_RESPONSE', message: '数据源返回了无效内容' } })
})
