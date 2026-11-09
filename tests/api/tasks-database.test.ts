import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { tasksResultSchema } from '../../src/shared/contracts'
import { installTasksDatabase, tasksRequest, tasksRpc } from '../support/tasks-database'

const adminUrl = process.env.WORKER_TEST_ADMIN_URL
describe.skipIf(!tasksRpc || !adminUrl)('首页待办通过 Worker → 真实 PostgREST → 隔离 PostgreSQL', () => {
  const admin = new Client({ connectionString: adminUrl! })
  const owner = crypto.randomUUID()
  let restore: () => void
  beforeAll(async () => {
    if (new URL(adminUrl!).hostname !== '127.0.0.1') throw new Error('仅允许隔离本机数据库')
    await admin.connect()
  })
  afterAll(() => admin.end())
  beforeEach(async () => {
    await admin.query('truncate public.tasks')
    restore = installTasksDatabase()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    restore()
  })

  it.each([
    ['2026-03-08T16:00:00Z', 'America/New_York', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01T16:00:00Z', 'America/New_York', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
    ['2026-09-06T16:00:00Z', 'America/Santiago', '2026-09-06T04:00:00Z', '2026-09-07T03:00:00Z'],
  ])('%s 在 %s 按实际日期边界筛选，排除完成及删除', async (now, timeZone, start, end) => {
    const seconds = (iso: string) => Date.parse(iso) / 1000
    await admin.query(
      `insert into public.tasks(id,title,area,planned_at,due_at,status,is_deleted) values
      (1,'起点','生活',$1,null,'todo',false),(2,'结束前','学习',$2-1,null,'todo',false),
      (3,'次日','生活',$2,null,'todo',false),(4,'前日','生活',$1-1,null,'todo',false),
      (5,'完成','生活',$1,null,'done',false),(6,'删除','生活',$1,null,'todo',true)`,
      [seconds(start), seconds(end)]
    )
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now))
    try {
      const response = await tasksRequest(owner, timeZone)
      expect(response.status).toBe(200)
      const body = tasksResultSchema.parse(await response.json())
      expect(body.date).toBe(now.slice(0, 10))
      expect(body.timeZone).toBe(timeZone)
      expect(body.tasks.map((task) => task.id)).toEqual(['1', '2'])
    } finally {
      clock.mockRestore()
    }
  })

  it('超过旧单页仍完整返回，并保持时间与标识稳定排序', async () => {
    await admin.query(
      "insert into public.tasks select i,'任务 '||i,'学习',1791216000+i,null,'todo',false from generate_series(1,501) i"
    )
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-06T08:00:00Z'))
    try {
      const response = await tasksRequest(owner, 'Asia/Shanghai')
      expect(response.status).toBe(200)
      const body = tasksResultSchema.parse(await response.json())
      expect(body.tasks).toHaveLength(501)
      expect(body.tasks[0]).toMatchObject({ id: '1', title: '任务 1' })
      expect(body.tasks[500]).toMatchObject({ id: '501', title: '任务 501' })
      expect(body.tasks.map((task) => task.plannedAt)).toEqual([...body.tasks.map((task) => task.plannedAt)].sort((a, b) => a - b))
    } finally {
      clock.mockRestore()
    }
  })
})
