import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'

const fixtureSchema = z.object({
  receipts: z.array(z.object({ owner_id: z.uuid(), request_id: z.string(), command: z.record(z.string(), z.unknown()), receipt: z.unknown() })),
  legacyCompletions: z.array(z.object({ owner_id: z.uuid(), completion_id: z.uuid(), unlocked_completion_id: z.uuid(), invalidated_completion_id: z.uuid(), expected_version: z.coerce.number() })),
})
const fixture = process.env.ADVENTURE_MIGRATED_FIXTURE ? fixtureSchema.parse(JSON.parse(process.env.ADVENTURE_MIGRATED_FIXTURE)) : undefined
const api = planningDatabase('migrated-task@example.invalid')

describe.skipIf(!localPlanningRpc || !fixture)('旧库迁移后的真实 Worker 任务回执与历史锁定', () => {
  beforeEach(() => api.install())
  afterEach(() => api.restore())

  it('旧 RPC 的目标和任务成功回执经两个入口原样重放，不重复写入', async () => {
    const ids = ['matrix-create-goal', 'matrix-edit-goal', 'matrix-focus-on', 'matrix-focus-off', 'matrix-reorder', 'matrix-create-task', 'matrix-edit-task', 'matrix-delete-task', 'matrix-end-goal', 'matrix-achieve-empty']
    const rows = ids.map(id => {
      const row = fixture!.receipts.find(item => item.request_id === id)
      expect(row, `missing legacy RPC fixture ${id}`).toBeDefined()
      return row!
    })
    const owner = rows[0].owner_id
    expect(rows.at(-1)!.receipt).toMatchObject({ result: { reward: { amount: 1, calculation: { type: 'goal_actions', count: 0, coefficient: 2, fallback: true, actionIds: [] } } } })
    const before = await (await api.request(owner, '/api/adventure/growth')).json()
    for (const row of rows) {
      const envelope = { requestId: row.request_id, expectedVersion: 0, command: row.command }
      const lookup = await api.request(owner, '/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }, null)
      expect(lookup.status, row.request_id).toBe(200)
      expect(await lookup.json(), row.request_id).toEqual({ requestId: row.request_id, nonce: 'a'.repeat(64), receipt: row.receipt })
      const replay = await api.request(owner, '/api/adventure/commands', envelope)
      expect(replay.status, row.request_id).toBe(200)
      expect(await replay.json(), row.request_id).toEqual(row.receipt)
      const foreign = await api.request(crypto.randomUUID(), '/api/adventure/receipts/lookup', { ...envelope, nonce: 'a'.repeat(64) }, null)
      expect(foreign.status, row.request_id).toBe(404)
    }
    expect(await (await api.request(owner, '/api/adventure/growth')).json()).toEqual(before)
  })

  it('有效及已失效的旧完成和旧任务命令安全重放，摘要冲突不能重新执行', async () => {
    for (const id of ['rpc-move-task', 'rpc-complete-task', 'rpc-complete-cancel', 'rpc-cancel-task', 'legacy-reschedule', 'legacy-migrate-task', 'legacy-end-task']) {
      const row = fixture!.receipts.find(item => item.request_id === id)!
      if (id === 'rpc-complete-task') expect(row.receipt).toMatchObject({ result: { mainlineName: '旧方向', source: { goalTitle: '保留的旧名称' } } })
      const expected = planningReceiptSchema.parse(row.receipt)
      const response = await api.request(row.owner_id, '/api/adventure/commands', { requestId: id, expectedVersion: 0, command: row.command })
      expect(response.status, id).toBe(200)
      const actual = await response.json()
      expect(actual, id).toEqual(expected)
      expect(JSON.stringify(actual), id).not.toMatch(/mainline|主线/i)
      const conflict = await api.request(row.owner_id, '/api/adventure/commands', { requestId: id, expectedVersion: 0, command: { type: 'deleteTask', id: expected.result.entityId } })
      expect(conflict.status, id).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    const owner = fixture!.receipts.find(item => item.request_id === 'rpc-complete-cancel')!.owner_id
    const growth = await api.request(owner, '/api/adventure/growth')
    expect(growth.status).toBe(200)
    expect(await growth.json()).toMatchObject({ version: 10, growth: { totalXp: 4, actions: 1, achievedGoals: 1 }, total: 2 })
  })

  it('旧奖励来源保留发生时非主线事实，不从当前目标补写分类', async () => {
    const row = fixture!.receipts.find(item => item.request_id === 'rpc-achieve-goal')!
    const receipt = planningReceiptSchema.parse(row.receipt)
    const response = await api.request(row.owner_id, `/api/adventure/reward-source?id=${receipt.result.achievementId}`)
    expect(response.status).toBe(200)
    const source = await response.json()
    expect(source).toMatchObject({ event: { title: 'RPC成果', categoryLabel: null, amount: 3 }, reflection: '冻结评价', standards: ['成果标准'], totalSources: 1,
      actionSources: [{ title: 'RPC迁移任务', goalTitle: 'RPC成果', categoryLabel: null, description: '原始说明' }] })
    expect(JSON.stringify(source)).not.toMatch(/mainline|主线/i)
    expect((await api.request(crypto.randomUUID(), `/api/adventure/reward-source?id=${receipt.result.achievementId}`)).status).toBe(404)
  })

  it('旧目标迁移和聚焦回执精确重放，冲突与新的退役命令均不改变账户', async () => {
    for (const id of ['lock-move-goal', 'replay-goal-migrate', 'replay-focus']) {
      const row = fixture!.receipts.find(item => item.request_id === id)!
      const expected = planningReceiptSchema.parse(row.receipt)
      const before = await (await api.request(row.owner_id, '/api/adventure/growth')).json()
      const envelope = { requestId: id, expectedVersion: 0, command: row.command }
      const response = await api.request(row.owner_id, '/api/adventure/commands', envelope)
      expect(response.status, id).toBe(200)
      const actual = await response.json()
      expect(actual, id).toEqual(expected)
      expect(JSON.stringify(actual), id).not.toMatch(/mainline|主线/i)
      const conflict = await api.request(row.owner_id, '/api/adventure/commands', { ...envelope, command: { type: 'deleteTask', id: expected.result.entityId } })
      expect(conflict.status, id).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
      const fresh = await api.request(row.owner_id, '/api/adventure/commands', { ...envelope, requestId: `new-${id}`, expectedVersion: z.object({ version: z.number() }).parse(before).version })
      expect(fresh.status, id).toBe(400)
      expect(await (await api.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
    }
  })

  it('未知结构的旧回执不可安全重放，摘要冲突优先且不重新执行', async () => {
    for (const id of ['unsafe-cn-receipt', 'unsafe-en-receipt']) {
      const row = fixture!.receipts.find(item => item.request_id === id)!
      const old = planningReceiptSchema.parse(row.receipt)
      expect(old.result.message).toMatch(/主线|mainline/i)
      const before = await (await api.request(row.owner_id, '/api/adventure/growth')).json()
      const envelope = { requestId: id, expectedVersion: 0, command: row.command }
      const conflict = await api.request(row.owner_id, '/api/adventure/commands', { ...envelope, command: { type: 'deleteTask', id: old.result.entityId } })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
      const response = await api.request(row.owner_id, '/api/adventure/commands', envelope)
      expect(response.status).toBe(409)
      const error = await response.json()
      expect(error).toMatchObject({ error: { code: 'REPLAY_UNAVAILABLE' } })
      expect(JSON.stringify(error)).not.toMatch(/mainline|主线/i)
      expect(await (await api.request(row.owner_id, '/api/adventure/growth')).json()).toEqual(before)
    }
  })

  it('迁移后旧主线结束不再冻结完成，完成可正常撤销且不产生主线残留', async () => {
    const legacy = fixture!.legacyCompletions[0]
    const growthBefore = z.object({ version: z.number() }).parse(await (await api.request(legacy.owner_id, '/api/adventure/growth')).json())
    const cancel = await api.request(legacy.owner_id, '/api/adventure/commands', { requestId: 'legacy-http-cancel', expectedVersion: legacy.expected_version, command: { type: 'cancelTaskCompletion', completionId: legacy.completion_id } })
    expect(cancel.status).toBe(200)
    const growthAfter = await (await api.request(legacy.owner_id, '/api/adventure/growth')).json()
    expect(growthAfter).toMatchObject({ version: legacy.expected_version + 1, growth: { totalXp: 1, actions: 1 } })
    expect(JSON.stringify(growthAfter)).not.toMatch(/mainline|主线/i)
    expect(growthBefore.version).toBe(legacy.expected_version)
  })
})
