import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { domainsResultSchema } from '../../src/shared/contracts'

const env = { DNSHE_API_KEY: 'test-key', DNSHE_API_SECRET: 'test-secret', DNSHE_READ_LIMITER: { limit: async () => ({ success: true }) } }
const row = { full_domain: 'onepeace.cc.cd', status: 'active', expires_at: '2027-01-15 00:00:00', never_expires: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('未接入域名来源返回明确状态，不请求上游', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/domains', {}, {})
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ error: { code: 'DOMAINS_NOT_CONFIGURED' } })
  expect(fetch).not.toHaveBeenCalled()
})

test('只读查询全部域名，使用请求头认证并移除账户、DNS 和凭据字段', async () => {
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    expect(input.origin).toBe('https://api005.dnshe.com')
    expect(input.searchParams.get('action')).toBe('list')
    expect(input.searchParams.has('search')).toBe(false)
    expect(input.href).not.toContain('test-secret')
    expect(init.method).toBe('GET'); expect(init.redirect).toBe('manual')
    expect(new Headers(init.headers).get('X-API-Secret')).toBe('test-secret')
    return Response.json({ success: true, subdomains: [
      { ...row, provider_account_id: 'private-account', dns_records: [{ content: 'private-address' }], api_secret: 'test-secret' },
      { ...row, full_domain: 'second.cc.cd' },
    ] })
  })
  vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/domains?search=private&action=delete', {}, env)
  const body = domainsResultSchema.parse(await response.json())
  expect(body.domains).toEqual([
    { name: 'onepeace.cc.cd', status: 'active', expiresOn: '2027-01-15', neverExpires: false },
    { name: 'second.cc.cd', status: 'active', expiresOn: '2027-01-15', neverExpires: false },
  ])
  expect(JSON.stringify(body)).not.toContain('private')
  expect(JSON.stringify(body)).not.toContain('test-secret')
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('分页读取全部域名并去重，不漏掉下一页', async () => {
  vi.stubGlobal('fetch', async (url: URL) => url.searchParams.get('page') === '1'
    ? Response.json({ success: true, subdomains: [{ ...row, full_domain: 'other.onepeace.cc.cd' }], pagination: { has_more: true } })
    : Response.json({ success: true, subdomains: [row, { ...row, full_domain: 'other.onepeace.cc.cd' }], pagination: { has_more: false } }))
  const response = await app.request('/api/domains', {}, env)
  expect(domainsResultSchema.parse(await response.json()).domains.map(domain => domain.name)).toEqual(['other.onepeace.cc.cd', 'onepeace.cc.cd'])
})

test('永久有效与未知到期日期分开处理，不按注册日期猜测', async () => {
  const rows = [
    { ...row, never_expires: '1' },
    { ...row, full_domain: 'unknown.cc.cd', expires_at: undefined, created_at: '2025-10-01 00:00:00' },
    { ...row, full_domain: 'invalid.cc.cd', expires_at: '2026-02-30 00:00:00', status: 'unexpected' },
  ]
  vi.stubGlobal('fetch', async () => Response.json({ success: true, subdomains: rows }))
  const response = await app.request('/api/domains', {}, env)
  expect(domainsResultSchema.parse(await response.json()).domains).toEqual([
    { name: 'onepeace.cc.cd', status: 'active', expiresOn: null, neverExpires: true },
    { name: 'unknown.cc.cd', status: 'active', expiresOn: null, neverExpires: false },
    { name: 'invalid.cc.cd', status: 'unknown', expiresOn: null, neverExpires: false },
  ])
})

test('已配置但账户无域名时返回空列表', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ success: true, subdomains: [] }))
  expect(await (await app.request('/api/domains', {}, env)).json()).toMatchObject({ domains: [] })
})

test('认证失败与非法上游响应被隔离，不泄漏原始错误', async () => {
  for (const source of [
    { status: 401, body: { message: 'test-secret' } },
    { status: 200, body: { success: false, error_code: 'auth_invalid_credentials', message: 'test-secret' } },
    { status: 200, body: { success: true, subdomains: 'test-secret' } },
    { status: 429, body: { error: 'test-secret' } },
  ]) {
    vi.stubGlobal('fetch', async () => Response.json(source.body, { status: source.status }))
    const response = await app.request('/api/domains', {}, env)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('test-secret')
  }
})

test('失控分页停止请求且写入方法不可用', async () => {
  const fetch = vi.fn(async () => Response.json({ success: true, subdomains: [], pagination: { has_more: true } }))
  vi.stubGlobal('fetch', fetch)
  expect((await app.request('/api/domains', {}, env)).status).toBe(502)
  expect(fetch).toHaveBeenCalledTimes(10)
  fetch.mockClear()
  expect((await app.request('/api/domains', { method: 'POST' }, env)).status).toBe(404)
  expect(fetch).not.toHaveBeenCalled()
})

test('缓存未命中且读取频率超限时不请求 DNSHE', async () => {
  const fetch = vi.fn(async () => Response.json({ success: true, subdomains: [row] }))
  vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/domains?refresh=1', {}, {
    ...env, DNSHE_READ_LIMITER: { limit: async () => ({ success: false }) },
  })
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(fetch).not.toHaveBeenCalled()
})

function edgeCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>()
  vi.stubGlobal('caches', { open: async () => ({
    match: async (request: Request) => {
      const entry = entries.get(request.url)
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined
    },
    put: async (request: Request, response: Response) => {
      entries.set(request.url, { response: response.clone(), expiresAt: Date.now() + 300000 })
    },
  }) })
  return entries
}

test('边缘缓存复用五分钟，查询参数不能绕过缓存，凭据轮换隔离旧结果', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T00:00:00Z'))
  const entries = edgeCache()
  const fetch = vi.fn(async () => Response.json({ success: true, subdomains: [row] }))
  const limit = vi.fn(async () => ({ success: true }))
  vi.stubGlobal('fetch', fetch)
  const cachedEnv = { ...env, DNSHE_READ_LIMITER: { limit } }
  const first = await app.request('/api/domains', {}, cachedEnv)
  const firstBody = await first.json()
  expect(first.headers.get('Cache-Control')).toBe('no-store')
  const cached = await app.request('/api/domains?refresh=force', {}, cachedEnv)
  expect(await cached.json()).toEqual(firstBody)
  expect(fetch).toHaveBeenCalledTimes(1); expect(limit).toHaveBeenCalledTimes(1)
  for (const [key, entry] of entries) {
    expect(key).not.toContain('test-key'); expect(key).not.toContain('test-secret')
    expect(await entry.response.clone().text()).not.toContain('test-secret')
    expect(entry.response.headers.get('Cache-Control')).toBe('public, max-age=300')
  }
  vi.setSystemTime(new Date('2026-10-06T00:05:01Z'))
  expect((await app.request('/api/domains', {}, cachedEnv)).status).toBe(200)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect((await app.request('/api/domains', {}, { ...cachedEnv, DNSHE_API_SECRET: 'rotated-secret' })).status).toBe(200)
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('缓存不可用时仍受限流保护，缺少限流配置时停止读取', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('caches', { open: async () => { throw new Error('test-secret') } })
  const limited = await app.request('/api/domains', {}, { ...env, DNSHE_READ_LIMITER: { limit: async () => ({ success: false }) } })
  expect(limited.status).toBe(429)
  expect((await app.request('/api/domains', {}, { DNSHE_API_KEY: 'test-key', DNSHE_API_SECRET: 'test-secret' })).status).toBe(503)
  expect(fetch).not.toHaveBeenCalled()
})

test('重定向、网络异常和限流绑定异常不会泄漏凭据到响应或日志', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const source of [
    async () => new Response('test-secret', { status: 302, headers: { Location: 'https://other.example/' } }),
    async () => { throw new Error('test-secret') },
  ]) {
    const entries = edgeCache()
    vi.stubGlobal('fetch', source)
    const response = await app.request('/api/domains', {}, env)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('test-secret')
    expect(entries.size).toBe(0)
  }
  const failed = await app.request('/api/domains', {}, { ...env, DNSHE_READ_LIMITER: { limit: async () => { throw new Error('test-secret') } } })
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('test-secret')
  expect(JSON.stringify(log.mock.calls)).not.toContain('test-secret')
})

test('分页整体读取超过时间预算时停止，错误不返回部分列表', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T00:00:00Z'))
  const fetch = vi.fn(async () => {
    vi.setSystemTime(new Date('2026-10-06T00:00:13Z'))
    return Response.json({ success: true, subdomains: [row], pagination: { has_more: true } })
  })
  vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/domains', {}, env)
  expect(response.status).toBe(504)
  expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_TIMEOUT' } })
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('真实 DNSHE Registered 状态显示为已注册，不冒充网站可访问状态', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ success: true, subdomains: [{ ...row, status: 'Registered' }] }))
  const response = await app.request('/api/domains', {}, env)
  expect(await response.json()).toMatchObject({ domains: [{ name: 'onepeace.cc.cd', status: 'registered' }] })
})
