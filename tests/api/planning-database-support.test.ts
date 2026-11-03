import { afterEach, describe, expect, it, vi } from 'vitest'
import type { planningDatabase } from '../support/planning-database'

let database: ReturnType<typeof planningDatabase> | undefined
const createDatabase = async (target = 'http://127.0.0.1:43210') => {
  vi.stubEnv('ADVENTURE_LOCAL_RPC_URL', target)
  vi.resetModules()
  database = (await import('../support/planning-database')).planningDatabase()
  return database
}
afterEach(() => {
  database?.restore()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('真实数据库测试支持的隔离与转发约定', () => {
  it.each(['https://127.0.0.1:43210', 'http://localhost:43210', 'http://example.invalid', 'http://user:pass@127.0.0.1:43210'])('拒绝不符合本机隔离约定的目标 %s', async target => {
    const original = globalThis.fetch
    const runtime = await createDatabase(target)
    expect(() => runtime.install()).toThrow('仅允许独立本机 RPC 验收')
    expect(globalThis.fetch).toBe(original)
  })

  it('正式 Worker 使用各请求的 owner，原封套和 HTTP 失败保持原样', async () => {
    // An upstream error exercises transport without pretending to implement business transactions.
    const nativeFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { status: 503 }))
    vi.stubGlobal('fetch', nativeFetch)
    const runtime = await createDatabase()
    runtime.install()
    const owners = [crypto.randomUUID(), crypto.randomUUID()]
    const value = runtime.envelope(7, { type: 'createMainline', name: '原封套' })
    for (const owner of owners) expect((await runtime.send(owner, value)).status).toBe(503)
    expect(nativeFetch).toHaveBeenCalledTimes(2)
    for (const [index, [input, init]] of nativeFetch.mock.calls.entries()) {
      expect(String(input)).toBe('http://127.0.0.1:43210/rpc/adventure_planning_command')
      expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owners[index], p_request_id: value.requestId, p_expected_version: 7, p_command: value.command })
      expect(new Headers(init?.headers).get('apikey')).toBe('sb_secret_local-test-only')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.redirect).toBe('manual')
    }
    await expect(fetch('https://example.invalid')).rejects.toThrow('禁止非验收请求')
    await expect(fetch('https://planning-local-test.supabase.co/rest/v1/adventure_tasks')).rejects.toThrow('禁止非 RPC 请求')
    runtime.restore()
    expect(globalThis.fetch).toBe(nativeFetch)
    runtime.install()
    runtime.restore()
    expect(globalThis.fetch).toBe(nativeFetch)
  })

  it('浏览器固定安装时 owner，放行无关请求，并恢复安装前的 fetch', async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { status: 503 }))
    vi.stubGlobal('fetch', nativeFetch)
    const runtime = await createDatabase()
    const owner = crypto.randomUUID()
    runtime.install({ browserOwner: owner })
    expect((await runtime.request(crypto.randomUUID())).status).toBe(401)
    expect(nativeFetch).not.toHaveBeenCalled()
    expect((await runtime.request(owner)).status).toBe(503)
    expect(JSON.parse(String(nativeFetch.mock.calls[0][1]?.body)).p_owner).toBe(owner)
    expect(await fetch('http://127.0.0.1:43211/health')).toHaveProperty('status', 503)
    expect(nativeFetch.mock.calls[1][0]).toBe('http://127.0.0.1:43211/health')
    await expect(fetch('https://planning-local-test.supabase.co/rest/v1/rpc/ledger_list')).rejects.toThrow('禁止非 RPC 请求')
    expect(() => runtime.install({ browserOwner: owner })).toThrow('隔离运行环境已安装')
    runtime.restore()
    expect(globalThis.fetch).toBe(nativeFetch)
  })
})
