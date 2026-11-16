import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import graph from '../fixtures/token-usage/tokscale-4.23.0-graph.json'
import { Store } from '../../tools/token-collector/store'
import { synchronize } from '../../tools/token-collector/collector'
import { tokscaleDiagnostics } from '../../tools/token-collector/tokscale-cli'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
}))
const dirs: string[] = [], stores: Store[] = []
afterEach(async () => {
  execute.mockReset()
  for (const store of stores.splice(0)) store.close()
  await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function profile() {
  const root = await mkdtemp(join(tmpdir(), 'token-output-')); dirs.push(root)
  const home = join(root, 'home'), state = join(root, 'state')
  await mkdir(home)
  const store = await Store.open(state); stores.push(store)
  store.set('config', { deviceId: 'synthetic-output-223', server: 'https://example.invalid/', sourceHome: home, hours: 1, loopback: false })
  store.activate({ deviceId: 'synthetic-output-223', generation: '1', uploadToken: 'a'.repeat(43),
    upload: { url: 'https://example.invalid/rest/v1/rpc/token_usage_upload', publishableKey: 'sb_publishable_synthetic', header: 'X-LifeSpace-Device-Token' } })
  return { store, state, home }
}
function result(stdout = JSON.stringify(graph), stderr = '') {
  execute.mockResolvedValueOnce({ stdout: 'tokscale 4.23.0', stderr: '' }).mockResolvedValueOnce({ stdout, stderr })
}
test('valid graph with missing-usage and unknown private stderr is accepted with redacted categories', async () => {
  const { store, state, home } = await profile()
  result(undefined, `Warning: 6 of 1157 inspected rollout files contain Codex activity but no supported usage records for the selected clients\nprivate path ${home}, synthetic-private-body\n`)
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(false)
  expect(store.status().rollups).toBe(2); expect(store.tasks()).toHaveLength(2)
  expect(store.get('scan')).toMatchObject({ diagnostics: ['TOKSCALE_DIAGNOSTIC', 'TOKSCALE_MISSING_USAGE'] })
  expect(JSON.stringify([synced, store.status(), store.tasks()])).not.toContain('synthetic-private-body')
  expect(JSON.stringify(store.status())).not.toContain(home)
  expect(execute.mock.calls[1][2]).toMatchObject({ timeout: 60000 })
})
test.each([
  ['invalid JSON', '{'],
  ['missing graph fields', '{}'],
  ['negative counter', JSON.stringify({ ...graph, summary: { ...graph.summary, totalTokens: -1 } })],
  ['non-finite counter', JSON.stringify(graph).replace(/"totalTokens":\d+/, '"totalTokens":1e999')],
  ['mismatched total', JSON.stringify({ ...graph, summary: { ...graph.summary, totalTokens: 1 } })],
  ['upstream version changed', JSON.stringify({ ...graph, meta: { ...graph.meta, version: '4.24.0' } })],
])('%s retains prior snapshots and immutable queue', async (_name, output) => {
  const { store, state } = await profile()
  result(); await synchronize(store, state, { offline: true })
  const before = store.db.prepare('SELECT * FROM rollups ORDER BY date').all(), tasks = store.tasks()
  result(output, 'synthetic-private-invalid-output')
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(true)
  expect(store.db.prepare('SELECT * FROM rollups ORDER BY date').all()).toEqual(before)
  expect(store.tasks()).toEqual(tasks)
  expect(JSON.stringify(store.status())).not.toContain('synthetic-private-invalid-output')
})
test.each(['process failure', 'timeout'])('%s never consumes private partial output or replaces prior content', async name => {
  const { store, state } = await profile()
  result(); await synchronize(store, state, { offline: true })
  const before = store.db.prepare('SELECT * FROM rollups ORDER BY date').all(), tasks = store.tasks()
  execute.mockResolvedValueOnce({ stdout: 'tokscale 4.23.0', stderr: '' })
    .mockRejectedValueOnce(Object.assign(new Error('synthetic-private-process-error'), { killed: name === 'timeout', stdout: JSON.stringify(graph), stderr: 'synthetic-private-stderr' }))
  expect((await synchronize(store, state, { offline: true })).scanFailed).toBe(true)
  expect(store.db.prepare('SELECT * FROM rollups ORDER BY date').all()).toEqual(before)
  expect(store.tasks()).toEqual(tasks)
  expect(JSON.stringify(store.status())).not.toContain('synthetic-private')
})
test('diagnostic classification is bounded to known categories, deduplicated and never returns stderr', () => {
  expect(tokscaleDiagnostics('private one\nprivate two\n')).toEqual(['TOKSCALE_DIAGNOSTIC'])
  expect(tokscaleDiagnostics(' \n')).toEqual([])
})
