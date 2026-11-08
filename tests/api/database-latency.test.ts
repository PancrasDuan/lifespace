import { testDatabaseUrl } from '../support/isolated-database'
import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { queryLedger } from '../../worker/ledger-data'

const connectionString = testDatabaseUrl('WORKER_TEST_DATABASE_URL'),
  rpc = process.env.LEDGER_LOCAL_RPC_URL
describe.skipIf(!connectionString || !rpc)('隔离数据库代表性延迟比较', () => {
  it('记录当前账户和开户两条链路，不假设多语句更快', async () => {
    const env = { HYPERDRIVE: { connectionString: connectionString! } },
      owners = [crypto.randomUUID(), crypto.randomUUID()]
    const legacy = async (operation: string, owner: string, params: Record<string, unknown>) => {
      const response = await fetch(new URL('/rpc/' + operation, rpc), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, p_owner: owner }),
      })
      expect(response.status).toBe(200)
      return response.json()
    }
    const samples: Record<string, number[]> = {}
    for (const operation of ['ledger_account_create', 'ledger_accounts_list']) {
      for (let i = 0; i < 22; i++) {
        const params =
          operation === 'ledger_account_create' ? { p_input: { requestId: crypto.randomUUID(), name: '延迟 ' + i, balanceCents: 0 } } : {}
        for (const path of i % 2 === 0 ? ['pg', 'rpc'] : ['rpc', 'pg']) {
          const start = performance.now()
          if (path === 'pg') await queryLedger(env, owners[0], operation, params)
          else await legacy(operation, owners[1], params)
          if (i > 1) (samples[operation + ':' + path] ??= []).push(performance.now() - start)
        }
      }
    }
    const result = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => {
        values.sort((a, b) => a - b)
        return [name, { n: values.length, medianMs: values[10], p95Ms: values[18] }]
      })
    )
    await writeFile(
      '.cache/149-latency.json',
      JSON.stringify(
        { environment: 'loopback PostgreSQL; Node pg operations vs warm PostgREST; no remote Hyperdrive/network claim', result },
        null,
        2
      )
    )
    console.log('隔离延迟毫秒（非远端性能结论）', JSON.stringify(result))
  }, 20_000)
})
