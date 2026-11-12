// Disposable loopback-only cluster; never accepts a database URL or production data.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import pg from 'pg'
import { capture, reconcile } from './goal-migration-reconcile.mjs'

const root = resolve(import.meta.dirname, '../..')
const bin = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const run = (name, args) => {
  const result = spawnSync(bin(name), args, { env, stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} exited ${result.status}`)
}
const dir = await mkdtemp(join(tmpdir(), 'lifespace-goal-restore-'))
let client, restored, started = false
try {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  run('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start'])
  started = true
  const connect = async database => {
    const db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database, password: '', ssl: false })
    await db.connect()
    return db
  }
  client = await connect('postgres')
  await client.query('create role anon; create role authenticated; create role service_role bypassrls;')
  for (const path of ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql', 'tests/database/goal-migration-fixture.sql']) {
    await client.query(await readFile(join(root, path), 'utf8'))
  }
  const before = await capture(client, { legacy: true })
  assert.ok(before.goals.length > 0 && before.events.length > 0)
  const backup = join(dir, 'synthetic.dump')
  run('pg_dump', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-Fc', '-f', backup, 'postgres'])
  await client.query('create database restored')
  run('pg_restore', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '--exit-on-error', '-d', 'restored', backup])
  restored = await connect('restored')
  assert.deepEqual(await capture(restored, { legacy: true }), before, 'restore differs from frozen legacy facts')
  const migration = await readFile(join(root, 'db/adventure/migrations/20261111000000_goal_categories.sql'), 'utf8')
  await restored.query(migration)
  assert.deepEqual(reconcile(before, await capture(restored)), [], 'restored backup re-cleaning failed reconciliation')
  assert.equal((await restored.query("select to_regclass('public.adventure_mainlines') as table_name")).rows[0].table_name, null)
  console.log('通过：合成非空旧库备份恢复、逐行核对及恢复后重新迁移清理')
} finally {
  if (restored) await restored.end()
  if (client) await client.end()
  if (started) run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop'])
  await rm(dir, { recursive: true, force: true })
}
