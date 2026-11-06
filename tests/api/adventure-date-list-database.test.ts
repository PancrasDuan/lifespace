import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { taskListSchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const database = planningDatabase('date-list@example.invalid')
const { request, read, command } = database

describe.skipIf(!localPlanningRpc)('今日聚焦独立日期列表经 Worker 读取真实数据库', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  it('今天含逾期和实际完成，过去按实际完成而未来按计划日读取', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const create = (title: string, plannedOn: string) => command(owner, { type: 'createTask', title, description: '', plannedOn, destination: '' })
    const overdue = (await create('逾期待完成', '2020-01-01')).result.entityId
    const completed = (await create('逾期今天完成', '2020-01-02')).result.entityId
    await command(owner, { type: 'completeTask', id: completed })
    const pending = (await create('今日待完成', today)).result.entityId
    const future = (await create('未来安排', '2099-01-01')).result.entityId
    const page = await read(owner)
    const list = async (date: string) => {
      const response = await request(owner, '/api/adventure/tasks/list', { date, scope: 'all', expectedVersion: page.version, today, page: 1 })
      expect(response.status).toBe(200)
      return taskListSchema.parse(await response.json())
    }
    const current = await list(today)
    expect(current).toMatchObject({ version: page.version, today, date: today, total: 3, progress: { completed: 1, total: 3 } })
    expect(current.tasks.map((task: { id: string }) => task.id)).toEqual([overdue, pending, completed])
    expect(await list('2020-01-01')).toMatchObject({ total: 0, tasks: [] })
    expect(await list('2020-01-02')).toMatchObject({ total: 0, tasks: [] })
    expect(await list('2099-01-01')).toMatchObject({ total: 1, tasks: [{ id: future }] })
  })
  it('完整批次稳定去重，跨批版本或北京日期变化拒绝，条件不放URL', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const today = (await read(owner)).today
    for (let index = 0; index < 52; index++) await command(owner, { type: 'createTask', title: `批次 ${index}`, description: '', plannedOn: today, destination: '' })
    const page = await read(owner)
    const conditions = { date: today, scope: 'all', expectedVersion: page.version, today, page: 1 }
    const list = async (number: number) => taskListSchema.parse(await (await request(owner, '/api/adventure/tasks/list', { ...conditions, page: number })).json())
    const first = await list(1), second = await list(2)
    expect(first.tasks).toHaveLength(50)
    expect(second.tasks).toHaveLength(2)
    expect(new Set([...first.tasks, ...second.tasks].map(item => item.id)).size).toBe(52)
    expect(await list(1)).toEqual(first)
    await read(other)
    expect((await request(other, '/api/adventure/tasks/list', { ...conditions, expectedVersion: 0 })).status).toBe(200)
    expect((await request(owner, '/api/adventure/tasks/list?date=' + today, conditions)).status).toBe(400)
    expect((await request(owner, '/api/adventure/tasks/list', { ...conditions, search: '不能传搜索' })).status).toBe(400)
    expect((await request(owner, '/api/adventure/tasks/list', { ...conditions, today: '2020-01-01' })).status).toBe(409)
    await command(owner, { type: 'createTask', title: '并发新增', description: '', plannedOn: today, destination: '' })
    expect((await request(owner, '/api/adventure/tasks/list', { ...conditions, page: 2 })).status).toBe(409)
  })
})
