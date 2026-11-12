import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { taskListSchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const database = planningDatabase('date-list@example.invalid')
const { request, readFourTable: read, commandFourTable: command } = database

describe.skipIf(!localPlanningRpc)('今日聚焦独立日期列表经 Worker 读取真实数据库', () => {
  beforeEach(() => database.install())
  afterEach(() => database.restore())

  it('日期列表的全部范围包含保留聚焦值、未聚焦目标及独立任务，不新增聚焦筛选', async () => {
    const owner = crypto.randomUUID()
    const focused = (await database.fixtureGoal(owner, 0, { type: 'createGoal', title: '保留聚焦', standards: ['标准'] })).result.entityId
    const plain = (await database.fixtureGoal(owner, 1, { type: 'createGoal', title: '未聚焦', standards: ['标准'] })).result.entityId
    await database.fixtureFocused(owner, focused)
    const today = (await read(owner)).today
    const ids = []
    for (const destination of [focused, plain, '']) ids.push((await command(owner, { type: 'createTask', title: '今日行动', description: '', plannedOn: today, destination })).result.entityId)
    const state = await read(owner)
    const response = await request(owner, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: state.version })
    expect(response.status).toBe(200)
    const list = taskListSchema.parse(await response.json())
    expect(list.total).toBe(3)
    expect(list.tasks.map(task => task.id)).toEqual(ids)
  })

  it('今天含逾期和实际完成，过去按实际完成而未来按计划日读取', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const create = (title: string, plannedOn: string) => (plannedOn < today ? database.createHistoricalTaskFourTable : command)(owner, { type: 'createTask', title, description: '', plannedOn, destination: '' })
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
  it('50个4000字中文已完成任务可完整分批读取、稳定重读且保留冻结说明', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const description = '长'.repeat(4000)
    const ids: string[] = []
    for (let index = 0; index < 50; index++) {
      const id = (await command(owner, { type: 'createTask', title: `长说明 ${index}`, description, plannedOn: today, destination: '' })).result.entityId
      ids.push(id)
      await command(owner, { type: 'completeTask', id })
    }
    const workspace = await read(owner)
    const tasks = []
    for (let page = 1; ; page++) {
      const conditions = { date: today, today, scope: 'all', expectedVersion: workspace.version, page }
      const response = await request(owner, '/api/adventure/tasks/list', conditions)
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(new TextEncoder().encode(body).byteLength).toBeLessThan(1_000_000)
      const result = taskListSchema.parse(JSON.parse(body))
      expect(result).toMatchObject({ total: 50, progress: { completed: 50, total: 50 } })
      expect(await (await request(owner, '/api/adventure/tasks/list', conditions)).json()).toEqual(JSON.parse(body))
      tasks.push(...result.tasks)
      if (tasks.length >= result.total) break
    }
    expect(tasks.map(item => item.id)).toEqual(ids)
    expect(tasks.every(item => item.description === description && item.completionOrigin?.description === description)).toBe(true)
  }, 30_000)
  it('最大JSON转义说明和归属名称仍可读取，且不截断冻结内容', async () => {
    const owner = crypto.randomUUID()
    const today = (await read(owner)).today
    const escaped = String.fromCharCode(1)
    const description = escaped.repeat(4000)
    const goal = (await database.fixtureGoal(owner, (await read(owner)).version, { type: 'createGoal', title: escaped.repeat(200), standards: ['标准'], categoryLabel: escaped.repeat(200) })).result.entityId
    for (let index = 0; index < 10; index++) {
      const id = (await command(owner, { type: 'createTask', title: escaped.repeat(199) + index, description, plannedOn: today, destination: goal })).result.entityId
      await command(owner, { type: 'completeTask', id })
    }
    const current = await read(owner)
    const response = await request(owner, '/api/adventure/tasks/list', { date: today, today, scope: 'all', expectedVersion: current.version, page: 1 })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(1_000_000)
    const result = taskListSchema.parse(JSON.parse(body))
    expect(result).toMatchObject({ total: 10, pageSize: 10 })
    expect(result.tasks).toHaveLength(10)
    expect(result.tasks.every(item => item.description === description && item.completionOrigin?.description === description)).toBe(true)
  })

  it('真实历史完成按实际完成日非空读取，新建旧成功封套跨日重放仍稳定', async () => {
    const owner = crypto.randomUUID()
    const create = database.envelope(0, { type: 'createTask', title: '历史完成', description: '冻结历史说明', plannedOn: '2020-01-01', destination: '' })
    const receipt = await database.historicalCommand(owner, create, '2020-01-01')
    await database.historicalCommand(owner, database.envelope(receipt.version, { type: 'completeTask', id: receipt.result.entityId }), '2020-01-02')
    const current = await read(owner)
    const list = async (date: string) => {
      const response = await request(owner, '/api/adventure/tasks/list', { date, today: current.today, scope: 'all', expectedVersion: current.version, page: 1 })
      expect(response.status).toBe(200)
      return taskListSchema.parse(await response.json())
    }
    expect(await list('2020-01-01')).toMatchObject({ total: 0, tasks: [] })
    expect(await list('2020-01-02')).toMatchObject({ total: 1, tasks: [{ id: receipt.result.entityId, plannedOn: '2020-01-01', completedOn: '2020-01-02', completionOrigin: { occurredOn: '2020-01-02', description: '冻结历史说明' }, capabilities: { cancel: { allowed: false } } }] })
    const replay = await database.send(owner, create)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(receipt)
    expect(await read(owner)).toEqual(current)
  })
  it('完整批次稳定去重，跨批版本或北京日期变化拒绝，条件不放URL', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const today = (await read(owner)).today
    for (let index = 0; index < 52; index++) await command(owner, { type: 'createTask', title: `批次 ${index}`, description: '', plannedOn: today, destination: '' })
    const page = await read(owner)
    const conditions = { date: today, scope: 'all', expectedVersion: page.version, today, page: 1 }
    const list = async (number: number) => taskListSchema.parse(await (await request(owner, '/api/adventure/tasks/list', { ...conditions, page: number })).json())
    const batches = await Promise.all([1, 2, 3, 4, 5, 6].map(list))
    const [first, second] = batches
    expect(first.tasks).toHaveLength(10)
    expect(second.tasks).toHaveLength(10)
    expect(batches[5].tasks).toHaveLength(2)
    expect(new Set(batches.flatMap(batch => batch.tasks.map(item => item.id))).size).toBe(52)
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
