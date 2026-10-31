import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

const base = (id: string) => `/api/ledger/entries/${id}`
const refundInput = () => ({ requestId: crypto.randomUUID(), amountCents: 3000, occurredAt: '2026-01-02T03:04:05Z', note: '' })
describe.skipIf(!ledgerRpc)('删除正式 HTTP 与隔离 PostgreSQL/PostgREST 边界补充', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  const write = async (owner: string, input = ordinaryEntry({ amountCents: -10000 })) => {
    const response = await ledgerRequest(owner, '/api/ledger/entries', input)
    expect(response.status).toBe(200)
    return ledgerReceiptSchema.parse(await response.json())
  }
  const refund = async (owner: string, id: string, input = refundInput()) => {
    const response = await ledgerRequest(owner, base(id) + '/refunds', input)
    expect(response.status).toBe(200)
    return ledgerReceiptSchema.parse(await response.json())
  }
  const list = async (owner: string) => ledgerPageSchema.parse(await (await ledgerRequest(owner)).json())
  const detail = async (owner: string, id: string) => ledgerDetailSchema.parse(await (await ledgerRequest(owner, base(id))).json())
  const preview = async (owner: string, id: string) => {
    const response = await ledgerRequest(owner, base(id) + '/delete-preview')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return ledgerDeletePreviewSchema.parse(await response.json())
  }
  const remove = async (owner: string, id: string, scope: string) => {
    const response = await ledgerRequest(owner, base(id) + '/delete', { scope })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return ledgerReceiptSchema.parse(await response.json())
  }
  it('预览只读、父子原子删除只加一次版本，重复删除和旧创建／退款请求不复活也不回正文', async () => {
    const owner = crypto.randomUUID(), input = ordinaryEntry({ amountCents: -10000 }), parent = await write(owner, input), childInput = refundInput()
    const child = await refund(owner, parent.entryId, childInput), impact = await preview(owner, parent.entryId)
    expect(impact).toMatchObject({ refundCount: 1, version: 2 })
    expect(await list(owner)).toMatchObject({ total: 2, version: 2 })
    expect(await preview(owner, parent.entryId)).toEqual(impact)
    const results = await Promise.all(Array.from({ length: 8 }, () => remove(owner, parent.entryId, impact.scope)))
    for (const result of results) expect(result).toEqual({ entryId: parent.entryId, deleted: true, version: 3 })
    expect(await list(owner)).toMatchObject({ total: 0, version: 3 })
    expect(await write(owner, input)).toEqual({ entryId: parent.entryId, deleted: true, version: 3 })
    expect(await refund(owner, parent.entryId, childInput)).toEqual({ entryId: child.entryId, deleted: true, version: 3 })
    for (const id of [parent.entryId, child.entryId]) {
      for (const suffix of ['', '/delete-preview']) expect((await ledgerRequest(owner, base(id) + suffix)).status).toBe(404)
      expect((await ledgerRequest(owner, base(id) + '/refunds', refundInput())).status).toBe(404)
    }
    expect((await ledgerRequest(owner, base(parent.entryId) + '/refunds', { ...childInput, note: '不同内容' })).status).toBe(409)
    expect(await list(owner)).toMatchObject({ total: 0, version: 3 })
  })
  it('单删退款不改变其他原始事实，恢复父状态且释放可退额度', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner), first = await refund(owner, parent.entryId)
    const second = await refund(owner, parent.entryId, { ...refundInput(), amountCents: 7000 })
    const original = (await detail(owner, parent.entryId)).entry
    await remove(owner, second.entryId, (await preview(owner, second.entryId)).scope)
    expect(await detail(owner, parent.entryId)).toMatchObject({ entry: { ...original, status: 'partial-refund' }, refunds: [{ id: first.entryId }] })
    await remove(owner, first.entryId, (await preview(owner, first.entryId)).scope)
    expect(await detail(owner, parent.entryId)).toMatchObject({ entry: { ...original, status: 'completed' }, refunds: [], version: 5 })
    await refund(owner, parent.entryId, { ...refundInput(), amountCents: 10000 })
    expect((await detail(owner, parent.entryId)).entry.status).toBe('full-refund')
  })
  it('未知和他人目标统一404，客户端 owner、非法范围、查询和浏览器直调全部拒绝', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), parent = await write(owner), impact = await preview(owner, parent.entryId)
    for (const id of [parent.entryId, crypto.randomUUID()]) {
      expect(await (await ledgerRequest(other, base(id) + '/delete-preview')).json()).toEqual({ error: { code: 'NOT_FOUND', message: '流水不存在或不属于当前账户' } })
      expect((await ledgerRequest(other, base(id) + '/delete', { scope: impact.scope })).status).toBe(404)
    }
    for (const body of [{}, { scope: 'x' }, { scope: impact.scope, owner }, { scope: impact.scope, ownerId: other }, { scope: [impact.scope] }])
      expect((await ledgerRequest(owner, base(parent.entryId) + '/delete', body)).status).toBe(400)
    expect((await ledgerRequest(owner, base(parent.entryId) + '/delete?owner=' + other, { scope: impact.scope })).status).toBe(400)
    expect((await ledgerRequest(owner, base(parent.entryId) + '/delete-preview?version=1')).status).toBe(400)
    const direct = async (role: string, rpc: string, body: unknown) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const payload = `${encode({ alg: 'HS256' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 300 })}`
      const signature = createHmac('sha256', process.env.LEDGER_LOCAL_JWT_SECRET!).update(payload).digest('base64url')
      return fetch(new URL('/rpc/' + rpc, ledgerRpc), { method: 'POST', headers: { Authorization: `Bearer ${payload}.${signature}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    for (const role of ['anon', 'authenticated']) for (const [rpc, body] of [
      ['ledger_delete_preview', { p_owner: owner, p_id: parent.entryId }],
      ['ledger_delete', { p_owner: owner, p_id: parent.entryId, p_scope: impact.scope }],
      ['ledger_delete_scope', { p_owner: owner, p_id: parent.entryId }],
    ] as const) expect([401, 403, 404]).toContain((await direct(role, rpc, body)).status)
    expect([401, 403, 404]).toContain((await direct('service_role', 'ledger_delete_scope', { p_owner: owner, p_id: parent.entryId })).status)
    expect(await list(owner)).toMatchObject({ total: 1, version: 1 })
    expect(await list(other)).toMatchObject({ total: 0, version: 0 })
  })
  it('父删除与退款并发不产生可见孤儿，范围冲突不写数据且重确认后能删除', async () => {
    for (let n = 0; n < 12; n++) {
      const owner = crypto.randomUUID(), parent = await write(owner), impact = await preview(owner, parent.entryId)
      const [deletion, addition] = await Promise.all([
        ledgerRequest(owner, base(parent.entryId) + '/delete', { scope: impact.scope }),
        ledgerRequest(owner, base(parent.entryId) + '/refunds', refundInput()),
      ])
      if (deletion.status === 200) {
        expect(addition.status).toBe(404)
        expect(await list(owner)).toMatchObject({ total: 0, version: 2 })
      } else {
        expect(deletion.status).toBe(409)
        expect(await deletion.json()).toMatchObject({ error: { code: 'DELETE_SCOPE_CHANGED' } })
        expect(addition.status).toBe(200)
        expect(await list(owner)).toMatchObject({ total: 2, version: 2 })
        await remove(owner, parent.entryId, (await preview(owner, parent.entryId)).scope)
        expect(await list(owner)).toMatchObject({ total: 0, version: 3 })
      }
      expect((await ledgerRequest(owner, base(parent.entryId))).status).toBe(404)
    }
  })
  it('父子删除后版本更新故障完整回滚，持久结果和原版本均不改变', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner, ordinaryEntry({ note: 'ledger94-delete-rollback', amountCents: -10000 }))
    await refund(owner, parent.entryId)
    const before = await detail(owner, parent.entryId), impact = await preview(owner, parent.entryId)
    const response = await ledgerRequest(owner, base(parent.entryId) + '/delete', { scope: impact.scope })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'DELETE_UNKNOWN' } })
    expect(await detail(owner, parent.entryId)).toEqual(before)
    expect(await list(owner)).toMatchObject({ total: 2, version: 2 })
    expect(await preview(owner, parent.entryId)).toEqual(impact)
  })
})
