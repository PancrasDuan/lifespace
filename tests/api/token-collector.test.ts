import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { Store, type Credential } from '../../tools/token-collector/store'
import { deriveDeviceId, privateDirectory } from '../../tools/token-collector/local'
import { endpoint, request, startRegistration, claimRegistration, uploadPending } from '../../tools/token-collector/transport'
import { scan } from '../../tools/token-collector/collector'
import { inventory, assessCoverage } from '../../tools/token-collector/coverage'
import { applySchedule, schedulePlan } from '../../tools/token-collector/schedule'
import { priceFingerprint, refreshPrices } from '../../tools/token-collector/prices'
import { tokenUsageContentHash, type TokenUsageSnapshot } from '../../src/shared/token-usage-contract'
import { syntheticCodexLog, syntheticUnknownModelLog } from '../fixtures/token-usage/synthetic'
import { createServer } from 'node:http'
import { zstdCompressSync } from 'node:zlib'

process.umask(0o077)
const dirs: string[] = [], stores: Store[] = [], children: ReturnType<typeof spawn>[] = []
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'exit') }
  for (const store of stores.splice(0)) store.close()
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})
async function root() { const dir = await mkdtemp(join(tmpdir(), 'token-213-')); dirs.push(dir); return dir }
async function profile() {
  const dir = await root(), state = join(dir, 'state'), home = join(dir, 'home')
  await mkdir(join(home, '.codex/sessions'), { recursive: true })
  const store = await Store.open(state); stores.push(store)
  store.set('config', { deviceId: 'synthetic-device-213', server: 'https://example.invalid/', sourceHome: home, hours: 1, loopback: false })
  return { dir, state, home, store }
}
const credential = (generation = '1'): Credential => ({ deviceId: 'synthetic-device-213', generation, uploadToken: randomBytes(32).toString('base64url'), upload: { url: 'https://example.invalid/rest/v1/rpc/token_usage_upload', publishableKey: 'sb_publishable_synthetic', header: 'X-LifeSpace-Device-Token' } })
const snapshot = (n = 130, model = 'model-a'): TokenUsageSnapshot => ({ identity: { deviceId: 'synthetic-device-213', date: '2026-11-15', agent: 'codex' }, content: { metrics: { input: n, output: 0, total: n }, cost: { currency: 'USD', coverage: 'unknown' }, models: { coverage: 'complete', items: [{ modelId: model, providerId: null, metrics: { input: n, output: 0, total: n }, cost: { currency: 'USD', coverage: 'unknown' } }] } }, metadata: { schemaVersion: 1, statisticsVersion: 'tokscale-codex-1', tool: { name: 'tokscale', version: '4.23.0' }, priceVersion: null, scannedAt: '2026-11-15T00:00:00Z' } })
async function save(store: Store, s: TokenUsageSnapshot) { store.saveScan(await store.prepareSnapshots([s]), [], new Set(), []) }
function receipt(task: ReturnType<Store['tasks']>[number]) { return { persisted: true, deviceId: 'synthetic-device-213', date: task.date, agent: task.agent, generation: task.generation, snapshotVersion: task.version, contentHash: task.hash, result: 'replaced', receivedAt: '2026-11-15T00:00:00Z' } }

test('SQLite file persists latest + immutable A→B→A, deduplicates latest only, exact receipt deletes only its task', async () => {
  const p = await profile(); p.store.activate(credential())
  await save(p.store, snapshot()); const a = p.store.tasks()[0]
  expect(p.store.acknowledge(a, receipt(a))).toBe(true)
  await save(p.store, snapshot(200)); await save(p.store, snapshot())
  expect(p.store.tasks().map(t => t.version)).toEqual(['2', '3'])
  const before = p.store.tasks(); await save(p.store, snapshot()); expect(p.store.tasks()).toEqual(before)
  p.store.retry(before[0], 'NETWORK_UNCONFIRMED', 100)
  expect(p.store.tasks()[0]).toMatchObject({ body: before[0].body, attempts: 1, next_at: 5100 })
  p.store.close(); stores.splice(stores.indexOf(p.store), 1)
  const reopened = await Store.open(p.state); stores.push(reopened)
  expect(reopened.tasks().map(t => t.body)).toEqual(before.map(t => t.body))
  expect(reopened.acknowledge(a, receipt(a))).toBe(false)
  const b = reopened.tasks()[0], latest = reopened.tasks()[1]
  for (const invalid of [{ ...receipt(latest), persisted: false }, { ...receipt(latest), deviceId: 'other' }, { ...receipt(latest), generation: '2' }, { ...receipt(latest), contentHash: 'a'.repeat(64) }, { ...receipt(latest), agent: 'other' }, { persisted: true }]) expect(reopened.acknowledge(latest, invalid)).toBe(false)
  expect(reopened.acknowledge(b, receipt(b))).toBe(true)
  expect(reopened.tasks().map(t => t.version)).toEqual(['3'])
})
test('transaction failure rolls back source checkpoint, latest and queued upload together', async () => {
  const { store } = await profile(); store.activate(credential())
  store.db.exec("CREATE TRIGGER abort_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
  const prepared = await store.prepareSnapshots([snapshot()])
  expect(() => store.saveScan(prepared, [{ path: '/synthetic', hash: 'a', size: 0, dates: [] }], new Set(), [])).toThrow()
  expect(store.dates()).toEqual([]); expect(store.sources()).toEqual([]); expect(store.get('scan')).toBeUndefined(); expect(store.tasks()).toEqual([])
})
test('invalid PostgreSQL strings cannot partially update latest state or enqueue a transport request', async () => {
  const { store } = await profile(); store.activate(credential())
  const invalid = snapshot(130, 'model\0invalid')
  await expect(save(store, invalid)).rejects.toThrow()
  expect(store.tasks()).toEqual([]); expect(store.dates()).toEqual([])
})
test('explicit new server generation restarts versions and supersedes old queue without deleting latest content', async () => {
  const { store } = await profile(); store.activate(credential()); await save(store, snapshot()); await save(store, snapshot(200))
  const old = store.tasks()[0]
  store.activate(credential('2'))
  expect(store.tasks()).toHaveLength(1); expect(store.tasks()[0]).toMatchObject({ generation: '2', version: '1' })
  expect(JSON.parse(store.tasks()[0].body).p_snapshot.content.metrics.total).toBe(200)
  expect(store.acknowledge(old, receipt(old))).toBe(false)
  await save(store, snapshot()); expect(store.tasks().map(t => t.version)).toEqual(['1', '2'])
})
test('process-held SQLite lock survives elapsed time; SIGKILL rolls back uncommitted writes and releases lock', async () => {
  const dir = await root(), state = join(dir, 'state')
  const module = 'file://' + resolve('tools/token-collector/dist/tools/token-collector/store.js')
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {Store} from ${JSON.stringify(module)}; const s=await Store.open(process.argv[1]); s.db.exec('BEGIN IMMEDIATE'); s.set('crash','uncommitted'); console.log('locked'); setInterval(()=>{},1000)`, state], { stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child)
  await Promise.race([once(child.stdout!, 'data'), once(child, 'exit').then(() => { throw new Error('Crash fixture exited before locking') })])
  await expect(Store.open(state)).rejects.toThrow('COLLECTOR_BUSY')
  child.kill('SIGKILL'); await once(child, 'exit'); children.splice(children.indexOf(child), 1)
  const store = await Store.open(state); stores.push(store)
  expect(store.get('crash')).toBeUndefined()
  expect((await stat(join(state, 'state.sqlite'))).mode & 0o777).toBe(0o600)
})
test('private directories/files reject permissive permissions, symlinks and linked sidecars', async () => {
  const dir = await root(), state = join(dir, 'state')
  await mkdir(state, { mode: 0o700 }); await chmod(state, 0o755)
  await expect(Store.open(state)).rejects.toThrow('UNSAFE_DIRECTORY_PERMISSIONS')
  await chmod(state, 0o700); await writeFile(join(dir, 'target'), 'private')
  await symlink(join(dir, 'target'), join(state, 'state.sqlite-journal'))
  await expect(Store.open(state)).rejects.toThrow('UNSAFE_SYMLINK')
  expect(await readFile(join(dir, 'target'), 'utf8')).toBe('private')
  await symlink(state, join(dir, 'linked'))
  await expect(privateDirectory(join(dir, 'linked'))).rejects.toThrow('UNSAFE_SYMLINK')
})
test('application identity is deterministic per platform and rejects unavailable/all-zero system IDs', () => {
  // Synthetic inputs generated at runtime, never real hardware identifiers.
  const raw = randomBytes(16).toString('hex'), id = deriveDeviceId(raw, 'linux')
  expect(id).toMatch(/^lsd1_[a-f0-9]{64}$/); expect(id).toBe(deriveDeviceId(raw.toUpperCase() + '\n', 'linux')); expect(id).not.toContain(raw)
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
  expect(deriveDeviceId(uuid, 'macos')).not.toBe(id)
  for (const invalid of ['', 'uninitialized', '0'.repeat(32), 'f'.repeat(32)]) expect(() => deriveDeviceId(invalid, 'linux')).toThrow()
})
test('transport refuses arbitrary HTTP, userinfo, query and redirects without forwarding credentials', async () => {
  for (const url of ['http://example.com', 'http://localhost', 'http://127.0.0.1.example.com', 'https://user:pass@example.com', 'https://example.com/?token=x']) expect(() => endpoint(url, true)).toThrow()
  expect(endpoint('http://127.0.0.1:1234', true).hostname).toBe('127.0.0.1')
  let seen = 0
  const server = createServer((_req, res) => { seen++; res.writeHead(307, { Location: 'http://127.0.0.1:1/should-not-follow' }); res.end() })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { await expect(request(new URL(`http://127.0.0.1:${(server.address() as any).port}`), '{}', { 'X-LifeSpace-Device-Token': randomBytes(32).toString('base64url') })).rejects.toThrow('REDIRECT_REJECTED'); expect(seen).toBe(1) }
  finally { await new Promise<void>(r => server.close(() => r())) }
})
test('bounded response body and credential/conflict/temporary errors are classified without echoing remote messages', async () => {
  const responses = [
    [200, 'x'.repeat(70000), 'RESPONSE_TOO_LARGE'],
    [401, JSON.stringify({ message: 'TOKEN_CREDENTIAL_INVALID', details: 'do-not-echo' }), 'TOKEN_CREDENTIAL_INVALID'],
    [409, JSON.stringify({ message: 'TOKEN_VERSION_CONFLICT' }), 'TOKEN_VERSION_CONFLICT'],
    [429, '{}', 'RATE_LIMITED'], [503, '{}', 'SERVER_TEMPORARY'],
  ] as const
  let index = 0
  const server = createServer((_req, res) => { const [code, body] = responses[index++]; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    for (const [, , code] of responses) await expect(request(new URL(`http://127.0.0.1:${(server.address() as any).port}`), '{}')).rejects.toThrow(code)
  } finally { await new Promise<void>(r => server.close(() => r())) }
})
test('registration persists before claim, pending/slow_down survives restart, terminal states do not erase existing credentials', async () => {
  const p = await profile(); const secret = randomBytes(32).toString('base64url'), id = crypto.randomUUID()
  let calls = 0, status = 'pending'
  const server = createServer((req, res) => { calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url?.endsWith('/start') ? { requestId: id, code: 'ABCDEFGH', claimSecret: secret, expiresIn: 600, interval: 5, verificationPath: '/token/devices/confirm' } : { status, interval: 5 })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  p.store.set('config', { ...p.store.config(), server: `http://127.0.0.1:${(server.address() as any).port}/`, loopback: true })
  try {
    expect(await startRegistration(p.store, p.store.config(), 'synthetic-host', 'linux', 1000)).toMatchObject({ code: 'ABCDEFGH' })
    expect(JSON.stringify(p.store.status())).not.toContain(secret)
    expect(await claimRegistration(p.store, 1000)).toMatchObject({ status: 'pending' })
    expect(await claimRegistration(p.store, 1001)).toMatchObject({ status: 'wait' }); expect(calls).toBe(2)
    status = 'slow_down'; expect(await claimRegistration(p.store, 6000)).toMatchObject({ status: 'slow_down', waitMs: 10000 })
    expect(await claimRegistration(p.store, 7000)).toMatchObject({ status: 'wait' })
    status = 'denied'; expect(await claimRegistration(p.store, 16000)).toMatchObject({ status: 'denied' })
    expect(await claimRegistration(p.store, 601001)).toMatchObject({ status: 'expired' })
  } finally { await new Promise<void>(r => server.close(() => r())) }
})

test('actual Tokscale: initial unknown prices, incremental scan and full rescan stay equal without manufacturing costs', async () => {
  const p = await profile(); await writeFile(join(p.home, '.codex/sessions/source.jsonl'), syntheticCodexLog())
  const first = await scan(p.store, p.state, { offline: true }); expect(first.blockedDates).toEqual([])
  expect(p.store.dates()).toEqual(['2026-11-14', '2026-11-15'])
  const rows = p.store.db.prepare('SELECT snapshot FROM rollups ORDER BY date').all().map(r => JSON.parse(String(r.snapshot)))
  expect(rows.map(r => r.content.metrics.total)).toEqual([130, 650]); expect(rows.every(r => r.content.cost.coverage === 'unknown')).toBe(true)
  const before = p.store.db.prepare('SELECT * FROM rollups').all()
  await scan(p.store, p.state, { offline: true }); await scan(p.store, p.state, { offline: true, rescan: true })
  expect(p.store.db.prepare('SELECT * FROM rollups').all()).toEqual(before)
})
test('actual Tokscale missing old file + larger new usage freezes affected date while safe new date advances; restoration unblocks', async () => {
  const p = await profile(), old = join(p.home, '.codex/sessions/old.jsonl')
  await writeFile(old, syntheticCodexLog()); await scan(p.store, p.state, { offline: true })
  await rm(old)
  const larger = syntheticUnknownModelLog().replace(/40/g, '4000').replace(/50/g, '4010')
  await writeFile(join(p.home, '.codex/sessions/new.jsonl'), larger)
  await writeFile(join(p.home, '.codex/sessions/safe.jsonl'), syntheticUnknownModelLog().replace(/2026-11-15/g, '2026-11-16').replace(/synthetic-unknown-206/g, 'synthetic-safe-213'))
  const result = await scan(p.store, p.state, { offline: true })
  expect(result.blockedDates).toContain('2026-11-15')
  expect(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot).toContain('650')
  expect(p.store.dates()).toContain('2026-11-16')
  await writeFile(old, syntheticCodexLog())
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBeGreaterThan(650)
})
test('actual Tokscale archive move/copy dedup; append remains safe and truncation protects stored history', async () => {
  const p = await profile(), active = join(p.home, '.codex/sessions/active.jsonl'), archive = join(p.home, '.codex/archived_sessions')
  await writeFile(active, syntheticCodexLog()); await scan(p.store, p.state, { offline: true })
  await mkdir(archive); await rename(active, join(archive, 'archive.jsonl'))
  await writeFile(join(p.home, '.codex/sessions/copy.jsonl'), syntheticCodexLog())
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(650)
  await rm(join(p.home, '.codex/sessions/copy.jsonl'))
  await writeFile(join(archive, 'archive.jsonl'), syntheticCodexLog().split('\n').slice(0, 6).join('\n') + '\n')
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toContain('2026-11-15')
})
test('malformed/unfinished tail and scan race cannot advance checkpoints or overwrite trusted totals', async () => {
  const p = await profile(), file = join(p.home, '.codex/sessions/source.jsonl')
  await writeFile(file, syntheticCodexLog()); await scan(p.store, p.state, { offline: true })
  const prior = p.store.sources(), before = await inventory(p.home)
  await writeFile(file, syntheticCodexLog() + '{"timestamp":')
  const incomplete = await scan(p.store, p.state, { offline: true })
  expect(incomplete.blockedDates).toContain('2026-11-14'); expect(p.store.sources()).toEqual(prior)
  await writeFile(file, syntheticCodexLog() + syntheticUnknownModelLog())
  const race = await assessCoverage(prior, before, await inventory(p.home), ['2026-11-14', '2026-11-15'])
  expect(race.diagnostics).toContain('SOURCE_CHANGED_DURING_SCAN')
  await writeFile(file, syntheticCodexLog()); expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
})
test('price cache correction recomputes actual CLI estimates downwards while retaining unknown buckets', async () => {
  const p = await profile(); await writeFile(join(p.home, '.codex/sessions/source.jsonl'), syntheticCodexLog())
  const cache = join(p.state, 'tokscale/cache'); await mkdir(cache, { recursive: true })
  const price = async (rate: number) => writeFile(join(cache, 'pricing-litellm.json'), JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), data: { 'gpt-5.5': { input_cost_per_token: rate, output_cost_per_token: rate } } }))
  await price(0.000002); await scan(p.store, p.state, { offline: true })
  const first = p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-14'").get()!.snapshot
  const old = JSON.parse(String(first)); expect(old.content.cost.coverage).toBe('unverified')
  const fingerprint = await priceFingerprint(join(p.state, 'tokscale'))
  await price(0.000001); await scan(p.store, p.state, { offline: true, rescan: true })
  const next = JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-14'").get()!.snapshot))
  expect(Number(next.content.cost.apiEstimate)).toBeLessThan(Number(old.content.cost.apiEstimate)); expect(next.metadata.snapshotVersion).toBe('2')
  expect(await priceFingerprint(join(p.state, 'tokscale'))).not.toBe(fingerprint)
})
test('price catalogue fingerprint ignores JSON key order and cache timestamp but detects actual catalogue corrections', async () => {
  const p = await profile(), config = join(p.state, 'tokscale'), cache = join(config, 'cache')
  await mkdir(cache, { recursive: true })
  const file = join(cache, 'pricing-litellm.json')
  await writeFile(file, JSON.stringify({ timestamp: 1, data: { b: { output_cost_per_token: 2, input_cost_per_token: 1 }, a: {} } }))
  const first = await priceFingerprint(config)
  await writeFile(file, JSON.stringify({ data: { a: {}, b: { input_cost_per_token: 1, output_cost_per_token: 2 } }, timestamp: 2 }))
  expect(await priceFingerprint(config)).toBe(first)
  await writeFile(file, JSON.stringify({ timestamp: 3, data: { a: {}, b: { input_cost_per_token: 0.5, output_cost_per_token: 2 } } }))
  expect(await priceFingerprint(config)).not.toBe(first)
})
test('actual Tokscale recognizes compressed archive/backup suffixes; disappearance cannot evade the source inventory', async () => {
  const p = await profile(), file = join(p.home, '.codex/sessions/synthetic.jsonl.deleted.fixture.zst')
  await writeFile(file, zstdCompressSync(Buffer.from(syntheticCodexLog())))
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
  expect(p.store.dates()).toEqual(['2026-11-14', '2026-11-15'])
  const archive = join(p.home, '.codex/archived_sessions'); await mkdir(archive)
  await writeFile(join(archive, 'backup.jsonl.pre-doctor-synthetic.bak'), syntheticCodexLog())
  await rm(file)
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
  await rm(join(archive, 'backup.jsonl.pre-doctor-synthetic.bak'))
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toContain('2026-11-15')
})
test('actual Tokscale fork inherited cumulative prefix contributes only the child delta', async () => {
  const p = await profile()
  const usage = (input: number, cached: number, output: number, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output })
  const cumulative = usage(116000, 114000, 1000), last = usage(73000, 72000, 500)
  const rows = [
    { timestamp: '2026-05-05T21:51:57.991Z', type: 'session_meta', payload: { id: 'synthetic-child', forked_from_id: 'synthetic-parent', source: { subagent: { thread_spawn: { parent_thread_id: 'synthetic-parent', depth: 1 } } }, model_provider: 'openai' } },
    { timestamp: '2026-05-05T21:51:57.992Z', type: 'session_meta', payload: { id: 'synthetic-parent', source: 'interactive', model_provider: 'openai' } },
    { timestamp: '2026-05-05T21:51:57.994Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: cumulative, last_token_usage: last } } },
    { timestamp: '2026-05-05T21:51:58.947Z', type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { timestamp: '2026-05-05T21:51:58.948Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: cumulative, last_token_usage: last } } },
    { timestamp: '2026-05-05T21:51:59.253Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(117500, 115000, 1200, 50), last_token_usage: usage(1500, 1000, 200, 50) } } },
  ]
  await writeFile(join(p.home, '.codex/sessions/fork.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  expect((await scan(p.store, p.state, { offline: true })).blockedDates).toEqual([])
  const s = JSON.parse(String(p.store.db.prepare('SELECT snapshot FROM rollups').get()!.snapshot))
  expect(s.content.metrics).toEqual({ input: 1500, output: 200, total: 1700, cacheRead: 1000, reasoning: 50 })
})
test('actual Tokscale mixed response and cumulative records plus archive copies count each response once', async () => {
  const p = await profile(), rows: unknown[] = [{ timestamp: '2026-11-15T00:00:00Z', type: 'session_meta', payload: { id: 'synthetic-mixed-213', model_provider: 'openai' } }]
  const usage = (input: number, output: number) => ({ input_tokens: input, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output })
  for (const [turn, input, output, totalInput, totalOutput] of [['a', 100, 10, 100, 10], ['b', 10, 2, 110, 12]] as const) {
    const timestamp = `2026-11-15T00:0${turn === 'a' ? 1 : 2}:00Z`
    rows.push({ timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: turn } },
      { timestamp, type: 'turn_context', payload: { model: 'gpt-5.5', turn_id: turn } },
      { timestamp, type: 'token_usage_record', payload: { thread_id: 'synthetic-mixed-213', turn_id: turn, response_id: 'synthetic-' + turn, usage: usage(input, output) } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(totalInput, totalOutput), last_token_usage: usage(input, output) } } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: turn } })
  }
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  await writeFile(join(p.home, '.codex/sessions/mixed.jsonl'), text)
  await mkdir(join(p.home, '.codex/archived_sessions')); await writeFile(join(p.home, '.codex/archived_sessions/mixed-copy.jsonl'), text)
  await scan(p.store, p.state, { offline: true })
  expect(JSON.parse(String(p.store.db.prepare('SELECT snapshot FROM rollups').get()!.snapshot)).content.metrics.total).toBe(122)
})
test('systemd/launchd plans use absolute paths, escape special characters, preserve config and apply idempotently in temporary HOME', async () => {
  const home = await root(), state = join(home, 'state with $cash%')
  for (const hours of [1, 3, 6, 8, 12, 24]) {
    const linux = schedulePlan('linux', state, hours, home, '/node path/node', '/install/cli.js')
    expect(linux.files[0].content).toContain('$$cash%%'); expect(linux.files[1].content).toContain(`OnUnitActiveSec=${hours}h`)
    const calls: unknown[] = []; const run = async (command: unknown) => { calls.push(command) }
    await applySchedule(linux, true, run); await applySchedule(linux, true, run)
    expect(await readFile(linux.files[0].path, 'utf8')).toBe(linux.files[0].content)
    await applySchedule(linux, false, run)
    const removed = calls.length; await applySchedule(linux, false, run); expect(calls.length).toBe(removed)
    const mac = schedulePlan('macos', state + '&', hours, home, '/node path/node', '/install/cli.js', 123)
    expect(mac.files[0].content).toContain('&amp;'); expect(mac.files[0].content).toContain(`<integer>${hours * 3600}</integer>`)
    await applySchedule(mac, true, run); const n = calls.length; await applySchedule(mac, true, run); expect(calls.length).toBe(n)
    await applySchedule(mac, false, run)
    const unloaded = calls.length; await applySchedule(mac, false, run); expect(calls.length).toBe(unloaded)
  }
})
