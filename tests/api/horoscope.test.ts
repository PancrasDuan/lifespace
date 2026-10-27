import { afterEach, expect, test, vi } from 'vitest'
import app from './authenticated-app'
import { alapiSuccess } from '../fixtures/horoscope'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('正式接口首次点击读取当日内容并按北京零点缓存，后续同日访问命中', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  const entries = new Map<string, string>()
  const get = vi.fn(async (key: string) => entries.get(key) ?? null)
  const put = vi.fn(async (key: string, value: string) => { entries.set(key, value) })
  const fetch = vi.fn(async () => Response.json(alapiSuccess()))
  vi.stubGlobal('fetch', fetch)
  const env = { ALAPI_TOKEN: 'test-horoscope-credential', HOROSCOPE_KV: { get, put } as unknown as KVNamespace }
  const first = await app.request('/api/horoscope?sign=libra', {}, env)
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ sign: 'libra', dataDate: '2026-10-22', validUntil: '2026-10-22T16:00:00.000Z', scores: { all: 85 }, texts: { all: '稳住节奏，踏实推进。' }, cacheHit: false })
  expect(put).toHaveBeenCalledWith('horoscope:v1:alapi:Asia-Shanghai:2026-10-22:libra', expect.not.stringContaining('test-horoscope-credential'), { expiration: 1792684800 })
  const second = await app.request('/api/horoscope?sign=libra', {}, env)
  expect(await second.json()).toMatchObject({ cacheHit: true, sign: 'libra' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(second.headers.get('Cache-Control')).toBe('no-store')
})

function setup(date = '2026-10-22T08:00:00Z') {
  vi.useFakeTimers(); vi.setSystemTime(new Date(date))
  const entries = new Map<string, string>()
  const get = vi.fn(async (key: string) => entries.get(key) ?? null)
  const put = vi.fn(async (key: string, value: string) => { entries.set(key, value) })
  const fetch = vi.fn(async () => Response.json(alapiSuccess()))
  vi.stubGlobal('fetch', fetch)
  const env = { ALAPI_TOKEN: 'test-horoscope-credential', HOROSCOPE_KV: { get, put } as unknown as KVNamespace }
  return { entries, get, put, fetch, env }
}

test('有效当日缓存允许匿名读取，不访问 Auth、ALAPI 或写入 KV', async () => {
  const { default: raw } = await import('../../worker/index')
  const s = setup()
  expect((await app.request('/api/horoscope?sign=libra', {}, s.env)).status).toBe(200)
  s.fetch.mockClear(); s.put.mockClear()
  const response = await raw.request('/api/horoscope?sign=libra', {}, { HOROSCOPE_KV: s.env.HOROSCOPE_KV })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ sign: 'libra', cacheHit: true, dataDate: '2026-10-22' })
  expect(response.headers.get('Server-Timing')).not.toContain('auth;')
  expect(s.fetch).not.toHaveBeenCalled()
  expect(s.put).not.toHaveBeenCalled()
})

test('未命中缓存时未登录或非白名单不访问 ALAPI、不写 KV', async () => {
  const { default: raw } = await import('../../worker/index')
  const s = setup()
  expect((await raw.request('/api/horoscope?sign=libra', {}, s.env)).status).toBe(401)
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '')
  const jwt = `${encode({ alg: 'HS256' })}.${encode({ sub: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 })}.test-signature`
  s.fetch.mockImplementation(async () => Response.json({ id: '00000000-0000-4000-8000-000000000001', email: 'other@example.com', email_confirmed_at: '2026-10-22', is_anonymous: false }))
  expect((await raw.request('/api/horoscope?sign=libra', { headers: { Authorization: `Bearer ${jwt}` } }, { ...s.env, SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: 'demo@example.com' })).status).toBe(403)
  expect(s.get).toHaveBeenCalledTimes(2); expect(s.put).not.toHaveBeenCalled()
  expect(s.fetch).toHaveBeenCalledTimes(1)
})

test('失效凭据不影响公共缓存读取，其他业务接口仍要求登录', async () => {
  const { default: raw } = await import('../../worker/index')
  const s = setup()
  await app.request('/api/horoscope?sign=libra', {}, s.env)
  s.fetch.mockClear(); s.put.mockClear()
  const hit = await raw.request('/api/horoscope?sign=libra', { headers: { Authorization: 'Bearer invalid' } }, s.env)
  expect(hit.status).toBe(200)
  expect(await hit.json()).toMatchObject({ cacheHit: true })
  for (const path of ['/api/auth/me', '/api/tasks/today', '/api/domains', '/api/news/source?id=baidu', '/api/weather/detail']) {
    expect((await raw.request(path, {}, s.env)).status).toBe(401)
  }
  expect(s.fetch).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled()
})

test('匿名请求不能读取损坏、过期、异星座缓存，也不能在 KV 故障时回源', async () => {
  const { default: raw } = await import('../../worker/index')
  const seed = setup()
  await app.request('/api/horoscope?sign=libra', {}, seed.env)
  const original = JSON.parse([...seed.entries.values()][0])
  for (const value of ['bad-json', JSON.stringify({}), JSON.stringify({ ...original, sign: 'leo' }), JSON.stringify({ ...original, validUntil: '2026-10-21T16:00:00.000Z' })]) {
    const s = setup()
    s.get.mockResolvedValue(value)
    expect((await raw.request('/api/horoscope?sign=libra', {}, s.env)).status).toBe(401)
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled()
  }
  const s = setup()
  s.get.mockRejectedValue(new Error('private'))
  expect((await raw.request('/api/horoscope?sign=libra', {}, s.env)).status).toBe(503)
  expect(s.fetch).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled()
})

test('未登录请求不能加入正在回源的读取，也不阻碍获准请求填充缓存', async () => {
  const { default: raw } = await import('../../worker/index')
  const { horoscopeTestToken, horoscopeTestUser } = await import('../fixtures/horoscope-worker')
  const s = setup()
  let upstreamCalls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (String(input).includes('/auth/v1/user')) return Response.json(horoscopeTestUser)
    upstreamCalls++; await gate
    return Response.json(alapiSuccess())
  })
  const env = { ...s.env, SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: horoscopeTestUser.email }
  const first = raw.request('/api/horoscope?sign=libra', { headers: { Authorization: `Bearer ${horoscopeTestToken}` } }, env)
  await vi.waitFor(() => expect(upstreamCalls).toBe(1))
  expect((await raw.request('/api/horoscope?sign=libra', {}, env)).status).toBe(401)
  expect(s.put).not.toHaveBeenCalled()
  release()
  expect((await first).status).toBe(200)
  const cached = await raw.request('/api/horoscope?sign=libra', {}, env)
  expect(cached.status).toBe(200)
  expect(await cached.json()).toMatchObject({ cacheHit: true })
  expect(upstreamCalls).toBe(1)
})

test('仅接受固定星座与唯一 sign 参数，缺配置时明确失败', async () => {
  const s = setup()
  for (const query of ['', '?sign=unknown', '?sign=libra&url=https://example.com', '?sign=libra&force=1', '?sign=libra&sign=leo']) {
    expect((await app.request('/api/horoscope' + query, {}, s.env)).status).toBe(400)
  }
  for (const env of [{}, { ALAPI_TOKEN: 'test-only' }, { HOROSCOPE_KV: s.env.HOROSCOPE_KV }]) {
    const response = await app.request('/api/horoscope?sign=libra', {}, env)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'HOROSCOPE_NOT_CONFIGURED' } })
  }
  expect(s.get).toHaveBeenCalledTimes(1); expect(s.fetch).not.toHaveBeenCalled()
})

test.each([
  ['23:50', '2026-10-22T15:50:00Z', 1],
  ['23:59:00', '2026-10-22T15:59:00Z', 1],
  ['23:59:40', '2026-10-22T15:59:40Z', 0],
])('%s 时不延长当天有效期', async (_label, time, writes) => {
  const s = setup(time)
  const result = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ validUntil: '2026-10-22T16:00:00.000Z' })
  expect(s.put).toHaveBeenCalledTimes(writes)
})

test('零点使用新日期键，上游未更新不展示昨日，也不写成功缓存', async () => {
  const s = setup('2026-10-22T16:00:00Z')
  const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: { code: 'HOROSCOPE_NOT_UPDATED', message: '今日运势暂未更新' } })
  expect(s.get).toHaveBeenCalledWith('horoscope:v1:alapi:Asia-Shanghai:2026-10-23:libra')
  expect(s.put).not.toHaveBeenCalled()
})

test.each(['upstream', 'write', 'read'])('%s 等待跨日后不返回旧日成功内容', async boundary => {
  const s = setup('2026-10-22T15:50:00Z')
  const cross = () => vi.setSystemTime(new Date('2026-10-22T16:00:00Z'))
  if (boundary === 'upstream') s.fetch.mockImplementation(async () => { cross(); return Response.json(alapiSuccess()) })
  if (boundary === 'write') s.put.mockImplementation(async () => { cross() })
  if (boundary === 'read') s.get.mockImplementation(async () => { cross(); return null })
  const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ error: { code: 'HOROSCOPE_NOT_UPDATED' } })
  if (boundary !== 'write') expect(s.put).not.toHaveBeenCalled()
})

test.each([
  ['非 JSON', () => new Response('<secret>'), 'HOROSCOPE_INVALID_RESPONSE', 502],
  ['HTTP 拒绝', () => new Response('private', { status: 401 }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['HTTP 限流', () => new Response('private', { status: 429 }), 'HOROSCOPE_RATE_LIMITED', 429],
  ['每日耗尽', () => Response.json({ success: false, code: 10010, message: 'private' }), 'HOROSCOPE_QUOTA_EXHAUSTED', 503],
  ['业务鉴权', () => Response.json({ success: false, code: 10001, message: 'private' }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['业务错误 10002', () => Response.json({ success: false, code: 10002, message: 'private' }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['业务错误 10004', () => Response.json({ success: false, code: 10004, message: 'private' }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['业务错误 10008', () => Response.json({ success: false, code: 10008, message: 'private' }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['业务错误 10009', () => Response.json({ success: false, code: 10009, message: 'private' }), 'HOROSCOPE_TOKEN_INVALID', 502],
  ['业务错误 10006', () => Response.json({ success: false, code: 10006, message: 'private' }), 'HOROSCOPE_ACCESS_DENIED', 502],
  ['业务错误 10007', () => Response.json({ success: false, code: 10007, message: 'private' }), 'HOROSCOPE_ACCESS_DENIED', 502],
  ['业务错误 10005', () => Response.json({ success: false, code: 10005, message: 'private' }), 'HOROSCOPE_QUOTA_UNAVAILABLE', 503],
  ['HTTP 200 业务失败', () => Response.json({ success: false, code: 12345, message: 'private' }), 'HOROSCOPE_BUSINESS_ERROR', 502],
  ['超时', () => { throw new DOMException('private', 'TimeoutError') }, 'HOROSCOPE_TIMEOUT', 504],
  ['空内容', () => Response.json({ success: true, code: 200, data: { day: { date: '2026-10-22' } } }), 'HOROSCOPE_INVALID_RESPONSE', 502],
  ['越界分数', () => Response.json({ ...alapiSuccess(), data: { day: { ...alapiSuccess().data.day, all: '150%' } } }), 'HOROSCOPE_INVALID_RESPONSE', 502],
  ['未来日期', () => Response.json(alapiSuccess('2026-10-23')), 'HOROSCOPE_INVALID_RESPONSE', 502],
  ['错误星座', () => Response.json({ ...alapiSuccess(), data: { star: 'leo', day: alapiSuccess().data.day } }), 'HOROSCOPE_INVALID_RESPONSE', 502],
] as const)('%s 有明确脱敏错误，失败不写缓存且退避期间不重复回源', async (_label, handler, code, status) => {
  const s = setup(); s.fetch.mockImplementation(async () => handler())
  for (let i = 0; i < 2; i++) {
    const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: { code } })
  }
  expect(s.fetch).toHaveBeenCalledTimes(1)
  expect(s.put).not.toHaveBeenCalled()
})

test('每日耗尽不按秒重试，次日解除退避', async () => {
  const s = setup()
  s.fetch.mockImplementation(async () => Response.json({ success: false, code: 10010 }))
  await app.request('/api/horoscope?sign=libra', {}, s.env)
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
  await app.request('/api/horoscope?sign=leo', {}, s.env)
  expect(s.fetch).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date('2026-10-22T16:00:00Z'))
  s.fetch.mockImplementation(async () => Response.json(alapiSuccess('2026-10-23')))
  expect((await app.request('/api/horoscope?sign=libra', {}, s.env)).status).toBe(200)
  expect(s.fetch).toHaveBeenCalledTimes(2)
})

test('KV 读故障关闭回源，写失败仍返回本次合法内容并限制再次回源', async () => {
  const read = setup()
  read.get.mockRejectedValue(new Error('private'))
  expect((await app.request('/api/horoscope?sign=libra', {}, read.env)).status).toBe(503)
  expect(read.fetch).not.toHaveBeenCalled()
  const write = setup()
  write.put.mockRejectedValue(new Error('private'))
  const first = await app.request('/api/horoscope?sign=libra', {}, write.env)
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ warning: '本次运势已获取，缓存暂存失败' })
  const next = await app.request('/api/horoscope?sign=libra', {}, write.env)
  expect(next.status).toBe(503)
  expect(write.fetch).toHaveBeenCalledTimes(1)
})

test('不完整合法内容保留 null，纯文本不改写；请求只传星座与服务端 token', async () => {
  const s = setup()
  s.fetch.mockImplementation(async () => Response.json({ success: true, code: 200, data: { day: { date: '2026-10-22', love: '0%', all_text: '<script>alert(1)</script>' } } }))
  const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(await response.json()).toMatchObject({ scores: { all: null, love: 0 }, texts: { all: '<script>alert(1)</script>', health: null }, lucky: { color: null, number: null } })
  expect(s.fetch).toHaveBeenCalledWith('https://v3.alapi.cn/api/star', expect.objectContaining({ method: 'POST', headers: { token: 'test-horoscope-credential', 'Content-Type': 'application/json' }, body: '{"star":"libra"}', redirect: 'manual' }))
})

test('真实 ALAPI 数字幸运数字转换后仍为本站字符串契约', async () => {
  const s = setup()
  s.fetch.mockImplementation(async () => Response.json({ ...alapiSuccess(), data: { day: { ...alapiSuccess().data.day, lucky_number: 16 } } }))
  const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ lucky: { number: '16' } })
})

test('损坏结构、星座、日期、截止与未来获取时间的缓存不能成为命中', async () => {
  const seed = setup()
  await app.request('/api/horoscope?sign=libra', {}, seed.env)
  const original = JSON.parse([...seed.entries.values()][0])
  for (const stored of ['bad-json', JSON.stringify({}), ...[
    { sign: 'leo' }, { dataDate: '2026-10-21' }, { validUntil: '2026-10-22T15:00:00.000Z' },
    { validUntil: '2026-10-23T16:00:00.000Z' }, { fetchedAt: '2026-10-22T09:00:00.000Z' },
  ].map(patch => JSON.stringify({ ...original, ...patch }))]) {
    const s = setup()
    s.get.mockResolvedValue(stored)
    const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
    expect(await response.json()).toMatchObject({ cacheHit: false, dataDate: '2026-10-22' })
    expect(s.fetch).toHaveBeenCalledTimes(1)
  }
})

test('同实例在途读取合并，跨实例负缓存允许少量重复且同 key 写冲突不破坏合法响应', async () => {
  const { default: raw } = await import('../../worker/index')
  const { horoscopeTestToken, horoscopeTestUser } = await import('../fixtures/horoscope-worker')
  const s = setup()
  let upstreamCalls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (String(input).includes('/auth/v1/user')) return Response.json(horoscopeTestUser)
    upstreamCalls++
    await gate
    return Response.json(alapiSuccess())
  })
  const auth = { SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: 'demo@example.com' }
  const request = (kv: KVNamespace) => raw.request('/api/horoscope?sign=libra', { headers: { Authorization: `Bearer ${horoscopeTestToken}` } }, { ...s.env, ...auth, HOROSCOPE_KV: kv })
  const first = request(s.env.HOROSCOPE_KV)
  const second = request(s.env.HOROSCOPE_KV)
  // 让两个 HTTP 请求进入鉴权后的等待，不依赖内部调用顺序。
  await vi.waitFor(() => expect(upstreamCalls).toBe(1))
  release()
  expect((await first).status).toBe(200)
  await vi.advanceTimersByTimeAsync(1100)
  expect((await second).status).toBe(200)
  expect(upstreamCalls).toBe(1)
  let writes = 0
  const namespace = () => ({ get: async () => null, put: async () => { if (++writes > 1) throw new Error('same key conflict') } }) as unknown as KVNamespace
  const other = await Promise.all([request(namespace()), request(namespace())])
  expect(other.map(response => response.status)).toEqual([200, 200])
  expect(upstreamCalls).toBe(3)
})

test('首请求尚未完成时，合并等待有界退出，不借用其 I/O Promise', async () => {
  const { default: raw } = await import('../../worker/index')
  const { horoscopeTestToken, horoscopeTestUser } = await import('../fixtures/horoscope-worker')
  const s = setup()
  let calls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (String(input).includes('/auth/v1/user')) return Response.json(horoscopeTestUser)
    calls++; await gate
    return Response.json(alapiSuccess())
  })
  const env = { ...s.env, SUPABASE_URL: 'https://auth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', AUTH_ALLOWED_EMAILS: horoscopeTestUser.email }
  const request = () => raw.request('/api/horoscope?sign=libra', { headers: { Authorization: `Bearer ${horoscopeTestToken}` } }, env)
  const first = request()
  await vi.waitFor(() => expect(calls).toBe(1))
  const next = request()
  await vi.advanceTimersByTimeAsync(1100)
  const busy = await next
  expect(busy.status).toBe(429)
  expect(await busy.json()).toMatchObject({ error: { code: 'HOROSCOPE_RATE_LIMITED' } })
  expect(calls).toBe(1)
  release()
  expect((await first).status).toBe(200)
})

test('正式接口返回不含凭据的分段耗时，缓存命中不包含 ALAPI 阶段', async () => {
  const s = setup()
  const first = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(first.headers.get('Server-Timing')).toMatch(/auth;dur=[\d.]+/)
  expect(first.headers.get('Server-Timing')).toMatch(/kv_read;dur=[\d.]+/)
  expect(first.headers.get('Server-Timing')).toMatch(/alapi;dur=[\d.]+/)
  expect(first.headers.get('Server-Timing')).toMatch(/alapi_headers;dur=[\d.]+/)
  expect(first.headers.get('Server-Timing')).toMatch(/alapi_body;dur=[\d.]+/)
  expect(first.headers.get('Server-Timing')).toMatch(/kv_write;dur=[\d.]+/)
  const next = await app.request('/api/horoscope?sign=libra', {}, s.env)
  expect(next.headers.get('Server-Timing')).toContain('kv_read;dur=')
  expect(next.headers.get('Server-Timing')).not.toContain('alapi;')
  expect(next.headers.get('Server-Timing')).not.toContain('alapi_headers;')
  expect(next.headers.get('Server-Timing')).not.toContain('alapi_body;')
  expect(next.headers.get('Server-Timing')).not.toContain('test-horoscope-credential')
})

test('ALAPI 响应头等待与延迟正文分别计时', async () => {
  const s = setup()
  let clock = 0
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  try {
    s.fetch.mockImplementation(async () => {
      clock += 700
      return new Response(new ReadableStream({
        pull(controller) {
          clock += 50
          controller.enqueue(new TextEncoder().encode(JSON.stringify(alapiSuccess())))
          controller.close()
        },
      }, { highWaterMark: 0 }))
    })
    const response = await app.request('/api/horoscope?sign=libra', {}, s.env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Server-Timing')).toContain('alapi_headers;dur=700')
    expect(response.headers.get('Server-Timing')).toContain('alapi_body;dur=50')
    expect(response.headers.get('Server-Timing')).toContain('alapi;dur=750')
  } finally { timer.mockRestore() }
})
