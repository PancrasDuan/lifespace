// Always start a new loopback-only cluster; never accept an existing database URL.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'
import assert from 'node:assert/strict'
import { capture, reconcile, validateMappings } from './goal-migration-reconcile.mjs'

const root = resolve(import.meta.dirname, '../..')
const migrationIndex = process.argv.indexOf('--migration')
if (migrationIndex !== -1 && !process.argv[migrationIndex + 1]) throw new Error('--migration requires a SQL file')
const migrationPath = migrationIndex === -1 ? null : resolve(process.argv[migrationIndex + 1])
const causeIndex = process.argv.indexOf('--task-end-cause')
if (causeIndex !== -1 && !process.argv[causeIndex + 1]) throw new Error('--task-end-cause requires a value')
const taskEndCause = causeIndex === -1 ? 'historical_ended' : process.argv[causeIndex + 1]
const dir = await mkdtemp(join(tmpdir(), 'lifespace-goal-baseline-'))
const bin = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`)
}
const schemaSnapshot = async db => (await db.query(`
  select jsonb_build_object(
    'columns', (select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by c.relname,a.attnum)
      from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\' and c.relkind='r'),
    'constraints', (select jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) order by c.relname,k.conname)
      from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\'),
    'indexes', (select jsonb_agg(indexdef order by tablename,indexname) from pg_indexes where schemaname='public' and tablename like 'adventure\\_%' escape '\\'),
    'functions', (select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl) order by p.oid::regprocedure::text)
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'adventure\\_%' escape '\\')
  ) as value`)).rows[0].value
const server = createServer().listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise(resolve => server.close(resolve))
let started = false, client
try {
  run(bin('initdb'), ['-D', dir, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run(bin('pg_ctl'), ['-D', dir, '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start'])
  started = true
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await client.connect()
  await client.query('create role anon; create role authenticated; create role service_role bypassrls;')
  for (const path of ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql', 'tests/database/goal-migration-fixture.sql', 'tests/database/goal-migration-baseline-test.sql']) {
    await client.query(await readFile(join(root, path), 'utf8'))
  }
  const before = await capture(client, { legacy: true })
  await client.query(await readFile(join(root, 'tests/database/goal-migration-simulated-projection.sql'), 'utf8'))
  const projected = {}
  for (const table of ['accounts', 'goals', 'tasks', 'events']) {
    projected[table] = (await client.query(`select row from pg_temp.expected_${table}`)).rows.map(({ row }) => row)
  }
  assert.deepEqual(reconcile(before, projected), [])
  assert.deepEqual(reconcile(before, projected), []) // repeatable verification
  for (const mutate of [
    data => { data.goals.find(g => g.id.endsWith('000001')).title = 'changed' },
    data => { data.goals.find(g => g.id.endsWith('000002')).sort_order = -1 },
    data => { data.events.find(e => e.id.endsWith('000004')).snapshot.result.reward.amount = 99 },
    data => { data.tasks.find(t => t.id.endsWith('000003')).goal_id = '00000000-0000-4000-8000-000000000000' },
    data => { data.accounts[0].revision++ },
  ]) {
    const bad = structuredClone(projected)
    mutate(bad)
    assert.notDeepEqual(reconcile(before, bad), [])
  }
  await client.query('begin')
  await client.query("update public.adventure_tasks set title='rollback-probe' where id='30000000-0000-4000-8000-000000000003'")
  await client.query('rollback')
  assert.deepEqual(await capture(client, { legacy: true }), before)
  if (migrationPath) {
    const migration = await readFile(migrationPath, 'utf8')
    // Each failure scenario gets its own database. The bad reference is made
    // possible only by removing the legacy FK in that disposable database.
    for (const scenario of ['invalid_mapping', 'failpoint']) {
      await client.query(`create database goal_${scenario}`)
      const probe = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: `goal_${scenario}`, password: '', ssl: false })
      try {
        await probe.connect()
        for (const path of ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql', 'tests/database/goal-migration-fixture.sql']) {
          await probe.query(await readFile(join(root, path), 'utf8'))
        }
        if (scenario === 'invalid_mapping') {
          await probe.query('alter table public.adventure_goals drop constraint adventure_goals_owner_id_mainline_id_fkey')
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000099' where id='20000000-0000-4000-8000-000000000001'")
          assert.notDeepEqual(validateMappings(await capture(probe, { legacy: true })), [])
        } else {
          await probe.query(`create function public.goal_migration_test_failpoint() returns trigger language plpgsql as $$ begin raise exception 'GOAL_MIGRATION_TEST_FAILPOINT'; end $$;
            create trigger goal_migration_test_failpoint before update on public.adventure_goals for each row execute function public.goal_migration_test_failpoint()`)
        }
        const original = await capture(probe, { legacy: true })
        const originalSchema = await schemaSnapshot(probe)
        let failure
        try { await probe.query(migration) } catch (error) { failure = error }
        await probe.query('rollback')
        assert.ok(failure, `${scenario}: migration unexpectedly succeeded`)
        if (scenario === 'failpoint') assert.match(failure.message, /GOAL_MIGRATION_TEST_FAILPOINT/)
        assert.deepEqual(await capture(probe, { legacy: true }), original, `${scenario}: failed migration changed legacy rows`)
        assert.deepEqual(await schemaSnapshot(probe), originalSchema, `${scenario}: failed migration changed legacy schema`)
      } finally {
        await probe.end()
      }
    }
    console.log('通过：异常映射与故障注入后的旧数据和结构回滚')
    await client.query(migration)
    const after = await capture(client)
    assert.deepEqual(reconcile(before, after, { taskEndCause }), [], '升级后的逐账户逐 ID 对账失败')
    assert.equal((await client.query("select to_regclass('public.adventure_mainlines') as relation")).rows[0].relation, null)
    await client.query(migration)
    assert.deepEqual(await capture(client), after, '重复执行改变了持久化事实')
    console.log('通过：异常映射与注入失败回滚、实际迁移对账和重复执行')
  }
  console.log('通过：隔离旧库迁移验收基线')
} finally {
  if (client) await client.end()
  if (started) run(bin('pg_ctl'), ['-D', dir, '-m', 'fast', '-w', 'stop'])
  await rm(dir, { recursive: true, force: true })
}
