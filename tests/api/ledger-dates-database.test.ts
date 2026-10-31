import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ledgerPageSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

describe.skipIf(!ledgerRpc)('账单日期与版本的真实 HTTP 边界', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  it('严格拒绝非法或不完整日期、倒序范围、无效版本及重复参数，可信 owner 隔离保持有效', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry())).status).toBe(200)
    const range = 'startDate=2026-01-02&endDate=2026-01-02'
    for (const query of [
      'startDate=2026-02-30&endDate=2026-03-01', 'startDate=2023-02-29&endDate=2023-03-01',
      'startDate=0000-01-01&endDate=2026-01-01', 'startDate=2026-1-02&endDate=2026-01-02',
      'startDate=2026-01-03&endDate=2026-01-02', 'startDate=2026-01-02', 'endDate=2026-01-02',
      'startDate=&endDate=', 'version=-1', 'version=1.1', 'version=9007199254740992', 'version=',
      range + '&ownerId=' + other, range + '&startDate=2026-02-30', 'version=1&version=0',
    ]) {
      const response = await ledgerRequest(owner, '/api/ledger/entries?' + query)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } })
    }
    const response = await ledgerRequest(owner, '/api/ledger/entries?' + range + '&version=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(ledgerPageSchema.parse(await response.json())).toMatchObject({ total: 1, version: 1 })
    expect(ledgerPageSchema.parse(await (await ledgerRequest(other, '/api/ledger/entries?' + range + '&version=0')).json())).toMatchObject({ total: 0, version: 0 })
  })
  it('可选版本在空账户、筛选外写入及分页变更时均返回明确冲突且不返回旧页条目', async () => {
    const owner = crypto.randomUUID()
    for (const version of ['1', '9007199254740991']) {
      const response = await ledgerRequest(owner, '/api/ledger/entries?version=' + version)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: { code: 'LIST_CHANGED', message: '列表已更新，已返回第一页' } })
    }
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry())
    const query = '/api/ledger/entries?startDate=2026-01-02&endDate=2026-01-02'
    expect(ledgerPageSchema.parse(await (await ledgerRequest(owner, query + '&version=1')).json())).toMatchObject({ total: 1, version: 1 })
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt: '2025-12-01T00:00:00Z' }))
    const stale = await ledgerRequest(owner, query + '&page=2&version=1')
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'LIST_CHANGED' } })
    expect(ledgerPageSchema.parse(await (await ledgerRequest(owner, query)).json())).toMatchObject({ total: 1, version: 2 })
  })
})
