import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000054'
const env = {
  SUPABASE_URL: 'https://planning-test.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only',
  AUTH_ALLOWED_EMAILS: 'planning@example.com',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.test-signature`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

afterEach(() => vi.unstubAllGlobals())

it('页面查询通过账户隔离 RPC 返回空规划，不调用旧单表或触发结算', async () => {
  const calls: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
    return Response.json({
      version: 0, today: '2026-10-20', mainlines: [], goals: [], destinations: [],
      page: 1, pageSize: 20, totalGoals: 0,
      growth: { level: 1, totalXp: 0, progress: 0, needed: 20, remaining: 20, actions: 0, achievedGoals: 0 },
      capabilities: { createMainline: { allowed: true }, createGoal: { allowed: true }, createTask: { allowed: false, reason: '此操作尚未交付' } },
      limits: { name: 200, standard: 4000, standards: 50 },
    })
  })
  const response = await app.request('/api/adventure', { headers }, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ version: 0, goals: [], growth: { level: 1, totalXp: 0 } })
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_planning_read', body: { p_owner: owner, p_page: 1, p_page_size: 20 } }])
})

it('命令只返回稳定回执；分页页面通过下一次查询读取', async () => {
  const calls: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
    return Response.json({ version: 1, result: { entityId: owner, message: '已创建' } })
  })
  const response = await app.request('/api/adventure/commands', {
    method: 'POST', headers,
    body: JSON.stringify({ requestId: 'planning-create-1', expectedVersion: 0, command: { type: 'createMainline', name: '健康' } }),
  }, env)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ version: 1, result: { entityId: owner, message: '已创建' } })
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_planning_command', body: {
    p_owner: owner, p_request_id: 'planning-create-1', p_expected_version: 0,
    p_command: { type: 'createMainline', name: '健康' },
  } }])
})

it('严格拒绝客户端身份、日期、经验、额外字段和本票未交付命令', async () => {
  const upstream = vi.fn(async () => Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false }))
  vi.stubGlobal('fetch', upstream)
  const base = { requestId: 'invalid-create-1', expectedVersion: 0, command: { type: 'createMainline', name: '健康' } }
  for (const payload of [
    { ...base, owner }, { ...base, today: '2030-01-01' }, { ...base, state: {} },
    { ...base, command: { ...base.command, xp: 500 } },
    { ...base, command: { type: 'refresh' } },
    { ...base, command: { type: 'createGoal', title: '目标', standards: ['标准'] } },
    { ...base, command: { type: 'createMainline', name: '   ' } },
    { ...base, command: { type: 'createMainline', name: '字'.repeat(201) } },
    { ...base, command: { type: 'createGoal', destination: '', title: '目标', standards: ['字'.repeat(4001)] } },
  ]) {
    expect((await app.request('/api/adventure/commands', { method: 'POST', headers, body: JSON.stringify(payload) }, env)).status).toBe(400)
  }
  expect(upstream.mock.calls).toHaveLength(9)
})

it('创建目标允许归属留空并过滤空白标准；空标准与超过 50 项被拒绝', async () => {
  const calls: { body: Record<string, any> }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user')
      return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ body: JSON.parse(String(init.body)) })
    return Response.json({ version: 1, result: { entityId: owner, message: '已创建' } })
  })
  const command = { type: 'createGoal', destination: '', title: '阅读', standards: ['读完一本', ' ', '写下笔记'] }
  const envelope = { requestId: 'goal-default-1', expectedVersion: 0, command }
  expect((await app.request('/api/adventure/commands', { method: 'POST', headers, body: JSON.stringify(envelope) }, env)).status).toBe(200)
  expect(calls[0].body.p_command).toEqual({ ...command, standards: ['读完一本', '写下笔记'] })
  for (const standards of [[], [' ', '\n'], Array.from({ length: 51 }, () => '标准')]) {
    const invalid = { ...envelope, requestId: 'goal-invalid-1', command: { ...command, standards } }
    expect((await app.request('/api/adventure/commands', { method: 'POST', headers, body: JSON.stringify(invalid) }, env)).status).toBe(400)
  }
})

it('预览使用独立 RPC，传递版本但不创建成功请求回执', async () => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
    return Response.json({ version: 0, today: '2026-10-20', allowed: true, requiresConfirmation: false, message: '保存后更新规划' })
  })
  expect((await app.request('/api/adventure/preview', {
    method: 'POST', headers, body: JSON.stringify({ expectedVersion: 0, command: { type: 'createMainline', name: '健康' } }),
  }, env)).status).toBe(200)
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_planning_preview', body: { p_owner: owner, p_expected_version: 0, p_command: { type: 'createMainline', name: '健康' } } }])
})

it('数据库业务错误映射为稳定错误，内部详情与密钥不出现在响应中', async () => {
  let message = 'VERSION_CONFLICT'
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user')
      return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    return Response.json({ message, details: 'private database context', hint: env.SUPABASE_SECRET_KEY }, { status: 400 })
  })
  for (const [code, status] of [['VERSION_CONFLICT', 409], ['REQUEST_ID_REUSED', 409], ['NOT_FOUND', 404], ['MAINLINE_LIMIT', 400], ['private exception', 503]] as const) {
    message = code
    const response = await app.request('/api/adventure', { headers }, env)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toMatch(/private|sb_secret|details|hint/)
  }
})

it('限制分页、请求体和内容类型，拒绝未登录请求', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false }))
  for (const query of ['page=0', 'pageSize=51', 'page=1.5', 'owner=x'])
    expect((await app.request(`/api/adventure?${query}`, { headers }, env)).status).toBe(400)
  expect((await app.request('/api/adventure', {}, env)).status).toBe(401)
  expect((await app.request('/api/adventure/commands', { method: 'POST', headers, body: 'x'.repeat(33000) }, env)).status).toBe(400)
  expect((await app.request('/api/adventure/commands', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' }, env)).status).toBe(400)
})
