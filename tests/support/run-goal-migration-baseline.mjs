// Always start a new loopback-only cluster; never accept an existing database URL.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import assert from 'node:assert/strict'
import { capture, reconcile, validateMappings, isMappingFailure } from './goal-migration-reconcile.mjs'

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
    'schema', (select jsonb_build_array(n.nspname,n.nspowner::regrole::text,n.nspacl) from pg_namespace n where n.nspname='public'),
    'roles', (select jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) order by rolname)
      from pg_roles where rolname in ('anon','authenticated','service_role')),
    'memberships', (select jsonb_agg(jsonb_build_array(r.rolname,m.rolname,a.admin_option,a.inherit_option,a.set_option) order by r.rolname,m.rolname)
      from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member
      where r.rolname in ('anon','authenticated','service_role') or m.rolname in ('anon','authenticated','service_role')),
    'default_acl', (select jsonb_agg(jsonb_build_array(d.defaclrole::regrole::text,d.defaclobjtype,d.defaclacl) order by d.defaclrole::regrole::text,d.defaclobjtype)
      from pg_default_acl d where d.defaclnamespace='public'::regnamespace),
    'relations', (select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relowner::regrole::text,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions) order by c.relname)
      from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S')),
    'columns', (select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum)
      from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      left join pg_attrdef d on (d.adrelid,d.adnum)=(a.attrelid,a.attnum)
      where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m')),
    'constraints', (select jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred) order by c.relname,k.conname)
      from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace),
    'indexes', (select jsonb_agg(jsonb_build_array(c.relname,i.relname,pg_get_indexdef(i.oid),x.indisvalid,x.indisready) order by c.relname,i.relname)
      from pg_index x join pg_class c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid
      where c.relnamespace='public'::regnamespace),
    'functions', (select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.prokind,case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else null end,p.proacl,p.proowner::regrole::text,p.proconfig) order by p.oid::regprocedure::text)
      from pg_proc p where p.pronamespace='public'::regnamespace),
    'views', (select jsonb_agg(jsonb_build_array(c.relname,pg_get_viewdef(c.oid,true)) order by c.relname) from pg_class c
      where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')),
    'sequences', (select jsonb_agg(jsonb_build_array(sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value) order by sequencename)
      from pg_sequences where schemaname='public'),
    'types', (select jsonb_agg(jsonb_build_array(t.typname,t.typtype,t.typowner::regrole::text,t.typacl,format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault,
      (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by t.typname)
      from pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d')),
    'domain_constraints', (select jsonb_agg(jsonb_build_array(t.typname,k.conname,pg_get_constraintdef(k.oid),k.convalidated) order by t.typname,k.conname)
      from pg_constraint k join pg_type t on t.oid=k.contypid where t.typnamespace='public'::regnamespace),
    'policies', (select jsonb_agg(jsonb_build_array(tablename,policyname,permissive,roles,cmd,qual,with_check) order by tablename,policyname)
      from pg_policies where schemaname='public'),
    'triggers', (select jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by c.relname,t.tgname)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace
      and not t.tgisinternal)
  ) as value`)).rows[0].value
const assertSchemaUnchanged = (before, after, message) => assert.ok(isDeepStrictEqual(before, after), message)
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
  for (const path of ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql', 'tests/database/goal-migration-fixture.sql', 'tests/database/goal-migration-baseline-test.sql']) {
    await client.query(await readFile(join(root, path), 'utf8'))
  }
  const before = await capture(client, { legacy: true })
  await client.query("create function pg_temp.goal_schema_probe() returns trigger language plpgsql as $$ begin return new; end $$")
  const schemaBefore = await schemaSnapshot(client)
  for (const [label, change] of [
    ['RLS', 'alter table public.adventure_goals disable row level security'],
    ['force RLS', 'alter table public.adventure_goals force row level security'],
    ['table privilege', 'grant select on public.adventure_goals to anon'],
    ['column privilege', 'grant select (title) on public.adventure_goals to anon'],
    ['role privilege', 'alter role anon bypassrls'],
    ['schema privilege', 'grant create on schema public to anon'],
    ['default privilege', 'alter default privileges in schema public grant select on tables to anon'],
    ['policy', 'create policy goal_probe on public.adventure_goals for select to anon using (true)'],
    ['trigger', 'create trigger goal_probe before update on public.adventure_goals for each row execute function pg_temp.goal_schema_probe()'],
    ['view', 'create view public.goal_probe_view as select id from public.adventure_goals'],
    ['function privilege', 'grant execute on function public.adventure_planning_command(uuid,text,bigint,jsonb) to anon'],
    ['index', 'drop index public.adventure_goals_owner_mainline'],
    ['constraint', 'alter table public.adventure_goals drop constraint adventure_goals_owner_id_mainline_id_fkey'],
  ]) {
    await client.query('begin')
    await client.query(change)
    const altered = await schemaSnapshot(client)
    assert.throws(() => assertSchemaUnchanged(schemaBefore, altered, `${label} changed`), undefined, `${label} change escaped schema snapshot`)
    await client.query('rollback')
    assert.deepEqual(await schemaSnapshot(client), schemaBefore, `${label} schema rollback differs`)
  }
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
  const rpcOwner = '00000000-0000-4000-8000-000000000003'
  const achieved = projected.events.find(e => e.owner_id === rpcOwner && e.kind === 'goal_achieved')
  const cancelled = projected.events.find(e => e.owner_id === rpcOwner && e.kind === 'task_completed' && e.invalidated_at !== null)
  const moved = projected.events.find(e => e.owner_id === rpcOwner && e.kind === 'task_migrated')
  const goal = projected.goals.find(g => g.owner_id === rpcOwner && g.id === achieved.goal_id)
  for (const field of ['taskId', 'completionId', 'goalId', 'occurredOn', 'source']) {
    for (const [table, id, location] of [
      ['events', achieved.id, row => row.snapshot.actionSources[0]],
      ['goals', goal.id, row => row.attainment_snapshot.actionSources[0]],
    ]) {
      const bad = structuredClone(projected)
      delete location(bad[table].find(row => row.id === id))[field]
      assert.ok(reconcile(before, bad).some(error => error.includes(`${rpcOwner}/${id}`)), `${table} actionSources.${field}`)
    }
  }
  for (const [id, mutate] of [
    [achieved.id, row => { delete row.snapshot.result.reward.calculation.actionIds }],
    [achieved.id, row => { delete row.snapshot.result.growthChange.after }],
    [cancelled.id, row => { delete row.snapshot.result.completionId }],
    [cancelled.id, row => { delete row.snapshot.result.reward.calculation.completionId }],
    [cancelled.id, row => { delete row.snapshot.result.growthChange.before }],
    [moved.id, row => { delete row.snapshot.before.goal_id }],
    [moved.id, row => { delete row.snapshot.after.goal_id }],
    [moved.id, row => { delete row.snapshot.origin.goalId }],
  ]) {
    const bad = structuredClone(projected)
    mutate(bad.events.find(row => row.id === id))
    assert.ok(reconcile(before, bad).some(error => error.includes(`${rpcOwner}/${id}`)), `RPC history ${id}`)
  }
  await client.query('begin')
  await client.query("update public.adventure_tasks set title='rollback-probe' where id='30000000-0000-4000-8000-000000000003'")
  await client.query('rollback')
  assert.deepEqual(await capture(client, { legacy: true }), before)
  if (migrationPath) {
    const migration = await readFile(migrationPath, 'utf8')
    // Each failure scenario gets its own database. The bad reference is made
    // possible only by removing the legacy FK in that disposable database.
    for (const scenario of ['invalid_mapping', 'blank_label', 'long_label', 'failpoint']) {
      await client.query(`create database goal_${scenario}`)
      const probe = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: `goal_${scenario}`, password: '', ssl: false })
      try {
        await probe.connect()
        for (const path of ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql', 'tests/database/goal-migration-fixture.sql']) {
          await probe.query(await readFile(join(root, path), 'utf8'))
        }
        if (scenario === 'invalid_mapping') {
          await probe.query('alter table public.adventure_goals drop constraint adventure_goals_owner_id_mainline_id_fkey')
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000099' where id='20000000-0000-4000-8000-000000000001'")
          assert.notDeepEqual(validateMappings(await capture(probe, { legacy: true })), [])
        } else if (scenario === 'blank_label' || scenario === 'long_label') {
          // Deliberately emulate malformed legacy data that current checks would reject.
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000002' where id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010')")
          await probe.query('alter table public.adventure_mainlines drop constraint adventure_mainlines_name_check')
          await probe.query('alter table public.adventure_mainlines alter column name type text')
          await probe.query(`update public.adventure_mainlines set name=${scenario === 'blank_label' ? "'   '" : "repeat('字',201)"} where id='10000000-0000-4000-8000-000000000001'`)
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
        else assert.ok(isMappingFailure(failure, {
          code: scenario === 'invalid_mapping' ? 'GOAL_MIGRATION_INVALID_MAPPING' : 'GOAL_MIGRATION_INVALID_LABEL',
          ownerId: '00000000-0000-4000-8000-000000000001', goalId: '20000000-0000-4000-8000-000000000001',
        }), `${scenario}: expected explicit mapping error with owner and goal; got ${failure.message}`)
        assert.deepEqual(await capture(probe, { legacy: true }), original, `${scenario}: failed migration changed legacy rows`)
        assertSchemaUnchanged(originalSchema, await schemaSnapshot(probe), `${scenario}: failed migration changed legacy schema`)
      } finally {
        await probe.end()
      }
    }
    console.log('通过：异常映射与故障注入后的旧数据和结构回滚')
    await client.query(migration)
    const after = await capture(client)
    const afterSchema = await schemaSnapshot(client)
    assert.deepEqual(reconcile(before, after, { taskEndCause }), [], '升级后的逐账户逐 ID 对账失败')
    assert.equal((await client.query("select to_regclass('public.adventure_mainlines') as relation")).rows[0].relation, null)
    await client.query(migration)
    assert.deepEqual(await capture(client), after, '重复执行改变了持久化事实')
    assertSchemaUnchanged(afterSchema, await schemaSnapshot(client), '重复执行改变了结构或安全属性')
    await client.query('create database goal_fresh')
    const fresh = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'goal_fresh', password: '', ssl: false })
    try {
      await fresh.connect()
      for (const path of ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql']) {
        await fresh.query(await readFile(join(root, path), 'utf8'))
      }
      assertSchemaUnchanged(afterSchema, await schemaSnapshot(fresh), '新库和升级库的结构或安全属性不同')
    } finally {
      await fresh.end()
    }
    console.log('通过：异常映射与注入失败回滚、实际迁移对账和重复执行')
  }
  console.log('通过：隔离旧库迁移验收基线')
} finally {
  if (client) await client.end()
  if (started) run(bin('pg_ctl'), ['-D', dir, '-m', 'fast', '-w', 'stop'])
  await rm(dir, { recursive: true, force: true })
}
