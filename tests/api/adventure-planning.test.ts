import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import { queryPlanning } from '../../worker/adventure/data'
import { DatabaseError } from '../../worker/database'
import { goalRewardSchema, planningCommandSchema } from '../../src/shared/adventure-planning'

vi.mock('../../worker/adventure/data', () => ({ queryPlanning: vi.fn() }))
const owner = '00000000-0000-4000-8000-000000000054'
const env = {
  SUPABASE_URL: 'https://planning-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only',
  AUTH_ALLOWED_EMAILS: 'planning@example.com',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.test-signature`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const request = (command: unknown, extra = {}) =>
  app.request(
    '/api/adventure/commands',
    { method: 'POST', headers, body: JSON.stringify({ requestId: 'planning-test-001', expectedVersion: 0, command, ...extra }) },
    env
  )
beforeEach(() => {
  vi.mocked(queryPlanning)
    .mockReset()
    .mockResolvedValue({ version: 1, result: { entityId: owner, message: '已创建' } })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname !== '/auth/v1/user') throw new Error('业务数据库禁止 HTTP 访问')
    return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
  })
})
afterEach(() => vi.unstubAllGlobals())
it('命令使用在线身份的 owner，返回稳定回执', async () => {
  const command = { type: 'createMainline', name: '健康' }
  const response = await request(command)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ version: 1, result: { entityId: owner, message: '已创建' } })
  expect(queryPlanning).toHaveBeenCalledWith(expect.anything(), owner, 'adventure_planning_command', {
    p_request_id: 'planning-test-001',
    p_expected_version: 0,
    p_command: command,
  })
})
it('目标标准过滤空白，归属可以留空', async () => {
  const response = await request({ type: 'createGoal', destination: '', title: '阅读', standards: ['读完一本', ' ', '写下笔记'] })
  expect(response.status).toBe(200)
  expect(queryPlanning).toHaveBeenCalledWith(
    expect.anything(),
    owner,
    'adventure_planning_command',
    expect.objectContaining({ p_command: { type: 'createGoal', destination: '', title: '阅读', standards: ['读完一本', '写下笔记'] } })
  )
})
it('拒绝客户端身份、时间、经验、额外字段和无效内容', async () => {
  const command = { type: 'createMainline', name: '健康' }
  for (const extra of [{ owner }, { today: '2030-01-01' }, { state: {} }]) expect((await request(command, extra)).status).toBe(400)
  for (const invalid of [
    { ...command, xp: 500 },
    { type: 'refresh' },
    { ...command, name: ' ' },
    { ...command, name: '字'.repeat(201) },
    { type: 'createGoal', destination: '', title: '目标', standards: [] },
    { type: 'createGoal', destination: '', title: '目标', standards: Array(51).fill('标准') },
    { type: 'createTask', title: '行动', description: '', plannedOn: '2026-02-30', destination: '' },
    { type: 'completeTask', id: owner, xp: 1 },
  ])
    expect((await request(invalid)).status).toBe(400)
  expect(queryPlanning).not.toHaveBeenCalled()
})
it('预览传递版本且没有成功请求号', async () => {
  vi.mocked(queryPlanning).mockResolvedValue({
    version: 0,
    today: '2026-10-20',
    allowed: true,
    requiresConfirmation: false,
    message: '保存后更新规划',
  })
  const command = { type: 'createMainline', name: '健康' }
  const response = await app.request(
    '/api/adventure/preview',
    { method: 'POST', headers, body: JSON.stringify({ expectedVersion: 0, command }) },
    env
  )
  expect(response.status).toBe(200)
  expect(queryPlanning).toHaveBeenCalledWith(expect.anything(), owner, 'adventure_planning_preview', {
    p_expected_version: 0,
    p_command: command,
  })
})
it('固定业务错误映射稳定，驱动内部详情保持私有', async () => {
  for (const [code, status] of [
    ['VERSION_CONFLICT', 409],
    ['REQUEST_ID_REUSED', 409],
    ['NOT_FOUND', 404],
    ['MAINLINE_LIMIT', 400],
    ['private database context', 503],
  ] as const) {
    vi.mocked(queryPlanning).mockRejectedValue(new DatabaseError(code))
    const response = await app.request('/api/adventure', { headers }, env)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toMatch(/private|postgres:|details|hint/)
  }
})
it('分页、请求体和内容类型在进入事务前校验', async () => {
  for (const query of [
    'page=0',
    'pageSize=51',
    'page=1.5',
    'owner=x',
    'taskRange=all',
    'taskPage=0',
    'goalId=x',
    'goalTaskPage=0',
    'taskScope=x',
    'search=' + '字'.repeat(101),
  ])
    expect((await app.request(`/api/adventure?${query}`, { headers }, env)).status).toBe(400)
  expect((await app.request('/api/adventure', {}, env)).status).toBe(401)
  expect((await app.request('/api/adventure/commands', { method: 'POST', headers, body: 'x'.repeat(33000) }, env)).status).toBe(400)
  expect(
    (
      await app.request(
        '/api/adventure/commands',
        { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' },
        env
      )
    ).status
  ).toBe(400)
  expect(queryPlanning).not.toHaveBeenCalled()
})
it('历史冻结奖励契约接受大于当前固定奖励的金额', () => {
  expect(
    goalRewardSchema.parse({ amount: 1, calculation: { type: 'goal_actions', actionIds: [], count: 0, coefficient: 3, fallback: true } })
      .amount
  ).toBe(1)
  expect(
    goalRewardSchema.safeParse({
      amount: 2,
      calculation: { type: 'goal_actions', actionIds: [owner, owner], count: 2, coefficient: 1, fallback: false },
    }).success
  ).toBe(false)
  expect(planningCommandSchema.parse({ type: 'achieveGoal', id: owner })).toEqual({
    type: 'achieveGoal',
    id: owner,
    coefficient: 1,
    reflection: '',
  })
  for (const extra of [
    { coefficient: 0 },
    { coefficient: 4 },
    { coefficient: 1.5 },
    { reflection: '字'.repeat(4001) },
    { amount: 100 },
    { actionIds: [owner] },
    { today: '2030-01-01' },
  ])
    expect(planningCommandSchema.safeParse({ type: 'achieveGoal', id: owner, ...extra }).success).toBe(false)
})
