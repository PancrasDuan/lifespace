// Tests the actual preview entrypoint in a disposable source/runtime directory.
// No hosted project, credentials, pre-existing cluster or acceptance port used.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '../..')
const scratch = await mkdtemp(join(tmpdir(), 'lifespace-preview-check-'))
const source = join(scratch, 'source'), runtime = join(scratch, 'runtime')
let preserveScratch = false
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !/SUPABASE|ADVENTURE_/.test(key)))
const bin = name => join(process.env.POSTGRES_BIN || join(root, '.cache/recurring-tools/bin'), name)
const report = { sourceSha256: createHash('sha256').update(await readFile(join(root, 'tests/support/start-recurring-preview.mjs'))).digest('hex'), scenarios: [] }
const freePort = async () => {
  const s = createServer().listen(0, '127.0.0.1'); await once(s, 'listening')
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port
}
const waitUntil = async check => {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(2) }
  throw new Error('preview lifecycle condition timed out')
}
const readOptional = path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT' || error.code === 'ESRCH') return ''; throw error })
const closedPort = async port => {
  const socket = await import('node:net')
  await new Promise((resolve, reject) => {
    const c = socket.connect({ host: '127.0.0.1', port })
    c.once('connect', () => { c.destroy(); reject(new Error(`port ${port} remains open`)) })
    c.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error))
  })
}
const noDirectories = async () => assert.deepEqual(await readdir(runtime), [], 'temporary cluster directory remains')
const cleanOwnClusters = async () => {
  for (const name of await readdir(runtime)) {
    const directory = join(runtime, name)
    const pid = await readOptional(join(directory, 'postmaster.pid'))
    if (pid) {
      const result = spawnSync(bin('pg_ctl'), ['-D', directory, '-m', 'fast', '-w', 'stop'], { env, encoding: 'utf8' })
      if (result.status !== 0) preserveScratch = true
      assert.equal(result.status, 0, 'failed to stop only this validator\'s cluster')
    }
    await rm(directory, { recursive: true, force: true })
  }
}
try {
  await mkdir(source); await mkdir(runtime)
  for (const path of ['package.json', 'index.html', 'src', 'worker', 'db/adventure', 'scripts/build-adventure-recurring-install.mjs', 'tests/support/start-recurring-preview.mjs', 'tests/support/planning-database.ts', 'tests/support/cloudflare-workers.ts']) {
    await mkdir(resolve(source, path, '..'), { recursive: true })
    await cp(join(root, path), join(source, path), { recursive: true })
  }
  await symlink(join(root, 'node_modules'), join(source, 'node_modules'), 'dir')
  for (const mode of ['startup-SIGTERM', 'startup-SIGINT', 'ready-SIGTERM', 'ready-SIGINT', 'occupied-port']) {
    const port = await freePort(), metadata = join(source, `.cache/201-preview-${port}.json`)
    let blocker
    if (mode === 'occupied-port') { blocker = createServer().listen(port, '127.0.0.1'); await once(blocker, 'listening') }
    let output = '', child, outcome
    try {
      child = spawn(process.execPath, ['tests/support/start-recurring-preview.mjs'], {
        cwd: source, env: { ...env, TMPDIR: runtime, PLAYWRIGHT_PORT: String(port), POSTGRES_BIN: bin('.'), POSTGREST_BIN: process.env.POSTGREST_BIN || join(root, '.cache/recurring-tools/postgrest') },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const exited = once(child, 'exit')
      child.stdout.on('data', value => { output += value }); child.stderr.on('data', value => { output += value })
      const boundedExit = () => Promise.race([exited, delay(15000, undefined, { ref: false }).then(() => { throw new Error('preview did not exit after cancellation') })])
      if (mode.startsWith('startup-')) {
        const cluster = await waitUntil(async () => {
          assert.equal(child.exitCode, null, output)
          for (const name of await readdir(runtime)) {
            const directory = join(runtime, name), text = await readOptional(join(directory, 'postmaster.pid')), fields = text.split('\n')
            if (fields[7]?.trim() !== 'ready') continue
            const children = (await readOptional(`/proc/${child.pid}/task/${child.pid}/children`)).trim().split(/\s+/).filter(Boolean)
            const commands = await Promise.all(children.map(pid => readOptional(`/proc/${pid}/comm`)))
            if (commands.some(command => command.trim() === 'pg_ctl')) continue
            assert.equal(await readOptional(metadata), '', 'startup trigger missed pre-READY window')
            return { directory, pgPort: Number(fields[3]) }
          }
        })
        child.kill(mode.slice('startup-'.length))
        const [code, signal] = await boundedExit()
        const directoryExists = !!await readOptional(join(cluster.directory, 'PG_VERSION'))
        outcome = { mode, trigger: 'PG ready and pg_ctl returned, before preview READY', childExit: code, signal, directoryExists }
        console.log(JSON.stringify(outcome))
        assert.equal(code, 0); assert.equal(signal, null); assert.equal(directoryExists, false)
        await closedPort(cluster.pgPort); await closedPort(port); await noDirectories()
      } else if (mode.startsWith('ready-')) {
        const state = await waitUntil(async () => {
          assert.equal(child.exitCode, null, output)
          const raw = await readOptional(metadata); return raw && JSON.parse(raw)
        })
        const request = async (path, body) => {
          const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Adventure-Client-Version': 'recurring-1' }, body: body ? JSON.stringify(body) : undefined })
          assert.equal(r.status, 200, await r.clone().text()); return r.json()
        }
        const page = await request('/api/adventure')
        const list = await request('/api/adventure/recurring/list', { expectedVersion: page.version, today: page.today, date: page.today })
        await request('/api/adventure/commands', { expectedVersion: page.version, requestId: crypto.randomUUID(), command: { type: 'recordRecurringCompletion', id: list.parents[0].id, today: page.today } })
        const after = await request('/api/adventure')
        assert.equal(after.growth.totalXp, 2); assert.deepEqual(after.todayTaskProgress, { completed: 2, total: 3, ratio: 2 / 3 })
        child.kill(mode.slice('ready-'.length))
        const [code, signal] = await boundedExit()
        assert.equal(code, 0); assert.equal(signal, null)
        for (const p of [port, state.pgPort, state.rpcPort]) await closedPort(p)
        await noDirectories()
        outcome = { mode, childExit: code, signal, realWorkerRecordXp: 2, allPortsClosed: true, directoriesRemoved: true }
      } else {
        const [code, signal] = await boundedExit()
        assert.equal(code, 1); assert.equal(signal, null); assert.match(output, /EADDRINUSE/)
        await noDirectories()
        outcome = { mode, expectedChildExit: code, signal, directoriesRemoved: true }
      }
      report.scenarios.push({ ...outcome, passed: true })
    } catch (error) {
      report.scenarios.push({ ...outcome, mode, passed: false, error: error.message })
      console.error(`FAIL ${mode}: ${error.message}`)
      process.exitCode = 1
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit') }
      if (blocker) await new Promise(resolve => blocker.close(resolve))
      await cleanOwnClusters()
    }
  }
  console.log(`Preview lifecycle: ${report.scenarios.filter(x => x.passed).length}/${report.scenarios.length} passed`)
} finally {
  await mkdir(join(root, '.cache'), { recursive: true })
  await writeFile(join(root, process.argv[2] || '.cache/recurring-preview-lifecycle-report.json'), JSON.stringify(report, null, 2) + '\n')
  if (!preserveScratch) await rm(scratch, { recursive: true, force: true })
}
