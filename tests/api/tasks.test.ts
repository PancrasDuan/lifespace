import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { tasksResultSchema } from '../../src/shared/contracts'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('任务来源尚未配置时返回明确状态，不伪装成空任务', async () => {
  const response = await app.request('/api/tasks/today?timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: { code: 'TASKS_NOT_CONFIGURED', message: '任务来源尚未配置' } })
})

test('今日待办按当地日期筛选，在夏令时开始日排除次日、已完成及已删除任务', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-08T16:00:00Z'))
  const at = (iso: string) => Date.parse(iso) / 1000
  const rows = [
    { id: 2, title: '午间阅读', area: '学习', planned_at: at('2026-03-08T16:00:00Z'), due_at: null, status: 'todo', is_deleted: false },
    { id: 1, title: '午夜任务', area: '生活', planned_at: at('2026-03-08T05:00:00Z'), due_at: null, status: 'todo', is_deleted: false },
    { id: 3, title: '前一天', area: '生活', planned_at: at('2026-03-08T04:59:59Z'), due_at: null, status: 'todo', is_deleted: false },
    { id: 4, title: '下一天', area: '生活', planned_at: at('2026-03-09T04:00:00Z'), due_at: null, status: 'todo', is_deleted: false },
    { id: 5, title: '已完成', area: '生活', planned_at: at('2026-03-08T16:00:00Z'), due_at: null, status: 'done', is_deleted: false },
    { id: 6, title: '已删除', area: '生活', planned_at: at('2026-03-08T16:00:00Z'), due_at: null, status: 'todo', is_deleted: true },
  ]
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const query = new URL(String(input)).searchParams
    const filtered = rows.filter(row => query.getAll('planned_at').every(value => {
      const [op, seconds] = value.split('.')
      return op === 'gte' ? row.planned_at >= Number(seconds) : row.planned_at < Number(seconds)
    }) && (!query.has('status') || row.status === query.get('status')?.slice(3)) && (!query.has('is_deleted') || String(row.is_deleted) === query.get('is_deleted')?.slice(3)))
    return Response.json(filtered.sort((a, b) => a.planned_at - b.planned_at || a.id - b.id))
  })
  const response = await app.request('/api/tasks/today?timeZone=America%2FNew_York', {}, { SUPABASE_URL: 'https://zvdcjzjfhkjasikchceo.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ date: '2026-03-08', timeZone: 'America/New_York', tasks: [
    { id: '1', title: '午夜任务', plannedAt: at('2026-03-08T05:00:00Z') },
    { id: '2', title: '午间阅读', plannedAt: at('2026-03-08T16:00:00Z') },
  ] })
})

test('任务来源超过单页时返回全部记录，不截断首页详情', async () => {
  const rows = Array.from({ length: 501 }, (_, id) => ({ id: id + 1, title: `任务 ${id + 1}`, area: '学习', planned_at: 1791244800 + id, due_at: null }))
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const query = new URL(String(input)).searchParams
    const offset = Number(query.get('offset')); const limit = Number(query.get('limit'))
    return Response.json(rows.slice(offset, offset + limit))
  })
  const response = await app.request('/api/tasks/today?timeZone=Asia%2FShanghai', {}, { SUPABASE_URL: 'https://zvdcjzjfhkjasikchceo.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' })
  const body = tasksResultSchema.parse(await response.json())
  expect(body.tasks).toHaveLength(501)
  expect(body.tasks[500].title).toBe('任务 501')
})

test('夏令时结束日涵盖 25 小时，并排除下一天的起点', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T16:00:00Z'))
  const rows = [
    { id: 1, title: '凌晨', area: '生活', planned_at: Date.parse('2026-11-01T04:00:00Z') / 1000, due_at: null },
    { id: 2, title: '当日晚间', area: '生活', planned_at: Date.parse('2026-11-02T04:59:59Z') / 1000, due_at: null },
    { id: 3, title: '次日凌晨', area: '生活', planned_at: Date.parse('2026-11-02T05:00:00Z') / 1000, due_at: null },
  ]
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const ranges = new URL(String(input)).searchParams.getAll('planned_at')
    return Response.json(rows.filter(row => ranges.every(range => { const [op, value] = range.split('.'); return op === 'gte' ? row.planned_at >= Number(value) : row.planned_at < Number(value) })))
  })
  const response = await app.request('/api/tasks/today?timeZone=America%2FNew_York', {}, { SUPABASE_URL: 'https://zvdcjzjfhkjasikchceo.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' })
  expect(await response.json()).toMatchObject({ date: '2026-11-01', tasks: [{ id: '1', title: '凌晨' }, { id: '2', title: '当日晚间' }] })
})

test('无效任务时区返回输入错误', async () => {
  expect((await app.request('/api/tasks/today?timeZone=Invalid%2FZone', {}, {})).status).toBe(400)
})

test('午夜跳过一小时的地区，今日任务仍在次日午夜结束', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T16:00:00Z'))
  const rows = [
    { id: 1, title: '当日晚间', area: '生活', planned_at: Date.parse('2026-09-07T02:59:59Z') / 1000, due_at: null },
    { id: 2, title: '次日凌晨', area: '生活', planned_at: Date.parse('2026-09-07T03:00:00Z') / 1000, due_at: null },
  ]
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const ranges = new URL(String(input)).searchParams.getAll('planned_at')
    return Response.json(rows.filter(row => ranges.every(range => { const [op, value] = range.split('.'); return op === 'gte' ? row.planned_at >= Number(value) : row.planned_at < Number(value) })))
  })
  const response = await app.request('/api/tasks/today?timeZone=America%2FSantiago', {}, { SUPABASE_URL: 'https://zvdcjzjfhkjasikchceo.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' })
  expect(await response.json()).toMatchObject({ date: '2026-09-06', tasks: [{ id: '1', title: '当日晚间' }] })
})
