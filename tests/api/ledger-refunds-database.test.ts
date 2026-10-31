import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

const refundInput = (overrides: Record<string, unknown> = {}) => ({ requestId: crypto.randomUUID(), amountCents: 3000, occurredAt: '2026-01-02T03:04:05.000Z', note: '', ...overrides })
const path = (parent: string) => `/api/ledger/entries/${parent}/refunds`
describe.skipIf(!ledgerRpc)('退款正式 HTTP 与隔离 PostgreSQL/PostgREST 边界补充', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  const read = async (owner: string, suffix = '') => {
    const response = await ledgerRequest(owner, '/api/ledger/entries' + suffix)
    expect(response.status).toBe(200)
    return ledgerPageSchema.parse(await response.json())
  }
  const write = async (owner: string, input = ordinaryEntry({ amountCents: -10000, categoryCode: 'dining' })) => {
    const response = await ledgerRequest(owner, '/api/ledger/entries', input)
    expect(response.status).toBe(200)
    return ledgerReceiptSchema.parse(await response.json())
  }
  const refund = async (owner: string, parent: string, input = refundInput()) => {
    const response = await ledgerRequest(owner, path(parent), input)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return ledgerReceiptSchema.parse(await response.json())
  }
  const detail = async (owner: string, id: string) => ledgerDetailSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${id}`)).json())
  it('并发退款共享 owner 事务锁，累计不超额且失败无流水或版本增量', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner)
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => ledgerRequest(owner, path(parent.entryId), refundInput())))
    expect(outcomes.filter(item => item.status === 200)).toHaveLength(3)
    for (const response of outcomes.filter(item => item.status !== 200)) {
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REFUND_LIMIT' } })
    }
    expect(await read(owner)).toMatchObject({ total: 4, version: 4 })
    expect((await detail(owner, parent.entryId)).entry).toMatchObject({ amountCents: -10000, status: 'partial-refund' })
    await refund(owner, parent.entryId, refundInput({ amountCents: 1000 }))
    expect((await detail(owner, parent.entryId)).entry.status).toBe('full-refund')
    expect((await ledgerRequest(owner, path(parent.entryId), refundInput({ amountCents: 1 }))).status).toBe(409)
    expect(await read(owner)).toMatchObject({ total: 5, version: 5 })
  })
  it('同编号并发只入账一次、额度变化和全额后仍先查重，异内容和不同父复用拒绝', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner), input = refundInput()
    const receipts = await Promise.all(Array.from({ length: 8 }, () => refund(owner, parent.entryId, input)))
    expect(new Set(receipts.map(item => item.entryId)).size).toBe(1)
    expect(await read(owner)).toMatchObject({ total: 2, version: 2 })
    await refund(owner, parent.entryId, refundInput({ amountCents: 7000 }))
    expect(await refund(owner, parent.entryId, input)).toEqual({ entryId: receipts[0].entryId, version: 3, deleted: false })
    const otherParentInput = ordinaryEntry({ amountCents: -10000, categoryCode: 'dining' })
    const otherParent = await write(owner, otherParentInput)
    for (const [target, content] of [[parent.entryId, { ...input, note: '不同内容' }], [otherParent.entryId, input]] as const) {
      const response = await ledgerRequest(owner, path(target), content)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    await refund(owner, otherParent.entryId, refundInput())
    await refund(owner, otherParent.entryId, refundInput())
    expect(await read(owner)).toMatchObject({ total: 6, version: 6 })
    const ordinaryRequest = ordinaryEntry({ requestId: input.requestId })
    expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryRequest)).status).toBe(409)
    const reusedOrdinary = await ledgerRequest(owner, path(parent.entryId), refundInput({ requestId: otherParentInput.requestId }))
    expect(reusedOrdinary.status).toBe(409)
    expect(await reusedOrdinary.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
  })
  it('单笔上限的正金额退款完整保存，不经浮点元运算且原支出金额不变', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner, ordinaryEntry({ amountCents: -99999999999, categoryCode: 'dining' }))
    const child = await refund(owner, parent.entryId, refundInput({ amountCents: 99999999999 }))
    expect(await detail(owner, parent.entryId)).toMatchObject({ entry: { amountCents: -99999999999, status: 'full-refund' }, refunds: [{ id: child.entryId, amountCents: 99999999999, status: 'completed' }], version: 2 })
  })
  it('父资格、跨账户操作和所有非法覆盖字段拒绝；同秒及 Unicode 边界合法并继承支出分类', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), parent = await write(owner)
    expect((await ledgerRequest(other, path(parent.entryId), refundInput())).status).toBe(404)
    expect(await read(other)).toMatchObject({ total: 0, version: 0 })
    const income = await write(owner, ordinaryEntry({ direction: 'income', amountCents: 10000, categoryCode: 'salary' }))
    const child = await refund(owner, parent.entryId, refundInput({ amountCents: 1 }))
    for (const id of [income.entryId, child.entryId]) {
      const response = await ledgerRequest(owner, path(id), refundInput())
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REFUND_PARENT_INVALID' } })
    }
    for (const invalid of [
      { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: '1' }, { amountCents: 100000000000 },
      { note: '😀'.repeat(501) }, { occurredAt: '2026-01-02T03:04:05.001Z' }, { occurredAt: '2026-02-30T00:00:00Z' },
      { occurredAt: '2099-01-02T03:04:05Z' }, { direction: 'income' }, { owner: other }, { ownerId: other },
      { accountName: '篡改账户' }, { categoryCode: 'salary' }, { parentEntryId: parent.entryId }, { status: 'completed' },
    ]) expect((await ledgerRequest(owner, path(parent.entryId), refundInput(invalid))).status).toBe(400)
    const early = await ledgerRequest(owner, path(parent.entryId), refundInput({ occurredAt: '2026-01-02T03:04:04.000Z' }))
    expect(early.status).toBe(400)
    expect(await early.json()).toMatchObject({ error: { code: 'REFUND_TIME' } })
    const receipt = await refund(owner, parent.entryId, refundInput({ note: '\u3000' + '中😀'.repeat(250) + '\n' }))
    expect((await detail(owner, receipt.entryId)).entry).toMatchObject({ direction: 'income', parentEntryId: parent.entryId, amountCents: 3000, accountName: '招商储蓄卡', categoryCode: 'dining', status: 'completed', note: '中😀'.repeat(250) })
    expect((await ledgerRequest(other, `/api/ledger/entries/${receipt.entryId}`)).status).toBe(404)
    expect(await read(owner)).toMatchObject({ total: 4, version: 4 })
  })
  it('退款插入后版本更新故障完整回滚，父状态不变且随后能正常退款', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner)
    const response = await ledgerRequest(owner, path(parent.entryId), refundInput({ note: 'ledger91-rollback' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'SAVE_UNKNOWN', message: '保存结果未确认，请沿用原请求重试或刷新查看流水' } })
    expect(await read(owner)).toMatchObject({ total: 1, version: 1 })
    expect(await detail(owner, parent.entryId)).toMatchObject({ entry: { status: 'completed' }, refunds: [], version: 1 })
    await refund(owner, parent.entryId)
    expect(await read(owner)).toMatchObject({ total: 2, version: 2 })
  })
  it('父支出在后页、退款在首页仍按全部退款派生状态，关联读取不依赖当前页', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner)
    await Promise.all(Array.from({ length: 30 }, () => write(owner, ordinaryEntry({ occurredAt: '2026-02-01T00:00:00.000Z' }))))
    const child = await refund(owner, parent.entryId, refundInput({ occurredAt: '2026-03-01T00:00:00.000Z' }))
    const first = await read(owner), second = await read(owner, '?page=2')
    expect(first.items.some(item => item.id === parent.entryId)).toBe(false)
    expect(first.items[0].id).toBe(child.entryId)
    expect(second.items.find(item => item.id === parent.entryId)).toMatchObject({ status: 'partial-refund', amountCents: -10000 })
    expect(await detail(owner, child.entryId)).toMatchObject({ parentEntry: { id: parent.entryId, status: 'partial-refund' } })
    expect((await detail(owner, parent.entryId)).refunds.map(item => item.id)).toEqual([child.entryId])
  })
  it('真实 PostgREST 浏览器角色不能直调退款 RPC，服务角色也不能覆盖账户和分类', async () => {
    const owner = crypto.randomUUID(), parent = await write(owner)
    const direct = async (role: string, input: unknown) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const payload = `${encode({ alg: 'HS256' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 300 })}`
      const signature = createHmac('sha256', process.env.LEDGER_LOCAL_JWT_SECRET!).update(payload).digest('base64url')
      return fetch(new URL('/rpc/ledger_refund', ledgerRpc), { method: 'POST', headers: { Authorization: `Bearer ${payload}.${signature}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner, p_parent: parent.entryId, p_input: input }) })
    }
    for (const role of ['anon', 'authenticated']) expect([401, 403, 404]).toContain((await direct(role, refundInput())).status)
    const forged = await direct('service_role', refundInput({ accountName: '伪造', categoryCode: 'salary' }))
    expect(forged.ok).toBe(false)
    expect(await forged.json()).toMatchObject({ message: 'INVALID_ENTRY' })
    expect((await direct('service_role', refundInput())).status).toBe(200)
    expect(await read(owner)).toMatchObject({ total: 2, version: 2 })
  })
})
