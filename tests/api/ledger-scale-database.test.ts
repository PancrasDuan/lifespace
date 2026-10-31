import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { ledgerPageSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc } from '../support/ledger-database'

const scaleOwner = process.env.LEDGER_SCALE_OWNER
describe.skipIf(!ledgerRpc || !scaleOwner)('单 owner 十万条合成账单：真实 Worker/PostgREST/PostgreSQL', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())
  it('首尾、深页与闰日范围稳定读取，记录实际 HTTP 耗时而不承诺性能阈值', async () => {
    const measurements: { query: string; milliseconds: number[] }[] = []
    const read = async (query: string) => {
      const start = performance.now()
      const response = await ledgerRequest(scaleOwner!, '/api/ledger/entries?' + query)
      expect(response.status).toBe(200)
      const result = ledgerPageSchema.parse(await response.json())
      const item = measurements.find(item => item.query === query)
      if (item) item.milliseconds.push(performance.now() - start)
      else measurements.push({ query, milliseconds: [performance.now() - start] })
      return result
    }
    const first = await read('page=1')
    expect(first).toMatchObject({ total: 100000, pageSize: 30, version: 100000 })
    expect(first.items[0].id).toBe('00000000-0000-4000-8000-000000100000')
    expect(first.items[29].id).toBe('00000000-0000-4000-8000-000000099971')
    const query = 'page=3334&version=100000'
    const deep = await read(query)
    expect(deep.items.map(entry => entry.id)).toEqual([
      '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000009',
      '00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000007',
      '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
    ])
    for (let index = 0; index < 4; index++) expect(await read(query)).toEqual(deep)
    const date = 'startDate=2024-02-29&endDate=2024-02-29&version=100000'
    const dateEntries = []
    for (let page = 1; page <= 8; page++) {
      const result = await read(date + '&page=' + page)
      expect(result).toMatchObject({ total: 240, version: 100000 })
      expect(result.items).toHaveLength(30)
      dateEntries.push(...result.items)
    }
    expect(new Set(dateEntries.map(entry => entry.id)).size).toBe(240)
    expect(dateEntries[0]).toMatchObject({ id: '00000000-0000-4000-8000-000000014400', occurredAt: '2024-02-29T15:00:00.000Z' })
    expect(dateEntries[239]).toMatchObject({ id: '00000000-0000-4000-8000-000000014161', occurredAt: '2024-02-28T16:00:00.000Z' })
    const dateQuery = date + '&page=8'
    const last = await read(dateQuery)
    for (let index = 0; index < 4; index++) expect(await read(dateQuery)).toEqual(last)
    expect((await read('page=3335&version=100000')).items).toEqual([])
    await writeFile(process.env.LEDGER_SCALE_HTTP_REPORT || '.cache/ledger-scale-http.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows: 100000, observations: measurements }, null, 2))
    console.info('通过：十万条真实 Worker HTTP，闰日240条完整读取与第3334页重复稳定；实测记录已写入本地报告')
  })
})
