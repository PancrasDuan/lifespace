import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// This gate installs real OS jobs. Never enable it on a developer/user machine.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable GitHub-hosted runner required')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted runners are not disposable')
assert.equal(process.env.TOKEN_SCHEDULER_CI, 'disposable', 'Explicit CI scheduler opt-in required')
assert(['linux', 'darwin'].includes(process.platform), 'Linux or macOS required')
const base = await realpath(process.env.RUNNER_TEMP)
const repo = await realpath('.')
const outside = relative(repo, base)
assert(outside && (outside.startsWith('../') || isAbsolute(outside)), 'Installation must be outside checkout')
const work = await mkdtemp(join(base, 'lifespace scheduler '))
const prefix = join(work, 'installed package % $'), state = join(work, 'private state % $'), source = join(work, 'synthetic source')
const label = `com.lifespace.token-ci-${randomUUID()}`
const originalLabel = 'com.lifespace.token-collector'
const kind = process.platform === 'darwin' ? 'macos' : 'linux'
const domain = `gui/${process.getuid()}`
const exec = promisify(execFile)
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: homedir(), TMPDIR: work,
  npm_config_cache: resolve('test-results/scheduler-npm-cache'),
  ...(process.platform === 'linux' ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}) }
const run = (file, args, cwd = work) => exec(file, args, { cwd, env, timeout: 120000, maxBuffer: 1024 * 1024 })
const systemctl = (...args) => run('/usr/bin/systemctl', ['--user', ...args])
const launchctl = (...args) => run('/bin/launchctl', args)
const delay = () => new Promise(r => setTimeout(r, 250))
async function until(check, description) {
  const end = Date.now() + 90000
  while (Date.now() < end) { if (await check()) return; await delay() }
  throw new Error(`Timed out: ${description}`)
}
let plan, applySchedule, installed = false, server, failure
let uploads = 0, heartbeats = 0, receiverFailure
const secret = randomBytes(32).toString('base64url')
const deviceId = 'synthetic-scheduler-221'
const evidence = { platform: process.platform, scope: 'disposable hosted CI; synthetic source and loopback receiver; not user-device or hosted Supabase acceptance', label }
async function diagnostics() {
  if (kind === 'linux') return (await systemctl('show', label + '.service', '--property=LoadState,ActiveState,SubState,Result,ExecMainStatus')).stdout.trim()
  const text = (await launchctl('print', `${domain}/${label}`)).stdout
  return text.split('\n').map(s => s.trim()).filter(s => /^(state|runs|last exit code|pid) =/.test(s))
}
try {
  // Query the real scheduler before creating any files. Missing capability fails closed.
  evidence.stage = 'query real scheduler capability'
  if (kind === 'linux') await systemctl('show-environment')
  else await launchctl('print', domain)
  evidence.stage = 'pack and install outside repository'
  const npm = join(dirname(process.execPath), 'npm')
  const packed = JSON.parse((await run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], resolve('tools/token-collector'))).stdout)[0]
  const archive = join(work, packed.filename)
  evidence.archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
  await run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', archive])
  const root = join(prefix, 'node_modules/@lifespace/token-collector/dist')
  const load = path => import(pathToFileURL(join(root, path)).href)
  const { Store } = await load('tools/token-collector/store.js')
  const scheduler = await load('tools/token-collector/schedule.js')
  const { tokenUploadSchema } = await load('src/shared/token-backend-contract.js')
  const { tokenUsageContentHash } = await load('src/shared/token-usage-contract.js')
  applySchedule = scheduler.applySchedule
  const cli = join(root, 'tools/token-collector/cli.js')
  const command = (...args) => run(process.execPath, [cli, ...args, '--state-dir', state])
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST')
      assert.equal(req.headers['x-lifespace-device-token'], secret)
      assert.equal(req.headers.apikey, 'sb_publishable_synthetic_scheduler')
      assert.equal(req.headers.authorization, undefined)
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      let receipt
      if (req.url === '/rest/v1/rpc/token_usage_upload') {
        const upload = tokenUploadSchema.parse(body), snapshot = upload.p_snapshot
        assert.equal(snapshot.identity.deviceId, deviceId)
        assert.equal(snapshot.identity.date, '2026-11-15')
        assert.equal(upload.p_hash, await tokenUsageContentHash(snapshot.content))
        assert.equal(snapshot.content.metrics.total, 12)
        assert.equal(snapshot.content.cost.actual, null)
        assert.equal(snapshot.content.cost.apiEstimate, null)
        uploads++
        receipt = { persisted: true, ...snapshot.identity, generation: upload.p_generation, snapshotVersion: snapshot.metadata.snapshotVersion,
          contentHash: upload.p_hash, result: 'replaced', receivedAt: new Date().toISOString() }
      } else {
        assert.equal(req.url, '/rest/v1/rpc/token_usage_heartbeat')
        assert.equal(body.p_device, deviceId); assert.equal(body.p_generation, '1')
        heartbeats++
        receipt = { persisted: true, deviceId, generation: '1', receivedAt: new Date().toISOString() }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(receipt))
    } catch { receiverFailure = new Error('Loopback request failed contract validation'); res.writeHead(400); res.end('{}') }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const origin = `http://127.0.0.1:${server.address().port}/`
  await mkdir(join(source, '.codex/sessions'), { recursive: true, mode: 0o700 })
  const rows = [
    { timestamp: '2026-11-15T00:00:00Z', type: 'session_meta', payload: { id: 'synthetic-scheduler-221' } },
    { timestamp: '2026-11-15T00:00:01Z', type: 'turn_context', payload: { model: 'synthetic-unpriced-scheduler' } },
    { timestamp: '2026-11-15T00:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, output_tokens: 2 }, last_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
  ]
  await writeFile(join(source, '.codex/sessions/synthetic.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
  const store = await Store.open(state)
  try {
    store.set('config', { deviceId, server: origin, sourceHome: source, hours: 1, loopback: true })
    store.activate({ deviceId, generation: '1', uploadToken: secret, upload: { url: new URL('/rest/v1/rpc/token_usage_upload', origin).href, publishableKey: 'sb_publishable_synthetic_scheduler', header: 'X-LifeSpace-Device-Token' } })
    // Freeze the price-refresh clock only, so this OS gate has no external HTTP dependencies.
    store.set('price', { at: Date.now(), result: 'synthetic CI: no price catalog' })
  } finally { store.close() }
  const initial = JSON.parse((await command('sync', '--offline')).stdout)
  assert.equal(initial.scanFailed, false); assert.equal(initial.pending, 1)
  // Use the installed CLI's exact plan and runtime installer. Only rename its
  // fixed label to avoid colliding with any other job, never alter ExecStart.
  const preview = JSON.parse((await command('timer', 'install')).stdout)
  plan = JSON.parse(JSON.stringify(preview.plan).replaceAll(originalLabel, label))
  for (const file of plan.files) assert(!file.content.includes(secret))
  installed = true // finally owns partial installs and the CI-only drop-in.
  if (kind === 'linux') {
    const dropin = join(homedir(), '.config/systemd/user', label + '.timer.d')
    await mkdir(dropin, { recursive: true, mode: 0o700 })
    await writeFile(join(dropin, 'ci.conf'), '[Timer]\nOnStartupSec=\nOnUnitActiveSec=\nOnActiveSec=1s\nAccuracySec=1us\n', { mode: 0o600 })
  }
  evidence.stage = 'install and run real OS job'
  await applySchedule(plan, true)
  if (kind === 'linux') assert.equal((await systemctl('is-enabled', label + '.timer')).stdout.trim(), 'enabled')
  await until(async () => heartbeats >= 1 && uploads === 1 || receiverFailure, 'first scheduled upload and heartbeat')
  if (receiverFailure) throw receiverFailure
  async function completed() {
    if (kind === 'linux') {
      const value = await diagnostics()
      return value.includes('ActiveState=inactive') && value.includes('Result=success') && value.includes('ExecMainStatus=0')
    }
    const text = (await diagnostics()).join('\n')
    return /last exit code = 0/.test(text) && /state = not running/.test(text)
  }
  await until(completed, 'OS process successful exit')
  evidence.firstExecution = await diagnostics()
  async function inspect() {
    const s = await Store.open(state)
    try { return { status: s.status(), rows: s.db.prepare('SELECT date,agent,generation,version,hash FROM rollups').all() } }
    finally { s.close() }
  }
  const first = await inspect()
  assert.equal(first.status.pending, 0); assert.equal(first.status.heartbeat.result, 'persisted'); assert.equal(first.rows.length, 1)
  evidence.stage = 'no-data OS run and persisted heartbeat'
  if (kind === 'linux') { await systemctl('stop', label + '.timer'); await systemctl('start', label + '.service') }
  else await launchctl('kickstart', `${domain}/${label}`)
  await until(async () => heartbeats >= 2 || receiverFailure, 'second run with no new data')
  if (receiverFailure) throw receiverFailure
  await until(completed, 'second OS process successful exit')
  const second = await inspect()
  assert.equal(uploads, 1); assert.equal(heartbeats, 2)
  assert.deepEqual(second.rows, first.rows, 'No-data run changed snapshot/version/hash')
  assert.equal(second.status.pending, 0); assert.equal(second.status.heartbeat.result, 'persisted')
  assert(second.status.heartbeat.at > first.status.heartbeat.at)
  assert.equal((await stat(state)).mode & 0o777, 0o700)
  assert.equal((await stat(join(state, 'state.sqlite'))).mode & 0o777, 0o600)
  evidence.execution = { uploads, heartbeats, pending: 0, unchangedSnapshot: true, spacesPercentDollarPaths: true, privateState: true }
  evidence.stage = 'execution passed; uninstall pending'
} catch (error) {
  evidence.failure = { code: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null, signal: error.signal ?? null }
  // Avoid printing child-process errors, request bodies, paths or credentials.
  failure = new Error(`Scheduler gate failed: ${error instanceof assert.AssertionError ? error.message.replaceAll(secret, '[redacted]') : 'OS capability, installation or execution failure'}`)
  if (installed) { try { evidence.failureState = await diagnostics() } catch { evidence.failureState = 'scheduler diagnostics unavailable' } }
} finally {
  const cleanupErrors = []
  if (installed) {
    try { await applySchedule(plan, false) } catch { cleanupErrors.push('runtime uninstall failed') }
    // Independently stop only our unique service as well: Linux uninstall stops
    // the timer, which alone would not stop an already-running oneshot.
    if (kind === 'linux') {
      try { await systemctl('stop', label + '.timer', label + '.service') } catch { cleanupErrors.push('stop failed') }
    } else {
      try {
        await launchctl('print', domain)
        try { await launchctl('print', `${domain}/${label}`); cleanupErrors.push('launchd job remains loaded') }
        catch (e) { if (!/Could not find service/.test(e.stderr ?? '')) cleanupErrors.push('launchd absence unverified') }
      } catch { cleanupErrors.push('launchd domain unavailable during cleanup') }
    }
    for (const file of plan.files) { try { await rm(file.path, { force: true }) } catch { cleanupErrors.push('unit removal failed') } }
    if (kind === 'linux') {
      try {
        await rm(join(homedir(), '.config/systemd/user', label + '.timer.d'), { recursive: true, force: true })
        try { await systemctl('reset-failed', label + '.service') } catch { /* Not failed/not loaded is normal. */ }
        await systemctl('daemon-reload')
        for (const suffix of ['.timer', '.service']) {
          let output
          try { output = (await systemctl('show', label + suffix, '--property=LoadState')).stdout }
          catch (e) { output = e.stdout ?? '' }
          assert.match(output, /^LoadState=not-found\s*$/)
        }
      } catch { cleanupErrors.push('unit unload verification failed') }
    }
    for (const file of plan.files) {
      try { await stat(file.path); cleanupErrors.push('unit file remains') } catch (e) { if (e.code !== 'ENOENT') cleanupErrors.push('file absence unverified') }
    }
  }
  if (server) await new Promise(done => server.close(done))
  await rm(work, { recursive: true, force: true })
  evidence.cleanup = cleanupErrors.length ? cleanupErrors : 'unique job stopped, unloaded and removed; private temporary installation removed'
  console.log(JSON.stringify(evidence))
  if (cleanupErrors.length) failure = new Error('Scheduler cleanup failed; see bounded diagnostics')
}
if (failure) throw failure
