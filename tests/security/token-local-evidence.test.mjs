import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tokenUsageContentHash } from '../../tools/token-collector/dist/src/shared/token-usage-contract.js'
import { localEvidence } from '../../scripts/token-local-evidence.mjs'

let scratch, installation
const secretSentinel = 'PRIVATE_LOCAL_VALUE_MUST_STAY_IN_STATE'
const content = {
  metrics: { input: 10, output: 0, total: 10, cacheRead: null },
  cost: { currency: 'USD', apiEstimate: null, coverage: 'unknown' },
  models: { coverage: 'complete', items: [{
    modelId: null, providerId: null, metrics: { input: 10, output: 0, total: 10, cacheRead: null },
    cost: { currency: 'USD', apiEstimate: null, coverage: 'unknown' },
  }] },
}
before(async () => {
  await mkdir('.cache', { recursive: true })
  scratch = await mkdtemp(resolve('.cache/token223-evidence-'))
  installation = join(scratch, 'install')
  await mkdir(join(installation, 'node_modules/@lifespace'), { recursive: true })
  // Test the helper against the same compiled modules as the installed archive.
  // This symlink is a test fixture, not a claim of an npm installation.
  await symlink(resolve('tools/token-collector'), join(installation, 'node_modules/@lifespace/token-collector'))
})
after(async () => { await rm(scratch, { recursive: true, force: true }) })

async function fixture() {
  const stateDir = await mkdtemp(join(scratch, 'state-'))
  const database = join(stateDir, 'state.sqlite')
  const db = new DatabaseSync(database)
  db.exec(`CREATE TABLE rollups(date TEXT,agent TEXT,generation TEXT,version TEXT,hash TEXT,snapshot TEXT);
    CREATE TABLE queue(id INTEGER PRIMARY KEY,date TEXT,agent TEXT,generation TEXT,version TEXT,hash TEXT,attempts INTEGER,next_at INTEGER,error TEXT,body TEXT);
    CREATE TABLE meta(key TEXT,value TEXT); CREATE TABLE sources(path TEXT,proof TEXT);`)
  const hash = await tokenUsageContentHash(content)
  const snapshot = {
    identity: { deviceId: 'fixture_device', date: '2026-01-01', agent: 'codex' }, content,
    metadata: { schemaVersion: 1, statisticsVersion: 'tokscale-codex-1', tool: { name: 'tokscale', version: '4.23.0' }, priceVersion: null,
      hostname: secretSentinel, scannedAt: '2026-01-02T00:00:00Z', snapshotVersion: '1' },
  }
  db.prepare('INSERT INTO rollups VALUES (?,?,?,?,?,?)').run('2026-01-01', 'codex', '1', '1', hash, JSON.stringify(snapshot))
  db.prepare('INSERT INTO queue VALUES (?,?,?,?,?,?,?,?,?,?)').run(1, '2026-01-01', 'codex', '1', '1', hash, 1, 1000, 'NETWORK_UNCONFIRMED', secretSentinel)
  db.prepare('INSERT INTO meta VALUES (?,?)').run('credential', secretSentinel)
  db.prepare('INSERT INTO sources VALUES (?,?)').run(secretSentinel, secretSentinel)
  db.close()
  await chmod(database, 0o600)
  return { stateDir, database, options: { installation, stateDir, date: '2026-01-01', modelKey: 'null' } }
}

test('exports only chosen rollup/queue descriptors and leaves SQLite byte-for-byte unchanged', async () => {
  const f = await fixture(), before = await readFile(f.database)
  const evidence = await localEvidence(f.options)
  assert.deepEqual(evidence.content, content)
  assert.equal(evidence.selectedModel.present, true)
  assert.equal(evidence.content.metrics.output, 0)
  assert.equal(evidence.content.metrics.cacheRead, null)
  assert.equal(Object.hasOwn(evidence.content.metrics, 'cacheWrite'), false)
  assert.equal(Object.hasOwn(evidence.content.cost, 'actual'), false)
  assert.equal(JSON.stringify(evidence).includes(secretSentinel), false)
  assert.equal(evidence.pending.length, 1)
  assert.equal(Object.hasOwn(evidence.pending[0], 'body'), false)
  assert.match(evidence.receiptEvidence, /not retained/)
  assert.deepEqual(await readFile(f.database), before)
})

test('absent model is reported as absent without manufacturing zero metrics', async () => {
  const f = await fixture()
  const result = await localEvidence({ ...f.options, modelKey: '"absent-model"' })
  assert.deepEqual(result.selectedModel, { modelKey: '"absent-model"', present: false })
})

test('tampered content/hash is rejected and preserved for diagnosis', async () => {
  const f = await fixture(), db = new DatabaseSync(f.database)
  db.exec("UPDATE rollups SET hash='" + '0'.repeat(64) + "'")
  db.close()
  const before = await readFile(f.database)
  await assert.rejects(localEvidence(f.options), /LOCAL_SNAPSHOT_MISMATCH/)
  assert.deepEqual(await readFile(f.database), before)
})

test('unsafe permissions and symlinked state cannot be read as evidence', async () => {
  const f = await fixture()
  await chmod(f.database, 0o644)
  await assert.rejects(localEvidence(f.options), /PRIVATE_STATE_REQUIRED/)
  const target = await fixture()
  const linked = await mkdtemp(join(scratch, 'linked-'))
  await symlink(target.database, join(linked, 'state.sqlite'))
  await assert.rejects(localEvidence({ ...target.options, stateDir: linked }), /UNSAFE_SYMLINK/)
})

test('missing date, invalid calendar date, future date and noncanonical model key reject', async () => {
  const f = await fixture()
  await assert.rejects(localEvidence({ ...f.options, date: '2026-01-02' }), /NO_LOCAL_ROLLUP/)
  await assert.rejects(localEvidence({ ...f.options, date: '2026-02-30' }), /DATE_INVALID/)
  await assert.rejects(localEvidence({ ...f.options, date: '9999-01-01' }), /COMPLETED_BEIJING/)
  await assert.rejects(localEvidence({ ...f.options, modelKey: ' null' }), /MODEL_KEY_INVALID/)
})

test('CLI failure emits a fixed code without raw paths, SQL, or private values', async () => {
  const f = await fixture(), db = new DatabaseSync(f.database)
  db.exec('DROP TABLE rollups')
  db.close()
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/token-local-evidence.mjs',
    '--installation', installation, '--state-dir', f.stateDir, '--date', '2026-01-01'], { encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(JSON.parse(result.stderr).error, 'LOCAL_EVIDENCE_UNCONFIRMED')
  for (const forbidden of [scratch, secretSentinel, 'no such table', 'SELECT']) assert.equal(result.stderr.includes(forbidden), false)
})
