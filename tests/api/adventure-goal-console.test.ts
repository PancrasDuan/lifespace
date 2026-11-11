import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json' }
afterEach(() => vi.unstubAllGlobals())

it('目标命令接受可选分类标签并拒绝旧归属', async () => {
  const commands: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    const command = JSON.parse(String(init.body)).p_command
    if ('destination' in command) return Response.json({ message: 'INVALID_COMMAND' }, { status: 400 })
    commands.push(command)
    return Response.json({ version: 1, result: { entityId: owner, message: '已创建' } })
  })
  const post = (command: unknown) => app.request('/api/adventure/commands', { method: 'POST', headers, body: JSON.stringify({ requestId: 'goal-test-001', expectedVersion: 0, command }) }, env)
  expect((await post({ type: 'createGoal', title: '阅读', standards: ['读完'], categoryLabel: '  学习  ' })).status).toBe(200)
  expect(commands).toEqual([{ type: 'createGoal', title: '阅读', standards: ['读完'], categoryLabel: '学习' }])
  expect((await post({ type: 'createGoal', title: '阅读', standards: ['读完'], destination: '' })).status).toBe(400)
  expect((await post({ type: 'createGoal', title: '阅读', standards: ['读完'], categoryLabel: '字'.repeat(201) })).status).toBe(400)
})

it('读取四表目标列表并明确拒绝旧主线参数', async () => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    if (new URL(input instanceof Request ? input.url : input).pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push(JSON.parse(String(init.body)))
    return Response.json({ version: 0, today: '2026-10-20', includeTerminal: false, page: 1, pageSize: 20, totalGoals: 0, goals: [], growth: { level: 1, totalXp: 0, progress: 0, needed: 20, remaining: 20, actions: 0, achievedGoals: 0 }, tasks: [], totalTasks: 0, taskProgress: { completed: 0, total: 0, ratio: null }, capabilities: {}, limits: { name: 200, standard: 4000, standards: 50 } })
  })
  const response = await app.request('/api/adventure', { headers }, env)
  expect(response.status).toBe(200)
  expect(calls[0]).not.toHaveProperty('p_mainline_id')
  expect(calls[0]).not.toHaveProperty('p_goal_scope')
  expect((await app.request(`/api/adventure?mainlineId=${owner}`, { headers }, env)).status).toBe(400)
})
