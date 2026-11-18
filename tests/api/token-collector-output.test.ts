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
  expect(JSON.parse(String(store.db.prepare("SELECT snapshot FROM rollups WHERE agent='codex' LIMIT 1").get()!.snapshot)).metadata.statisticsVersion).toBe('tokscale-multi-agent-2')
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

test('scan defaults to every Agent and honors an explicitly narrowed list', async () => {
  const { store, state } = await profile()
  result()
  await synchronize(store, state, { offline: true })
  expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['--client', 'codex,grok,hermes,claude,workbuddy,cursor']))
  store.set('config', { ...store.config(), agents: ['codex', 'grok', 'hermes'], agentsMode: 'explicit' })
  result()
  await synchronize(store, state, { offline: true })
  expect(execute.mock.calls[3][1]).toEqual(expect.arrayContaining(['--client', 'codex,grok,hermes']))
})

test('all six supported Agents can be authorized and are passed in one ordered client list', async () => {
  const { store, state } = await profile()
  const agents = ['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor']
  store.set('config', { ...store.config(), agents })
  result()
  await synchronize(store, state, { offline: true })
  expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['--client', agents.join(',')]))
})

test('an authorized Agent with no graph rows does not prevent another Agent from being saved', async () => {
  const { store, state } = await profile()
  store.set('config', { ...store.config(), agents: ['codex', 'grok'], agentsMode: 'explicit' })
  result()
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(false)
  expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['--client', 'codex,grok']))
  expect(store.dates()).toEqual(['2026-11-14', '2026-11-15'])
})

test('a successful empty graph does not manufacture zero snapshots', async () => {
  const { store, state } = await profile()
  result(JSON.stringify({
    meta: { version: '4.23.0' }, summary: { totalTokens: 0, totalCost: 0 }, contributions: [],
  }))
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(false)
  expect(store.dates()).toEqual([])
  expect(store.tasks()).toEqual([])
})

test('unexpected upstream Agent is rejected before it can be saved', async () => {
  const { store, state } = await profile()
  store.set('config', { ...store.config(), agents: ['codex'], agentsMode: 'explicit' })
  const grokOnly = structuredClone(graph)
  for (const day of grokOnly.contributions) for (const row of day.clients) row.client = 'grok'
  result(JSON.stringify(grokOnly))
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(true)
  expect(store.dates()).toEqual([])
  expect(store.tasks()).toEqual([])
})

test('only authorized Agent roots are exposed to the CLI environment', async () => {
  const { store, state } = await profile()
  store.set('config', { ...store.config(), agents: ['grok'], agentsMode: 'explicit' })
  const grokOnly = structuredClone(graph)
  for (const day of grokOnly.contributions) for (const row of day.clients) row.client = 'grok'
  result(JSON.stringify(grokOnly))
  await synchronize(store, state, { offline: true })
  const env = execute.mock.calls[1][2].env as Record<string, string>
  expect(env.GROK_HOME).toContain('.grok')
  expect(env.CODEX_HOME).toBeUndefined()
  expect(env.HERMES_HOME).toBeUndefined()
})

test('Claude, WorkBuddy and Cursor rely on --home and never receive extra root variables', async () => {
  const { store, state } = await profile()
  store.set('config', { ...store.config(), agents: ['claude', 'workbuddy', 'cursor'], agentsMode: 'explicit' })
  result(JSON.stringify({
    meta: { version: '4.23.0' }, summary: { totalTokens: 0, totalCost: 0 }, contributions: [],
  }))
  await synchronize(store, state, { offline: true })
  const env = execute.mock.calls[1][2].env as Record<string, string>
  expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
  expect(env.WORKBUDDY_HOME).toBeUndefined()
  expect(env.CURSOR_HOME).toBeUndefined()
  expect(env.CODEX_HOME).toBeUndefined()
  expect(env.GROK_HOME).toBeUndefined()
  expect(env.HERMES_HOME).toBeUndefined()
  expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['--home', expect.any(String), '--client', 'claude,workbuddy,cursor']))
})

test('Cursor cache warnings are reduced to a fixed diagnostic without the cache path', async () => {
  const { store, state, home } = await profile()
  store.set('config', { ...store.config(), agents: ['cursor'], agentsMode: 'explicit' })
  const cache = join(home, '.config/tokscale/cursor-cache/usage*.json')
  result(JSON.stringify({
    meta: { version: '4.23.0' }, summary: { totalTokens: 0, totalCost: 0 }, contributions: [],
  }), `  Warning: Cursor usage requires Tokscale's Cursor API cache at \`${cache}\`; run \`tokscale cursor login\` (auto-detects Cursor desktop when signed in) and \`tokscale cursor sync --json\`, or populate that cache before running a report with --home. Tokscale does not parse local \`~/.cursor\` session data.\n`)
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(false)
  expect(synced.scan.diagnostics).toEqual(['TOKSCALE_CURSOR_CACHE_UNAVAILABLE'])
  expect(JSON.stringify([synced, store.status()])).not.toContain(home)
})

test('an empty Cursor cache keeps the prior rollup and creates no zero snapshot', async () => {
  const { store, state } = await profile()
  store.set('config', { ...store.config(), agents: ['cursor'], agentsMode: 'explicit' })
  const cursorGraph = structuredClone(graph)
  for (const day of cursorGraph.contributions) for (const row of day.clients) row.client = 'cursor'
  result(JSON.stringify(cursorGraph))
  await synchronize(store, state, { offline: true })
  const before = store.db.prepare('SELECT * FROM rollups ORDER BY date').all(), tasks = store.tasks()
  result(JSON.stringify({
    meta: { version: '4.23.0' }, summary: { totalTokens: 0, totalCost: 0 }, contributions: [],
  }), "  Warning: Cursor usage requires Tokscale's Cursor API cache at `/private/synthetic/cursor-cache/usage*.json`; run `tokscale cursor login` and `tokscale cursor sync --json`.\n")
  const synced = await synchronize(store, state, { offline: true })
  expect(synced.scanFailed).toBe(false)
  expect('retainedDates' in synced.scan ? synced.scan.retainedDates : null).toEqual(['2026-11-14', '2026-11-15'])
  expect(synced.scan.diagnostics).toEqual(['TOKSCALE_CURSOR_CACHE_UNAVAILABLE', 'GRAPH_DAY_ABSENT'])
  expect(store.db.prepare('SELECT * FROM rollups ORDER BY date').all()).toEqual(before)
  expect(store.tasks()).toEqual(tasks)
})
