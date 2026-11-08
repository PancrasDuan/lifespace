import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryPlanning } from '../../worker/adventure/data'
vi.mock('../../worker/adventure/data', () => ({ queryPlanning: vi.fn() }))
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

  it('正式 Worker 使用各请求的 owner，保留原封套并禁止业务 HTTP', async () => {
    const nativeFetch = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', nativeFetch)
    vi.mocked(queryPlanning).mockReset().mockRejectedValue(new Error('database unavailable'))
    const runtime = await createDatabase()
    runtime.install()
    const owners = [crypto.randomUUID(), crypto.randomUUID()]
    const value = runtime.envelope(7, { type: 'createMainline', name: '原封套' })
    for (const owner of owners) expect((await runtime.send(owner, value)).status).toBe(503)
    for (const owner of owners) expect(queryPlanning).toHaveBeenCalledWith(expect.anything(), owner, 'adventure_planning_command', { p_request_id: value.requestId, p_expected_version: 7, p_command: value.command })
    expect(nativeFetch).not.toHaveBeenCalled()
    await expect(fetch('https://example.invalid')).rejects.toThrow('禁止非验收请求')
    await expect(fetch('https://planning-local-test.supabase.co/rest/v1/adventure_tasks')).rejects.toThrow('业务数据库禁止通过 HTTP 访问')
    runtime.restore()
    expect(globalThis.fetch).toBe(nativeFetch)
  })

  it('浏览器固定 owner，放行无关请求并恢复 fetch', async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 503 }))
    vi.stubGlobal('fetch', nativeFetch)
    vi.mocked(queryPlanning).mockReset().mockRejectedValue(new Error('database unavailable'))
    const runtime = await createDatabase(), owner = crypto.randomUUID()
    runtime.install({ browserOwner: owner })
    expect((await runtime.request(crypto.randomUUID())).status).toBe(401)
    expect(queryPlanning).not.toHaveBeenCalled()
    expect((await runtime.request(owner)).status).toBe(503)
    expect(queryPlanning).toHaveBeenCalledWith(expect.anything(), owner, 'adventure_workspace_read', expect.anything())
    expect(await fetch('http://127.0.0.1:43211/health')).toHaveProperty('status', 503)
    await expect(fetch('https://planning-local-test.supabase.co/rest/v1/rpc/ledger_list')).rejects.toThrow('业务数据库禁止通过 HTTP 访问')
    expect(() => runtime.install({ browserOwner: owner })).toThrow('隔离运行环境已安装')
    runtime.restore()
    expect(globalThis.fetch).toBe(nativeFetch)
  })
})
