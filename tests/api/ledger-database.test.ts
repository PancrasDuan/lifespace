import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ledgerPageSchema, ledgerReceiptSchema, ledgerDetailSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerEnv, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'
import app from '../../worker/index'

describe.skipIf(!ledgerRpc)('账单正式 HTTP 与隔离 PostgreSQL/PostgREST 边界补充', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  const read = async (owner: string, query = '') => {
    const response = await ledgerRequest(owner, '/api/ledger/entries' + query)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return ledgerPageSchema.parse(await response.json())
  }
  const write = async (owner: string, input = ordinaryEntry()) => {
    const response = await ledgerRequest(owner, '/api/ledger/entries', input)
    expect(response.status).toBe(200)
    return ledgerReceiptSchema.parse(await response.json())
  }
  it('空账户版本零、首次并发独立写入、同编号并发去重、异内容拒绝且重试返回当前版本', async () => {
    const owner = crypto.randomUUID(), input = ordinaryEntry()
    expect(await read(owner)).toEqual({ items: [], total: 0, page: 1, pageSize: 30, version: 0 })
    const receipts = await Promise.all(Array.from({ length: 8 }, () => write(owner, input)))
    expect(new Set(receipts.map(item => item.entryId)).size).toBe(1)
    expect(await read(owner)).toMatchObject({ total: 1, version: 1 })
    const copies = await Promise.all(Array.from({ length: 5 }, () => write(owner)))
    expect(new Set(copies.map(item => item.entryId)).size).toBe(5)
    expect(await read(owner)).toMatchObject({ total: 6, version: 6 })
    expect(await write(owner, input)).toEqual({ entryId: receipts[0].entryId, version: 6, deleted: false })
    const reused = await ledgerRequest(owner, '/api/ledger/entries', { ...input, note: '另一笔内容' })
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    expect(await read(owner)).toMatchObject({ total: 6, version: 6 })
  })
  it('61 条同秒流水分页 30／30／1，标识稳定倒序且不漏不重', async () => {
    const owner = crypto.randomUUID()
    const receipts = await Promise.all(Array.from({ length: 61 }, () => write(owner)))
    const pages = await Promise.all([read(owner), read(owner, '?page=2'), read(owner, '?page=3')])
    expect(pages.map(page => page.items.length)).toEqual([30, 30, 1])
    const ids = pages.flatMap(page => page.items.map(entry => entry.id))
    expect(ids).toEqual(receipts.map(item => item.entryId).sort().reverse())
    expect(pages.every(page => page.total === 61 && page.version === 61)).toBe(true)
    expect(await read(owner, '?page=2')).toEqual(pages[1])
  })
  it('插入后版本更新故障完整回滚，错误响应不泄露数据库细节且同 owner 可继续创建', async () => {
    const owner = crypto.randomUUID()
    const response = await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ note: 'ledger91-rollback' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'SAVE_UNKNOWN' } })
    expect(await read(owner)).toMatchObject({ items: [], total: 0, version: 0 })
    await write(owner)
    expect(await read(owner)).toMatchObject({ total: 1, version: 1 })
  })
  it('金额、分类、Unicode 码点、trim 与 UTC 秒精度约束拒绝无效写入并保留版本', async () => {
    const owner = crypto.randomUUID()
    for (const invalid of [
      { amountCents: 0 }, { amountCents: -100000000000 }, { amountCents: -1.5 }, { amountCents: 1 }, { amountCents: '10' },
      { direction: 'refund' }, { categoryCode: 'salary' }, { categoryCode: 'custom' }, { accountName: ' \t\u3000' },
      { accountName: '😀'.repeat(51) }, { note: '中'.repeat(500) + '😀' }, { occurredAt: '2099-01-01T00:00:00.000Z' },
      { occurredAt: '2026-01-02T03:04:05.001Z' }, { occurredAt: '2026-02-30T00:00:00.000Z' },
      { owner: crypto.randomUUID() }, { ownerId: crypto.randomUUID() }, { parentEntryId: crypto.randomUUID() }, { status: 'completed' },
    ]) expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry(invalid))).status).toBe(400)
    expect(await read(owner)).toMatchObject({ total: 0, version: 0 })
    const receipt = await write(owner, ordinaryEntry({ amountCents: -99999999999, accountName: '\u3000' + '😀'.repeat(50) + '\u00a0', note: '\n' + '中😀'.repeat(250) + '\t' }))
    const detail = ledgerDetailSchema.parse(await (await ledgerRequest(owner, `/api/ledger/entries/${receipt.entryId}`)).json())
    expect(detail.entry).toMatchObject({ amountCents: -99999999999, accountName: '😀'.repeat(50), note: '中😀'.repeat(250), occurredAt: '2026-01-02T03:04:05.000Z', parentEntryId: null, status: 'completed' })
    await write(owner, ordinaryEntry({ direction: 'income', amountCents: 99999999999, categoryCode: 'salary' }))
    expect(await read(owner)).toMatchObject({ total: 2, version: 2 })
  })
  it('每个请求重新鉴权与白名单、本人列表详情隔离，未交付命令和直接编辑拒绝', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const receipt = await write(owner)
    expect(await read(other)).toMatchObject({ total: 0, version: 0 })
    expect((await ledgerRequest(other, `/api/ledger/entries/${receipt.entryId}`)).status).toBe(404)
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.entryId}`, { note: '篡改' }, 'PATCH')).status).toBe(404)
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.entryId}/refunds`, {})).status).toBe(404)
    expect((await ledgerRequest(owner, `/api/ledger/entries/${receipt.entryId}/delete`, {})).status).toBe(404)
    const unauthenticated = await app.request('/api/ledger/entries', {}, ledgerEnv)
    expect(unauthenticated.status).toBe(401)
    const oldAllowed = ledgerEnv.AUTH_ALLOWED_EMAILS
    ledgerEnv.AUTH_ALLOWED_EMAILS = 'removed@example.invalid'
    try { expect((await ledgerRequest(owner)).status).toBe(403) } finally { ledgerEnv.AUTH_ALLOWED_EMAILS = oldAllowed }
    for (const query of ['?ownerId=' + other, '?page=0', '?page=1.2', '?pageSize=100']) expect((await ledgerRequest(owner, '/api/ledger/entries' + query)).status).toBe(400)
    expect(await read(owner)).toMatchObject({ total: 1, version: 1 })
  })
})
