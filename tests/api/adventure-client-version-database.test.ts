import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localPlanningRpc, planningDatabase } from '../support/planning-database'
import { adventureClientVersion } from '../../src/shared/adventure-client-version'

const db = planningDatabase()
describe.skipIf(!localPlanningRpc)('客户端版本切换与真实数据库', () => {
  beforeEach(() => db.install())
  afterEach(() => db.restore())
  it('旧客户端不能写入或重试，新版本保留原封套安全重放', async () => {
    const owner = crypto.randomUUID()
    const before = await db.read(owner)
    const envelope = db.envelope(before.version, { type: 'createTask', title: '切换行动', description: '', plannedOn: before.today, destination: '' })
    for (const version of [null, 'old']) {
      const response = await db.request(owner, '/api/adventure/commands', envelope, version)
      expect(response.status).toBe(426)
      expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' } })
      expect(await db.read(owner)).toEqual(before)
    }
    const created = await db.request(owner, '/api/adventure/commands', envelope, adventureClientVersion)
    expect(created.status).toBe(200)
    const receipt = await created.json()
    const after = await db.read(owner)
    expect(after.version).toBe(before.version + 1)
    expect(after.growth.totalXp).toBe(before.growth.totalXp)
    expect(after.tasks.filter(task => task.title === '切换行动')).toHaveLength(1)
    expect((await db.request(owner, '/api/adventure/commands', envelope, null)).status).toBe(426)
    expect(await db.read(owner)).toEqual(after)
    const replay = await db.request(owner, '/api/adventure/commands', envelope, adventureClientVersion)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(receipt)
    expect(await db.read(owner)).toEqual(after)
  })
})
