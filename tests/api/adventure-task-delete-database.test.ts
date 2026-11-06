import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const database = planningDatabase('delete-pending@example.invalid')
const { request, read, command, envelope, send } = database
let owner: string

describe.skipIf(!localPlanningRpc)('未完成任务删除与终态保护的真实事务', () => {
  beforeEach(() => { owner = crypto.randomUUID(); database.install() })
  afterEach(() => database.restore())

  it('今日和逾期任务可删除，撤销后删除不会重复扣除奖励，回执可重复读取', async () => {
    const today = (await read(owner)).today
    const goal = (await command(owner, { type: 'createGoal', title: '目标', standards: ['标准'], destination: '' })).result.entityId
    for (const plannedOn of ['2020-01-01', today, '2099-01-01']) {
      const id = (await command(owner, { type: 'createTask', title: '删除任务', description: '', plannedOn, destination: goal })).result.entityId
      if (plannedOn === today) {
        const completion = await command(owner, { type: 'completeTask', id })
        await command(owner, { type: 'cancelTaskCompletion', completionId: completion.result.completionId! })
      }
      const before = await read(owner)
      const value = envelope(before.version, { type: 'deleteTask', id })
      const response = await send(owner, value)
      expect(response.status).toBe(200)
      const receipt = await response.json()
      expect(await (await send(owner, value)).json()).toEqual(receipt)
      expect((await read(owner)).growth).toEqual(before.growth)
      expect((await read(owner)).goals[0].progress.total).toBe(0)
    }
  })
  it('未处理任务阻断达成、结束目标与结束主线的能力、预览和提交，转移后可继续', async () => {
    const mainline = (await command(owner, { type: 'createMainline', name: '主线' })).result.entityId
    const goal = (await command(owner, { type: 'createGoal', title: '目标', standards: ['标准'], destination: mainline })).result.entityId
    const today = (await read(owner)).today
    const id = (await command(owner, { type: 'createTask', title: '待处理', description: '', plannedOn: today, destination: goal })).result.entityId
    const before = await read(owner)
    expect(before.goals[0].capabilities.achieve.allowed).toBe(false)
    expect(before.goals[0].capabilities.end.allowed).toBe(false)
    expect(before.mainlines[0].capabilities.end.allowed).toBe(false)
    for (const value of [{ type: 'achieveGoal' as const, id: goal, coefficient: 1, reflection: '' }, { type: 'endGoal' as const, id: goal }, { type: 'endMainline' as const, id: mainline }]) {
      const preview = await request(owner, '/api/adventure/preview', { expectedVersion: before.version, command: value })
      expect(preview.status).toBe(400)
      expect(await preview.json()).toMatchObject({ error: { code: 'PENDING_TASKS' } })
      const result = await send(owner, envelope(before.version, value))
      expect(result.status).toBe(400)
      expect(await read(owner)).toEqual(before)
    }
    await command(owner, { type: 'editTask', id, title: '待处理', description: '', plannedOn: today, destination: '' })
    await command(owner, { type: 'achieveGoal', id: goal, coefficient: 1, reflection: '' })
    await command(owner, { type: 'endMainline', id: mainline })
    expect((await read(owner)).tasks[0]).toMatchObject({ id, independent: true, status: 'pending' })
  })
})
