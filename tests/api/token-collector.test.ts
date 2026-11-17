import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { configSchema, Store, type Credential } from '../../tools/token-collector/store'
import { deriveDeviceId, privateDirectory, requireNode24, systemDeviceId } from '../../tools/token-collector/local'
import { endpoint, request, startRegistration, claimRegistration, uploadPending } from '../../tools/token-collector/transport'
import { scan, synchronize } from '../../tools/token-collector/collector'
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
const snapshot = (n = 130, model = 'model-a'): TokenUsageSnapshot => ({ identity: { deviceId: 'synthetic-device-213', date: '2026-11-15', agent: 'codex' }, content: { metrics: { input: n, output: 0, total: n }, cost: { currency: 'USD', coverage: 'unknown' }, models: { coverage: 'complete', items: [{ modelId: model, providerId: null, metrics: { input: n, output: 0, total: n }, cost: { currency: 'USD', coverage: 'unknown' } }] } }, metadata: { schemaVersion: 1, statisticsVersion: 'tokscale-multi-agent-1', tool: { name: 'tokscale', version: '4.23.0' }, priceVersion: null, scannedAt: '2026-11-15T00:00:00Z' } })
async function save(store: Store, s: TokenUsageSnapshot) { store.saveScan(await store.prepareSnapshots([s]), []) }
function receipt(task: ReturnType<Store['tasks']>[number]) { return { persisted: true, deviceId: 'synthetic-device-213', date: task.date, agent: task.agent, generation: task.generation, snapshotVersion: task.version, contentHash: task.hash, result: 'replaced', receivedAt: '2026-11-15T00:00:00Z' } }

test('collector keeps its tested stable Node24 runtime boundary', () => {
  for (const version of ['24.22.1', '24.23.0', '24.99.0']) expect(() => requireNode24(version)).not.toThrow()
  for (const version of ['22.22.0', '24.0.0', '24.18.0', '24.20.0', '24.22.0', '25.0.0', '24.22.1-rc.1', 'invalid']) expect(() => requireNode24(version)).toThrow('NODE_24_22_1_REQUIRED')
})
test('legacy config without agents reads as codex; invalid or duplicate authorization is rejected', async () => {
  const p = await profile()
  p.store.set('config', { deviceId: 'synthetic-device-213', server: 'https://example.invalid/', sourceHome: p.home, hours: 1, loopback: false })
  expect(p.store.config().agents).toEqual(['codex'])
  expect(p.store.status().agents).toEqual(['codex'])
  for (const agents of [[], ['codex', 'codex'], ['future']]) {
    expect(configSchema.safeParse({ ...p.store.config(), agents }).success).toBe(false)
  }
  expect(configSchema.safeParse({ ...p.store.config(), agents: ['codex', 'grok', 'hermes'] }).success).toBe(true)
})
test('multi-Agent rollups keep same model and date separate by agent', async () => {
  const p = await profile()
  const grok = { ...snapshot(130), identity: { ...snapshot().identity, agent: 'grok' as const } }
  await save(p.store, snapshot())
  await save(p.store, grok)
  expect(p.store.rollupKeys()).toEqual([{ date: '2026-11-15', agent: 'codex' }, { date: '2026-11-15', agent: 'grok' }])
  expect(p.store.tasks()).toHaveLength(0)
  p.store.activate(credential())
  await save(p.store, grok)
  expect(p.store.tasks().map(task => [task.date, task.agent, task.version])).toEqual([
    ['2026-11-15', 'codex', '1'], ['2026-11-15', 'grok', '1'],
  ])
})
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
test('transaction failure rolls back latest, queued upload and diagnostics together', async () => {
  const { store } = await profile(); store.activate(credential())
  store.db.exec("CREATE TRIGGER abort_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
  const prepared = await store.prepareSnapshots([snapshot()])
  expect(() => store.saveScan(prepared, [])).toThrow()
  expect(store.dates()).toEqual([]); expect(store.get('scan')).toBeUndefined(); expect(store.tasks()).toEqual([])
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
test('backoff of an older immutable task prevents a newer same-key version from overtaking it', async () => {
  const p = await profile(); const sent: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()), upload = req.url?.endsWith('token_usage_upload')
    if (upload) sent.push(body.p_snapshot.metadata.snapshotVersion)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(upload ? { persisted: true, ...body.p_snapshot.identity, generation: body.p_generation, snapshotVersion: body.p_snapshot.metadata.snapshotVersion, contentHash: body.p_hash, result: 'replaced', receivedAt: '2026-11-15' } : { persisted: true, deviceId: body.p_device, generation: body.p_generation, receivedAt: '2026-11-15' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  p.store.set('config', { ...p.store.config(), loopback: true })
  p.store.activate({ ...credential(), upload: { ...credential().upload, url: `http://127.0.0.1:${(server.address() as any).port}/rest/v1/rpc/token_usage_upload` } })
  try {
    await save(p.store, snapshot()); p.store.retry(p.store.tasks()[0], 'NETWORK_UNCONFIRMED', 1000)
    await save(p.store, snapshot(200))
    expect((await uploadPending(p.store, 'synthetic-host', 1001)).uploaded).toBe(0); expect(sent).toEqual([])
    expect((await uploadPending(p.store, 'synthetic-host', 7000)).pending).toBe(0); expect(sent).toEqual(['1', '2'])
  } finally { await new Promise<void>(r => server.close(() => r())) }
})

test('actual Tokscale: initial unknown prices, incremental scan and full rescan stay equal without manufacturing costs', async () => {
  const p = await profile(); await writeFile(join(p.home, '.codex/sessions/source.jsonl'), syntheticCodexLog())
  const first = await scan(p.store, p.state, { offline: true }); expect(first.retainedDates).toEqual([])
  expect(p.store.dates()).toEqual(['2026-11-14', '2026-11-15'])
  const rows = p.store.db.prepare('SELECT snapshot FROM rollups ORDER BY date').all().map(r => JSON.parse(String(r.snapshot)))
  expect(rows.map(r => r.content.metrics.total)).toEqual([130, 650]); expect(rows.every(r => r.content.cost.coverage === 'unknown')).toBe(true)
  const before = p.store.db.prepare('SELECT * FROM rollups').all()
  await scan(p.store, p.state, { offline: true }); await scan(p.store, p.state, { offline: true, rescan: true })
  expect(p.store.db.prepare('SELECT * FROM rollups').all()).toEqual(before)
})
test('actual Tokscale accepts corrected lower totals and removes models while retaining absent dates', async () => {
  const p = await profile(), file = join(p.home, '.codex/sessions/source.jsonl')
  p.store.activate(credential())
  await writeFile(file, syntheticCodexLog() + syntheticUnknownModelLog())
  await scan(p.store, p.state, { offline: true })
  const before = p.store.tasks(), oldDay = p.store.db.prepare("SELECT * FROM rollups WHERE date='2026-11-14'").get()
  await writeFile(file, syntheticUnknownModelLog())
  const result = await scan(p.store, p.state, { offline: true, rescan: true })
  expect(result.retainedDates).toEqual(['2026-11-14'])
  expect(result.diagnostics).toContain('GRAPH_DAY_ABSENT')
  expect(p.store.db.prepare("SELECT * FROM rollups WHERE date='2026-11-14'").get()).toEqual(oldDay)
  const latest = JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot))
  expect(latest.content.metrics.total).toBe(50)
  expect(latest.content.models.items.map((item: { modelId: string | null }) => item.modelId)).toEqual([null])
  expect(latest.metadata.snapshotVersion).toBe('2')
  expect(p.store.tasks().slice(0, before.length)).toEqual(before)
  const assigned = p.store.tasks()
  await scan(p.store, p.state, { offline: true, rescan: true })
  expect(p.store.tasks()).toEqual(assigned)
  await rm(file)
  expect((await scan(p.store, p.state, { offline: true, rescan: true })).retainedDates).toEqual(['2026-11-14', '2026-11-15'])
  expect(p.store.tasks()).toEqual(assigned)
})
test('actual Tokscale warnings and an unfinished active tail do not block valid recorded usage', async () => {
  const p = await profile(), file = join(p.home, '.codex/sessions/source.jsonl')
  await writeFile(file, syntheticCodexLog())
  await writeFile(join(p.home, '.codex/sessions/interrupted.jsonl'), JSON.stringify({ timestamp: '2026-11-15T00:00:00Z', type: 'response_item', payload: { type: 'message', content: [{ text: 'synthetic-private-text' }] } }) + '\n')
  const result = await scan(p.store, p.state, { offline: true })
  expect(result.diagnostics).toContain('TOKSCALE_MISSING_USAGE')
  expect(p.store.dates()).toEqual(['2026-11-14', '2026-11-15'])
  expect(JSON.stringify(p.store.status())).not.toContain('synthetic-private-text')
  await writeFile(file, syntheticCodexLog() + syntheticUnknownModelLog() + '{"timestamp":')
  await scan(p.store, p.state, { offline: true, rescan: true })
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(700)
  expect(p.store.db.prepare('SELECT count(*) n FROM sources').get()!.n).toBe(0)
})
test('actual Tokscale owns archive-copy dedup and accepts normal appended usage', async () => {
  const p = await profile(), active = join(p.home, '.codex/sessions/active.jsonl'), archive = join(p.home, '.codex/archived_sessions')
  await writeFile(active, syntheticCodexLog()); await scan(p.store, p.state, { offline: true })
  await mkdir(archive); await rename(active, join(archive, 'archive.jsonl'))
  await writeFile(active, syntheticCodexLog())
  await scan(p.store, p.state, { offline: true })
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(650)
  await writeFile(join(archive, 'archive.jsonl'), syntheticCodexLog() + syntheticUnknownModelLog())
  await scan(p.store, p.state, { offline: true })
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(700)
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
test('actual Tokscale owns compressed archive/backup decoding without collector source proofs', async () => {
  const p = await profile(), file = join(p.home, '.codex/sessions/synthetic.jsonl.deleted.fixture.zst')
  await writeFile(file, zstdCompressSync(Buffer.from(syntheticCodexLog())))
  await scan(p.store, p.state, { offline: true })
  expect(p.store.dates()).toEqual(['2026-11-14', '2026-11-15'])
  await writeFile(file, zstdCompressSync(Buffer.from(syntheticCodexLog() + syntheticUnknownModelLog())))
  await scan(p.store, p.state, { offline: true })
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(700)
  const archive = join(p.home, '.codex/archived_sessions'); await mkdir(archive)
  await writeFile(join(archive, 'backup.jsonl.pre-doctor-synthetic.bak'), syntheticCodexLog() + syntheticUnknownModelLog())
  await rm(file)
  await scan(p.store, p.state, { offline: true })
  expect(JSON.parse(String(p.store.db.prepare("SELECT snapshot FROM rollups WHERE date='2026-11-15'").get()!.snapshot)).content.metrics.total).toBe(700)
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
  expect((await scan(p.store, p.state, { offline: true })).retainedDates).toEqual([])
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
    await applySchedule(mac, true, run); const written = await readFile(mac.files[0].path, 'utf8')
    await applySchedule(mac, true, run); expect(await readFile(mac.files[0].path, 'utf8')).toBe(written)
    await applySchedule(mac, false, run)
    const unloaded = calls.length; await applySchedule(mac, false, run); expect(calls.length).toBe(unloaded)
  }
})
test('launchd bootstrap failure is retried even when the written plist is unchanged', async () => {
  const home = await root(), plan = schedulePlan('macos', join(home, 'state'), 1, home, '/node', '/cli.js', 123)
  let loaded = false, attempts = 0
  const execute = async (command: { args: string[] }) => {
    if (command.args[0] === 'print' && !loaded) throw new Error('not loaded')
    if (command.args[0] === 'bootout') loaded = false
    if (command.args[0] === 'bootstrap') { attempts++; if (attempts === 1) throw new Error('synthetic bootstrap failure'); loaded = true }
  }
  await expect(applySchedule(plan, true, execute)).rejects.toThrow('synthetic bootstrap failure')
  await applySchedule(plan, true, execute)
  expect(loaded).toBe(true); expect(attempts).toBe(2)
})
test('launchd configuration update recovers after plist write interruption and failed unload of the previous interval', async () => {
  const home = await root(), state = join(home, 'state')
  const old = schedulePlan('macos', state, 1, home, '/node', '/cli.js', 123), next = schedulePlan('macos', state, 3, home, '/node', '/cli.js', 123)
  let loadedSeconds = 0, failUnload = false
  const execute = async (command: { args: string[] }) => {
    if (command.args[0] === 'print' && !loadedSeconds) throw new Error('not loaded')
    if (command.args[0] === 'bootout') { if (failUnload) throw new Error('synthetic unload failure'); loadedSeconds = 0 }
    if (command.args[0] === 'bootstrap') {
      if (loadedSeconds) throw new Error('old job still loaded')
      const content = await readFile(next.files[0].path, 'utf8')
      loadedSeconds = Number(/StartInterval<\/key><integer>(\d+)/.exec(content)![1])
    }
  }
  await applySchedule(old, true, execute); expect(loadedSeconds).toBe(3600)
  // Simulate a crash after the new plist was written, before old job unload.
  await writeFile(next.files[0].path, next.files[0].content)
  await applySchedule(next, true, execute); expect(loadedSeconds).toBe(10800)
  await applySchedule(old, true, execute); expect(loadedSeconds).toBe(3600)
  failUnload = true
  await expect(applySchedule(next, true, execute)).rejects.toThrow('old job still loaded')
  expect(loadedSeconds).toBe(3600)
  failUnload = false
  await applySchedule(next, true, execute); expect(loadedSeconds).toBe(10800)
})


test('CLI init --replace retains configured custom source home during reauthorization', async () => {
  const dir = await root(), state = join(dir, 'state'), custom = join(dir, 'custom-source')
  await mkdir(custom, { mode: 0o700 })
  const server = createServer((req, res) => {
    if (req.url !== '/api/token/registrations/start') { res.writeHead(404); res.end(); return }
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000219', code: 'ABCDEFGH', claimSecret: randomBytes(32).toString('base64url'), expiresIn: 600, interval: 5, verificationPath: '/token/devices/confirm' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  try {
    const before = await Store.open(state)
    before.set('config', { deviceId: await systemDeviceId(), server: `http://127.0.0.1:${port}/`, sourceHome: custom, hours: 3, loopback: true }); before.close()
    const result = await promisify(execFile)(process.execPath, [resolve('tools/token-collector/dist/tools/token-collector/cli.js'), 'init', '--replace', '--test-loopback', '--state-dir', state], { timeout: 10000 })
    expect(JSON.parse(result.stdout)).toMatchObject({ code: 'ABCDEFGH' })
    const after = await Store.open(state); stores.push(after)
    expect(after.config().sourceHome).toBe(custom); expect(after.config().hours).toBe(3)
    expect(after.get('registration')).toMatchObject({ requestId: '00000000-0000-4000-8000-000000000219' })
  } finally { await new Promise<void>(r => server.close(() => r())) }
})

test('CLI init --agents, sources list/add and upgrade scope stay explicit and idempotent', async () => {
  const dir = await root(), state = join(dir, 'state'), home = join(dir, 'source')
  await mkdir(join(home, '.codex', 'sessions'), { recursive: true })
  const server = createServer((req, res) => {
    if (req.url !== '/api/token/registrations/start') { res.writeHead(404); res.end(); return }
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000233', code: 'ABCDEFGH', claimSecret: randomBytes(32).toString('base64url'), expiresIn: 600, interval: 5, verificationPath: '/token/devices/confirm' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const cli = resolve('tools/token-collector/dist/tools/token-collector/cli.js')
  const run = (...args: string[]) => promisify(execFile)(process.execPath, [cli, ...args, '--state-dir', state], { timeout: 10000 })
  try {
    await run('init', '--server', `http://127.0.0.1:${port}/`, '--source-home', home, '--agents', 'codex,grok', '--test-loopback')
    const opened = await Store.open(state); stores.push(opened)
    expect(opened.config().agents).toEqual(['codex', 'grok'])
    opened.close(); stores.splice(stores.indexOf(opened), 1)

    expect(JSON.parse((await run('sources', 'list')).stdout).agents).toEqual(['codex', 'grok'])
    const added = JSON.parse((await run('sources', 'add', '--agents', 'hermes,grok')).stdout)
    expect(added).toMatchObject({ agents: ['codex', 'grok', 'hermes'], added: ['hermes'] })
    expect(JSON.parse((await run('sources', 'add', '--agents', 'grok')).stdout)).toMatchObject({ agents: ['codex', 'grok', 'hermes'], added: [] })
    await expect(run('sources', 'add', '--agents', 'future')).rejects.toMatchObject({ stderr: expect.stringContaining('AGENTS_INVALID') })
    await expect(run('sources', 'add', '--agents', 'hermes,hermes')).rejects.toMatchObject({ stderr: expect.stringContaining('AGENTS_INVALID') })
    await expect(run('sources', 'add')).rejects.toMatchObject({ stderr: expect.stringContaining('AGENTS_REQUIRED') })

    // Reauthorization and a plain software upgrade must not expand or reset sources.
    await run('init', '--replace', '--test-loopback')
    const reopened = await Store.open(state); stores.push(reopened)
    expect(reopened.config().agents).toEqual(['codex', 'grok', 'hermes'])
    expect(reopened.config().sourceHome).toBe(home)
    expect(reopened.status().agents).toEqual(['codex', 'grok', 'hermes'])
    reopened.close(); stores.splice(stores.indexOf(reopened), 1)
    const help = (await run('--help')).stdout
    expect(help).toContain('sources add --agents grok,hermes')
    expect(help).toContain('Default Agent source is codex')
  } finally { await new Promise<void>(r => server.close(() => r())) }
})
