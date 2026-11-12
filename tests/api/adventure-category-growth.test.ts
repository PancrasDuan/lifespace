import { afterEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import { growthPageSchema, rewardSourceSchema } from '../../src/shared/adventure-growth'
import { taskListSchema } from '../../src/shared/adventure-planning'

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.test` }
afterEach(() => vi.unstubAllGlobals())

it('成长流水与奖励来源返回冻结分类和目标，不要求或暴露主线', async () => {
  const event = { id: owner, kind: 'task_completed', entityId: owner, title: '行动', occurredAt: '2026-11-11T00:00:00Z', occurredOn: '2026-11-11', amount: 1, goalId: owner, goalTitle: '目标', categoryLabel: '健康', calculation: { type: 'fixed_task', completionId: owner, count: 1, coefficient: 1 } }
  const achievement = { id: 'a', label: '成就', threshold: 1, count: 1, remaining: 0, unlocked: true }
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    if (path.endsWith('adventure_growth_read')) return Response.json({ version: 1, growth: { level: 1, totalXp: 1, progress: 1, needed: 20, remaining: 19, actions: 1, achievedGoals: 0, achievements: Array(7).fill(achievement) }, pageSize: 10, total: 1, items: [event], nextCursor: null })
    return Response.json({ version: 1, event, description: '', plannedOn: '2026-11-11', standards: [], reflection: null, page: 1, pageSize: 5, totalSources: 0, actionSources: [] })
  })
  for (const path of ['/api/adventure/growth', `/api/adventure/reward-source?id=${owner}`]) {
    const response = await app.request(path, { headers }, env)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toMatch(/mainline/i)
    expect(path.endsWith('growth') ? growthPageSchema.parse(body).items[0] : rewardSourceSchema.parse(body).event).toMatchObject({ goalTitle: '目标', categoryLabel: '健康' })
  }
})

it('日期列表和安排历史保留目标与冻结分类，无需主线字段', async () => {
  const task = { id: owner, title: '行动', description: '', plannedOn: '2026-11-11', status: 'completed', completedOn: '2026-11-11', completionId: owner, reward: { amount: 1, calculation: { type: 'fixed_task', completionId: owner, count: 1, coefficient: 1 } }, completionOrigin: { goalId: owner, goalTitle: '目标', categoryLabel: '健康', title: '行动', description: '', plannedOn: '2026-11-11', occurredOn: '2026-11-11' }, goalId: owner, goalTitle: '目标', independent: false, overdue: false, progress: { completed: 1, total: 1, ratio: 1 }, capabilities: {} }
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    if (path.endsWith('adventure_task_list')) return Response.json({ version: 1, today: '2026-11-11', date: '2026-11-11', scope: 'all', page: 1, pageSize: 10, total: 1, tasks: [task], progress: task.progress })
    return Response.json({ version: 1, taskId: owner, title: '行动', page: 1, pageSize: 5, total: 1, items: [{ id: owner, kind: 'task_created', sourceEventId: null, oldPlannedOn: null, newPlannedOn: '2026-11-11', occurredAt: '2026-11-11T00:00:00Z', title: '行动', description: '', goalId: owner, goalTitle: '目标' }] })
  })
  const list = await app.request('/api/adventure/tasks/list', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-11-11', today: '2026-11-11', scope: 'all', expectedVersion: 1 }) }, env)
  expect(list.status).toBe(200)
  expect(taskListSchema.parse(await list.json()).tasks[0].completionOrigin?.categoryLabel).toBe('健康')
  const history = await app.request(`/api/adventure/task-history?id=${owner}`, { headers }, env)
  expect(history.status).toBe(200)
  expect(JSON.stringify(await history.json())).not.toMatch(/mainline/i)
})
