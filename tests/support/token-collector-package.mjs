import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Deliberately outside the checkout, even when TMPDIR points into test-results.
const base = await realpath(process.env.TOKEN_PACKAGE_TMPDIR || '/tmp')
const fromRepo = relative(await realpath('.'), base)
assert(fromRepo && (fromRepo.startsWith('..' + '/') || isAbsolute(fromRepo)), 'Package installation must stay outside repository')
const work = await mkdtemp(join(base, 'lifespace-collector-install-'))
const npm = join(dirname(process.execPath), 'npm')
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: work, TMPDIR: work, npm_config_cache: resolve('test-results/package-npm-cache') }
const exec = promisify(execFile)
const run = (file, args, cwd = work) => exec(file, args, { cwd, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
try {
  const result = JSON.parse((await run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], resolve('tools/token-collector'))).stdout)[0]
  for (const file of result.files) assert.match(file.path, /^(?:package.json|README.md|dist\/tools\/token-collector\/[^/]+\.js|dist\/src\/shared\/token-(?:usage|backend)-contract\.js)$/)
  const archive = join(work, result.filename), prefix = join(work, 'install')
  await run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', archive])
  const packageRoot = join(prefix, 'node_modules/@lifespace/token-collector')
  const cli = join(packageRoot, 'dist/tools/token-collector/cli.js')
  assert.match((await run(process.execPath, [cli, '--help'])).stdout, /Tokscale 4.23.0/)
  // Exercise the real OS identity probe without printing its value. Synthetic
  // logs below stay separate from the user's real sources and device state.
  const identity = `import assert from 'node:assert/strict'; import {systemDeviceId} from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/tools/token-collector/local.js')).href)}; const a=await systemDeviceId();assert.match(a,/^lsd1_[a-f0-9]{64}$/);assert.equal(await systemDeviceId(),a);`
  await run(process.execPath, ['--input-type=module', '-e', identity])
  const state = join(work, 'state'), home = join(work, 'source-home')
  await mkdir(join(home, '.codex/sessions'), { recursive: true, mode: 0o700 })
  const rows = [
    { timestamp: '2026-11-15T00:00:00Z', type: 'session_meta', payload: { id: 'synthetic-pack-213' } },
    { timestamp: '2026-11-15T00:00:01Z', type: 'turn_context', payload: { model: 'synthetic-unpriced-pack' } },
    { timestamp: '2026-11-15T00:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, output_tokens: 2 }, last_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
  ]
  await writeFile(join(home, '.codex/sessions/synthetic.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
  // Run all state preparation from the installed package in a separate Node
  // process. No imports or devDependencies resolve from the repository.
  const prepare = `import {Store} from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/tools/token-collector/store.js')).href)};
    const s=await Store.open(process.argv[1]);s.set('config',{deviceId:'synthetic-pack-213',server:'https://example.invalid/',sourceHome:process.argv[2],hours:1,loopback:false});s.activate({deviceId:'synthetic-pack-213',generation:'1',uploadToken:process.argv[3],upload:{url:'https://example.invalid/rest/v1/rpc/token_usage_upload',publishableKey:'sb_publishable_synthetic',header:'X-LifeSpace-Device-Token'}});s.close();`
  // Pass random test material through stdin, never command arguments.
  const secret = randomBytes(32).toString('base64url')
  const preparation = prepare.replace('process.argv[3]', "(await import('node:fs')).readFileSync(0,'utf8')")
  await new Promise((done, reject) => {
    const child = execFile(process.execPath, ['--input-type=module', '-e', preparation, state, home], { cwd: work, env }, error => error ? reject(new Error('installed preparation failed')) : done())
    child.stdin.end(secret)
  })
  const scanned = JSON.parse((await run(process.execPath, [cli, 'sync', '--offline', '--state-dir', state])).stdout)
  assert.equal(scanned.pending, 1); assert.equal(scanned.scanFailed, false)
  const before = await readFile(join(state, 'state.sqlite'))
  const status = (await run(process.execPath, [cli, 'status', '--state-dir', state])).stdout
  assert.equal(JSON.parse(status).pending, 1); assert(!status.includes(secret)); assert(!status.includes(home))
  await run(process.execPath, [cli, 'timer', 'install', '--state-dir', state])
  await run(process.execPath, [cli, 'upgrade', '--state-dir', state, '--archive', archive, '--prefix', prefix, '--apply'])
  assert((await readFile(join(state, 'state.sqlite'))).equals(before), 'SQLite bytes changed during status/timer preview/upgrade')
  assert.equal((await stat(join(state, 'state.sqlite'))).mode & 0o777, 0o600)
  const tokscale = JSON.parse(await readFile(join(prefix, 'node_modules/@tokscale/cli/package.json'), 'utf8'))
  assert.equal(tokscale.version, '4.23.0')
  console.log(JSON.stringify({ packedFiles: result.files.length, package: '@lifespace/token-collector@0.1.0', runtimeTokscale: tokscale.version, platform: process.platform, systemIdentity: 'real read-only probe stable; value not logged', outsideRepository: true, actualScan: '12 tokens, unknown cost, one persisted pending task', upgrade: 'local archive reinstalled; SQLite byte-for-byte preserved', timer: 'plan only; no system timer installed' }))
} finally { await rm(work, { recursive: true, force: true }) }
