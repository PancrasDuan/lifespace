import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

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
  const expected = JSON.parse(await readFile(resolve('tools/token-collector/package.json'), 'utf8'))
  const result = JSON.parse((await run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], resolve('tools/token-collector'))).stdout)[0]
  assert.equal(result.version, expected.version)
  for (const file of result.files) assert.match(file.path, /^(?:package.json|README.md|dist\/tools\/token-collector\/[^/]+\.js|dist\/src\/shared\/token-(?:usage|backend)-contract\.js)$/)
  const archive = join(work, result.filename), prefix = join(work, 'install')
  const release = JSON.parse(await readFile(resolve('docs/evidence/token-onboarding/package.json'), 'utf8'))
  assert.equal(result.version, release.version)
  assert.equal(result.files.length, release.files)
  assert.equal((await stat(archive)).size, release.bytes)
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), release.sha256)
  const previous = process.env.TOKEN_PACKAGE_PREVIOUS_ARCHIVE
  const initialArchive = previous ? await realpath(previous) : archive
  const initialBytes = await readFile(initialArchive)
  const previousRelease = previous ? release.previousReleases.find(item => item.sha256 === createHash('sha256').update(initialBytes).digest('hex')) : undefined
  if (previous) assert(previousRelease, 'Previous archive must match an explicitly preserved release')
  await run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', initialArchive])
  const packageRoot = join(prefix, 'node_modules/@lifespace/token-collector')
  const initialVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version
  assert.equal(initialVersion, previous ? previousRelease.version : expected.version)
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
  // Legacy source evidence survives upgrade, but the new collector neither
  // parses nor maintains it. The value is intentionally not a valid proof.
  await run(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.prepare('INSERT INTO sources VALUES (?,?)').run('/synthetic-legacy-source','synthetic-legacy-proof');db.close()`, join(state, 'state.sqlite')])
  const before = await readFile(join(state, 'state.sqlite'))
  const status = (await run(process.execPath, [cli, 'status', '--state-dir', state])).stdout
  assert.equal(JSON.parse(status).pending, 1); assert(!status.includes(secret)); assert(!status.includes(home))
  await run(process.execPath, [cli, 'timer', 'install', '--state-dir', state])
  await run(process.execPath, [cli, 'upgrade', '--state-dir', state, '--archive', archive, '--prefix', prefix, '--apply'])
  assert((await readFile(join(state, 'state.sqlite'))).equals(before), 'SQLite bytes changed during status/timer preview/upgrade')
  assert.equal(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version, expected.version)
  assert((await run(process.execPath, [cli, '--version'])).stdout.includes(`collector ${expected.version}`))
  // Exercise synthetic aggregate residues from the installed release,
  // without accessing a user graph or resolving repository modules.
  const costs = `import assert from 'node:assert/strict';import {adaptTokscaleGraph} from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/tools/token-collector/tokscale-adapter.js')).href)};
    const tokens={input:1,output:0,cacheRead:0,cacheWrite:0,reasoning:0};
    const context={deviceId:'synthetic-pack-cost',metadata:{schemaVersion:1,statisticsVersion:'tokscale-codex-1',tool:{name:'tokscale',version:'4.23.0'},priceVersion:null,scannedAt:'2030-01-03T00:00:00Z'}};
    for(const unit of [0.01,0.1,0.001]){
      const total=Array.from({length:10000},()=>unit).reduce((sum,cost)=>sum+cost,0),sum=unit*10000;
      const graph={meta:{version:'4.23.0'},summary:{totalTokens:2,totalCost:total},contributions:[{date:'2030-01-02',totals:{tokens:2,cost:total},tokenBreakdown:{...tokens,input:2},clients:[0,1].map(i=>({client:'codex',modelId:'synthetic-model-'+i,tokens,cost:sum/2,costProvenance:{kind:'estimated'}}))}]};
      assert.equal(adaptTokscaleGraph(graph,context)[0].content.models.items[0].cost.apiEstimate,String(sum/2));
      graph.contributions[0].totals.cost+=0.001;assert.throws(()=>adaptTokscaleGraph(graph,context));
    }`
  await run(process.execPath, ['--input-type=module', '-e', costs])
  const rescanned = JSON.parse((await run(process.execPath, [cli, 'sync', '--offline', '--rescan', '--state-dir', state])).stdout)
  assert.equal(rescanned.pending, 1); assert.equal(rescanned.scanFailed, false); assert.deepEqual(rescanned.scan.retainedDates, [])
  const totals = await run(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.parse(db.prepare('SELECT snapshot FROM rollups').get().snapshot).content.metrics.total);db.close()`, join(state, 'state.sqlite')])
  assert.equal(Number(totals.stdout), 12)
  await writeFile(join(home, '.codex/sessions/interrupted.jsonl'), JSON.stringify({ timestamp: '2026-11-15T00:00:00Z', type: 'response_item', payload: { type: 'message', content: [{ text: 'synthetic-private-package-warning' }] } }) + '\n')
  const warned = JSON.parse((await run(process.execPath, [cli, 'sync', '--offline', '--rescan', '--state-dir', state])).stdout)
  assert.equal(warned.scanFailed, false); assert.equal(warned.pending, 1)
  assert(warned.scan.diagnostics.includes('TOKSCALE_MISSING_USAGE'))
  assert(!JSON.stringify(warned).includes('synthetic-private-package-warning'))
  const legacy = await run(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(db.prepare('SELECT proof FROM sources WHERE path=?').get('/synthetic-legacy-source').proof);db.close()`, join(state, 'state.sqlite')])
  assert.equal(legacy.stdout.trim(), 'synthetic-legacy-proof')
  assert.equal((await stat(join(state, 'state.sqlite'))).mode & 0o777, 0o600)
  const tokscale = JSON.parse(await readFile(join(prefix, 'node_modules/@tokscale/cli/package.json'), 'utf8'))
  assert.equal(tokscale.version, '4.23.0')
  console.log(JSON.stringify({ packedFiles: result.files.length, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), package: `${expected.name}@${expected.version}`, runtimeTokscale: tokscale.version, platform: process.platform, systemIdentity: 'real read-only probe stable; value not logged', outsideRepository: true, actualScan: '12 tokens before/after upgrade, unknown cost, pending task preserved', upgrade: { from: initialVersion, to: expected.version, sqlitePreserved: true }, costResidues: 'three independent repeated-sum scenarios accepted; significant errors rejected', warnings: 'accepted/redacted; legacy source proof preserved without use', timer: 'plan only; no system timer installed' }))
} finally { await rm(work, { recursive: true, force: true }) }
