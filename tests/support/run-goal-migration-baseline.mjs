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
const assertSchemaUnchanged = (before, after, message) => {
  const differences = Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key]))
  assert.deepEqual(differences, [], message)
}
// Use actual roles and disposable objects. In particular, TRUNCATE and TRIGGER
// must be denied by ACLs; row-level security alone cannot protect them.
const assertRoleDenials = async db => {
  await db.query('begin')
  try {
    await db.query('create function public.goal_permission_probe() returns trigger language plpgsql as $$ begin return new; end $$')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.query('create table public.goal_reference_probe (id uuid)')
      await db.query(`alter table public.goal_reference_probe owner to ${role}`)
      await db.query(`set local role ${role}`)
      for (const privilege of ['delete', 'truncate', 'references', 'trigger', 'maintain', ...(role === 'service_role' ? [] : ['select', 'insert', 'update'])]) {
        const actual = (await db.query(`select has_table_privilege(current_user,'public.adventure_events','${privilege}') allowed`)).rows[0].allowed
        assert.equal(actual, false, `${role} has ${privilege}`)
      }
      const statements = [
        'truncate public.adventure_events',
        'delete from public.adventure_events where false',
        'alter table public.goal_reference_probe add foreign key (id) references public.adventure_events(id)',
        'create trigger goal_permission_probe before insert on public.adventure_events for each row execute function public.goal_permission_probe()',
      ]
      if (role !== 'service_role') statements.push('select * from public.adventure_events', 'insert into public.adventure_events default values', 'update public.adventure_events set snapshot=snapshot where false')
      for (const statement of statements) {
        await db.query('savepoint denied_action')
        await assert.rejects(db.query(statement), error => error.code === '42501', `${role}: ${statement}`)
        await db.query('rollback to savepoint denied_action')
      }
      await db.query('reset role')
      await db.query('drop table public.goal_reference_probe')
    }
  } finally {
    await db.query('rollback')
  }
}
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
  await client.query('create role anon; create role authenticated; create role service_role bypassrls; create role goal_acl_parent;')
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
    const allTablePrivileges = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']
    const unsafeMatrix = [
      ...['public', 'anon', 'authenticated'].flatMap(grantee => allTablePrivileges.map(privilege => ({
        id: `acl_${grantee}_${privilege}`, grantee, privilege, actor: grantee === 'public' ? 'anon' : grantee,
      }))),
      ...['delete', 'truncate', 'references', 'trigger', 'maintain'].map(privilege => ({
        id: `acl_service_${privilege}`, grantee: 'service_role', privilege, actor: 'service_role',
      })),
      ...['anon', 'authenticated', 'service_role'].flatMap(actor => ['truncate', 'references', 'trigger', 'maintain'].map(privilege => ({
        id: `acl_parent_${actor}_${privilege}`, grantee: 'goal_acl_parent', privilege, actor, inherited: true,
      }))),
      ...['public', 'anon', 'authenticated', 'service_role'].map(grantee => ({
        id: `acl_column_${grantee}`, grantee, privilege: 'references', actor: grantee === 'public' ? 'anon' : grantee, column: true,
      })),
      ...['anon', 'authenticated', 'service_role'].map(actor => ({
        id: `acl_parent_column_${actor}`, grantee: 'goal_acl_parent', privilege: 'references', actor, column: true, inherited: true,
      })),
      ...['select', 'insert', 'update'].flatMap(privilege => [false, true].map(column => ({
        id: `acl_grant_${privilege}_${column ? 'column' : 'table'}`, grantee: 'service_role', privilege, actor: 'service_role', column, delegation: true,
      }))),
      ...['select', 'insert', 'update'].flatMap(privilege => [false, true].map(column => ({
        id: `acl_parent_grant_${privilege}_${column ? 'column' : 'table'}`, grantee: 'goal_acl_parent', privilege, actor: 'service_role', column, inherited: true, delegation: true,
      }))),
    ]
    const unsafeById = new Map(unsafeMatrix.map(entry => [entry.id, entry]))
    // Each failure scenario gets its own database. The bad reference is made
    // possible only by removing the legacy FK in that disposable database.
    for (const scenario of [...unsafeById.keys(), 'unsafe_truncate_anon', 'unsafe_inherited_truncate', 'unsafe_service_column_reference', 'unsafe_service_grant_option', 'unsafe_function_grant_option', 'unsafe_parent_function_grant_option', 'unsafe_inherited_execute', 'unsafe_inherited_schema', 'unsafe_anon_bypassrls', 'invalid_mapping', 'invalid_kind', 'invalid_status', 'invalid_inbox', 'blank_label', 'tab_label', 'long_label', 'orphan_event', 'mixed_event', 'inconsistent_xp', 'missing_fk', 'wrong_fk', 'cascade_fk', 'wrong_index', 'unsafe_acl', 'mutating_trigger', 'failpoint', 'late_failpoint']) {
      await client.query(`create database goal_${scenario}`)
      const probe = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: `goal_${scenario}`, password: '', ssl: false })
      try {
        await probe.connect()
        for (const path of ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql', 'tests/database/goal-migration-fixture.sql']) {
          await probe.query(await readFile(join(root, path), 'utf8'))
        }
        const acl = unsafeById.get(scenario)
        if (acl) {
          await probe.query(`grant ${acl.privilege}${acl.column ? ' (id)' : ''} on public.adventure_events to ${acl.grantee}${acl.delegation ? ' with grant option' : ''}`)
          if (acl.inherited) await probe.query(`grant goal_acl_parent to ${acl.actor} with inherit false, set true`)
          if (acl.privilege === 'references') {
            await probe.query('create table public.goal_acl_reference_probe (id uuid)')
            await probe.query(`alter table public.goal_acl_reference_probe owner to ${acl.grantee === 'public' ? acl.actor : acl.grantee}`)
          }
          if (acl.privilege === 'trigger') await probe.query('create function public.goal_acl_trigger_probe() returns trigger language plpgsql as $$ begin return new; end $$')
          await probe.query(`set session authorization ${acl.actor}`)
          if (acl.inherited) await probe.query('set role goal_acl_parent')
          const privilegeQuery = acl.column
            ? `select has_column_privilege(current_user,'public.adventure_events','id','${acl.privilege}${acl.delegation ? ' with grant option' : ''}') allowed`
            : `select has_table_privilege(current_user,'public.adventure_events','${acl.privilege}${acl.delegation ? ' with grant option' : ''}') allowed`
          assert.equal((await probe.query(privilegeQuery)).rows[0].allowed, true, scenario)
          await probe.query('begin')
          if (acl.privilege === 'truncate') await probe.query('truncate public.adventure_events')
          if (acl.privilege === 'references') await probe.query('alter table public.goal_acl_reference_probe add foreign key (id) references public.adventure_events(id)')
          if (acl.privilege === 'trigger') await probe.query('create trigger goal_acl_probe before insert on public.adventure_events for each row execute function public.goal_acl_trigger_probe()')
          if (acl.privilege === 'maintain') await probe.query('analyze public.adventure_events')
          if (acl.delegation) await probe.query(`grant ${acl.privilege}${acl.column ? ' (id)' : ''} on public.adventure_events to anon`)
          await probe.query('rollback')
          await probe.query('reset session authorization')
          if (acl.privilege === 'references') await probe.query('drop table public.goal_acl_reference_probe')
          if (acl.privilege === 'trigger') await probe.query('drop function public.goal_acl_trigger_probe()')
        } else if (scenario === 'invalid_mapping') {
          await probe.query('alter table public.adventure_goals drop constraint adventure_goals_owner_id_mainline_id_fkey')
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000099' where id='20000000-0000-4000-8000-000000000001'")
          assert.notDeepEqual(validateMappings(await capture(probe, { legacy: true })), [])
        } else if (scenario === 'invalid_kind') {
          await probe.query('alter table public.adventure_mainlines drop constraint adventure_mainlines_kind_check')
          await probe.query("update public.adventure_mainlines set kind='invalid' where id='10000000-0000-4000-8000-000000000001'")
        } else if (scenario === 'invalid_status') {
          await probe.query('alter table public.adventure_mainlines drop constraint adventure_mainlines_status_check')
          await probe.query("update public.adventure_mainlines set status='invalid' where id='10000000-0000-4000-8000-000000000001'")
        } else if (scenario === 'invalid_inbox') {
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000001' where id='20000000-0000-4000-8000-000000000005'")
        } else if (scenario === 'blank_label' || scenario === 'tab_label' || scenario === 'long_label') {
          // Deliberately emulate malformed legacy data that current checks would reject.
          await probe.query("update public.adventure_goals set mainline_id='10000000-0000-4000-8000-000000000002' where id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010')")
          await probe.query('alter table public.adventure_mainlines drop constraint adventure_mainlines_name_check')
          await probe.query('alter table public.adventure_mainlines alter column name type text')
          const invalidName = scenario === 'blank_label' ? "'   '" : scenario === 'tab_label' ? "E'\\t\\n'" : "repeat('字',201)"
          await probe.query(`update public.adventure_mainlines set name=${invalidName} where id='10000000-0000-4000-8000-000000000001'`)
          assert.notDeepEqual(validateMappings(await capture(probe, { legacy: true })), [])
        } else if (scenario === 'orphan_event') {
          await probe.query('alter table public.adventure_events drop constraint adventure_events_owner_id_mainline_id_fkey')
          await probe.query("update public.adventure_events set mainline_id='10000000-0000-4000-8000-000000000099' where id='40000000-0000-4000-8000-000000000001'")
        } else if (scenario === 'mixed_event') {
          await probe.query("update public.adventure_events set goal_id='20000000-0000-4000-8000-000000000001' where id='40000000-0000-4000-8000-000000000006'")
        } else if (scenario === 'inconsistent_xp') {
          await probe.query("update public.adventure_accounts set total_xp=5 where owner_id='00000000-0000-4000-8000-000000000001'")
        } else if (scenario === 'missing_fk') {
          await probe.query('alter table public.adventure_tasks drop constraint adventure_tasks_owner_id_goal_id_fkey')
        } else if (scenario === 'wrong_fk' || scenario === 'cascade_fk') {
          await probe.query('alter table public.adventure_tasks drop constraint adventure_tasks_owner_id_goal_id_fkey')
          await probe.query(scenario === 'wrong_fk'
            ? 'alter table public.adventure_tasks add constraint adventure_tasks_owner_id_goal_id_fkey foreign key (goal_id) references public.adventure_goals(id)'
            : 'alter table public.adventure_tasks add constraint adventure_tasks_owner_id_goal_id_fkey foreign key (owner_id,goal_id) references public.adventure_goals(owner_id,id) on delete cascade')
        } else if (scenario === 'wrong_index') {
          await probe.query('drop index public.adventure_one_inbox')
          await probe.query("create unique index adventure_one_inbox on public.adventure_goals(owner_id,id) where kind='inbox'")
        } else if (scenario === 'unsafe_truncate_anon') {
          await probe.query('grant truncate on public.adventure_events to anon')
          await probe.query('set role anon')
          await probe.query('begin')
          await probe.query('truncate public.adventure_events')
          await probe.query('rollback')
          await probe.query('reset role')
        } else if (scenario === 'unsafe_inherited_truncate') {
          await probe.query('grant truncate on public.adventure_events to goal_acl_parent')
          await probe.query('grant goal_acl_parent to anon with inherit false, set true')
          await probe.query('set session authorization anon')
          await probe.query('set role goal_acl_parent')
          await probe.query('begin')
          await probe.query('truncate public.adventure_events')
          await probe.query('rollback')
          await probe.query('reset session authorization')
        } else if (scenario === 'unsafe_service_column_reference') {
          await probe.query('grant references (id) on public.adventure_events to service_role')
          await probe.query('create table public.goal_acl_reference_probe (id uuid)')
          await probe.query('alter table public.goal_acl_reference_probe owner to service_role')
          await probe.query('set role service_role')
          await probe.query('begin')
          await probe.query('alter table public.goal_acl_reference_probe add foreign key (id) references public.adventure_events(id)')
          await probe.query('rollback')
          await probe.query('reset role')
          await probe.query('drop table public.goal_acl_reference_probe')
        } else if (scenario === 'unsafe_service_grant_option') {
          await probe.query('grant select on public.adventure_events to service_role with grant option')
          await probe.query('set session authorization service_role')
          await probe.query('begin')
          await probe.query('grant select on public.adventure_events to anon')
          await probe.query('rollback')
          await probe.query('reset session authorization')
        } else if (scenario === 'unsafe_function_grant_option' || scenario === 'unsafe_parent_function_grant_option') {
          const parent = scenario === 'unsafe_parent_function_grant_option'
          const grantee = parent ? 'goal_acl_parent' : 'service_role'
          await probe.query(`grant execute on function public.adventure_task_capability(uuid,jsonb,date) to ${grantee} with grant option`)
          if (parent) await probe.query('grant goal_acl_parent to service_role with inherit false, set true')
          await probe.query('set session authorization service_role')
          if (parent) await probe.query('set role goal_acl_parent')
          await probe.query('begin')
          await probe.query('grant execute on function public.adventure_task_capability(uuid,jsonb,date) to anon')
          await probe.query('rollback')
          await probe.query('reset session authorization')
        } else if (scenario === 'unsafe_inherited_execute' || scenario === 'unsafe_inherited_schema') {
          await probe.query('grant goal_acl_parent to anon with inherit false, set true')
          if (scenario === 'unsafe_inherited_execute') {
            await probe.query('grant execute on function public.adventure_task_capability(uuid,jsonb,date) to goal_acl_parent')
          } else {
            await probe.query('grant create on schema public to goal_acl_parent')
          }
          await probe.query('set session authorization anon')
          await probe.query('set role goal_acl_parent')
          await probe.query('begin')
          if (scenario === 'unsafe_inherited_execute') {
            await probe.query("select public.adventure_task_capability('00000000-0000-4000-8000-000000000001', '{\"type\":\"deleteTask\",\"id\":\"30000000-0000-4000-8000-000000000003\"}', current_date)")
          } else {
            await probe.query('create table public.goal_acl_schema_probe (id uuid)')
          }
          await probe.query('rollback')
          await probe.query('reset session authorization')
        } else if (scenario === 'unsafe_anon_bypassrls') {
          await probe.query('alter role anon bypassrls')
        } else if (scenario === 'unsafe_acl') {
          await probe.query('grant select on public.adventure_goals to anon')
        } else if (scenario === 'mutating_trigger') {
          await probe.query(`create function public.goal_migration_test_mutation() returns trigger language plpgsql as $$ begin new.title:='unexpected'; return new; end $$;
            create trigger goal_migration_test_mutation before update on public.adventure_goals for each row execute function public.goal_migration_test_mutation()`)
        } else if (scenario === 'failpoint') {
          await probe.query(`create function public.goal_migration_test_failpoint() returns trigger language plpgsql as $$ begin raise exception 'GOAL_MIGRATION_TEST_FAILPOINT'; end $$;
            create trigger goal_migration_test_failpoint before update on public.adventure_goals for each row execute function public.goal_migration_test_failpoint()`)
        }
        const original = await capture(probe, { legacy: true })
        const originalSchema = await schemaSnapshot(probe)
        let failure
        const probeMigration = scenario === 'late_failpoint'
          ? migration.replace(/commit;\s*$/i, () => "do $$ begin raise exception 'GOAL_MIGRATION_LATE_FAILPOINT'; end $$;\ncommit;")
          : migration
        if (scenario === 'late_failpoint') assert.notEqual(probeMigration, migration, 'cannot inject late failure')
        try { await probe.query(probeMigration) } catch (error) { failure = error }
        await probe.query('rollback')
        assert.ok(failure, `${scenario}: migration unexpectedly succeeded`)
        if (scenario === 'failpoint') assert.match(failure.message, /GOAL_MIGRATION_TEST_FAILPOINT/)
        else if (scenario === 'late_failpoint') assert.match(failure.message, /GOAL_MIGRATION_LATE_FAILPOINT/)
        else if (scenario === 'mutating_trigger') assert.match(failure.message, /GOAL_MIGRATION_RECONCILIATION_FAILED table=goals/)
        else if (scenario === 'orphan_event') assert.match(failure.message, /GOAL_MIGRATION_INVALID_EVENT_MAPPING owner=00000000-0000-4000-8000-000000000001 event=40000000-0000-4000-8000-000000000001/)
        else if (scenario === 'mixed_event') assert.match(failure.message, /GOAL_MIGRATION_UNSAFE_EVENT owner=00000000-0000-4000-8000-000000000001 event=40000000-0000-4000-8000-000000000006/)
        else if (scenario === 'inconsistent_xp') assert.match(failure.message, /GOAL_MIGRATION_INCONSISTENT_XP owner=00000000-0000-4000-8000-000000000001/)
        else if (['missing_fk', 'wrong_fk', 'cascade_fk', 'wrong_index'].includes(scenario)) assert.match(failure.message, /GOAL_MIGRATION_INVALID_SCHEMA/)
        else if (acl || ['unsafe_acl', 'unsafe_truncate_anon', 'unsafe_inherited_truncate', 'unsafe_service_column_reference', 'unsafe_service_grant_option', 'unsafe_function_grant_option', 'unsafe_parent_function_grant_option', 'unsafe_inherited_execute', 'unsafe_inherited_schema', 'unsafe_anon_bypassrls'].includes(scenario)) assert.match(failure.message, /GOAL_MIGRATION_UNSAFE_SECURITY/)
        else assert.ok(isMappingFailure(failure, {
          code: ['invalid_mapping', 'invalid_kind', 'invalid_status', 'invalid_inbox'].includes(scenario) ? 'GOAL_MIGRATION_INVALID_MAPPING' : 'GOAL_MIGRATION_INVALID_LABEL',
          ownerId: '00000000-0000-4000-8000-000000000001', goalId: `20000000-0000-4000-8000-00000000000${scenario === 'invalid_inbox' ? 5 : 1}`,
        }), `${scenario}: expected explicit mapping error with owner and goal; got ${failure.message}`)
        assert.deepEqual(await capture(probe, { legacy: true }), original, `${scenario}: failed migration changed legacy rows`)
        assertSchemaUnchanged(originalSchema, await schemaSnapshot(probe), `${scenario}: failed migration changed legacy schema`)
      } finally {
        const acl = unsafeById.get(scenario)
        if (acl?.inherited) await client.query(`revoke goal_acl_parent from ${acl.actor}`)
        if (['unsafe_inherited_truncate', 'unsafe_inherited_execute', 'unsafe_inherited_schema'].includes(scenario)) await client.query('revoke goal_acl_parent from anon')
        if (scenario === 'unsafe_parent_function_grant_option') await client.query('revoke goal_acl_parent from service_role')
        if (scenario === 'unsafe_anon_bypassrls') await client.query('alter role anon nobypassrls')
        await probe.end()
        await client.query(`drop database goal_${scenario}`)
      }
    }
    console.log('通过：异常映射与故障注入后的旧数据和结构回滚')
    await client.query(migration)
    const after = await capture(client)
    const afterSchema = await schemaSnapshot(client)
    assert.deepEqual(reconcile(before, after, { taskEndCause }), [], '升级后的逐账户逐 ID 对账失败')
    const businessRegression = await readFile(join(root, 'tests/database/goal-post-migration-regression.sql'), 'utf8')
    const retiredRegression = await readFile(join(root, 'tests/database/goal-retired-command-regression.sql'), 'utf8')
    const applyBoundaryRegression = await readFile(join(root, 'tests/database/goal-apply-boundary-regression.sql'), 'utf8')
    await client.query(businessRegression)
    await client.query(retiredRegression)
    await client.query(applyBoundaryRegression)
    await assertRoleDenials(client)
    assert.deepEqual(await capture(client), after, '升级库业务回归未回滚合成数据')
    assertSchemaUnchanged(afterSchema, await schemaSnapshot(client), '升级库业务回归未回滚测试触发器')
    const lock = (await client.query('select * from goal_fixture_historical_lock')).rows[0]
    assert.equal(after.events.find(event => event.id === lock.completion_id).historical_lock, true)
    assert.equal(after.events.find(event => event.id === lock.unlocked_completion_id).historical_lock, false)
    const invalidated = after.events.find(event => event.id === lock.invalidated_completion_id)
    assert.equal(invalidated.historical_lock, true)
    assert.notEqual(invalidated.invalidated_at, null)
    await assert.rejects(client.query('select public.adventure_planning_command($1,$2,$3,$4)',
      [lock.owner_id, 'lock-cancel', lock.expected_version, lock.cancel_command]),
    error => error.message === 'READ_ONLY', '历史完成的锁定被绕过')
    const receipts = (await client.query('select owner_id,request_id,command,pg_temp.goal_fixture_clean(receipt) receipt from goal_fixture_receipts')).rows
    await client.query('set role service_role')
    try {
      for (const saved of receipts) {
        const replay = await client.query('select public.adventure_planning_command($1,$2,0,$3) as receipt', [saved.owner_id, saved.request_id, saved.command])
        assert.deepEqual(replay.rows[0].receipt, saved.receipt, `清理后的回执重放不同: ${saved.request_id}`)
      }
      for (const [request, fn] of [['rpc-achieve-goal', 'adventure_goal_apply'], ['rpc-complete-cancel', 'adventure_task_apply']]) {
        const saved = receipts.find(receipt => receipt.request_id === request)
        const replay = await client.query(`select public.${fn}($1,$2,0,$3,clock_timestamp()) as receipt`, [saved.owner_id, saved.request_id, saved.command])
        assert.deepEqual(replay.rows[0].receipt, saved.receipt, `辅助入口未重放迁移前的历史回执: ${request}`)
      }
      await assert.rejects(client.query('select public.adventure_planning_command($1,$2,0,$3)',
        [lock.owner_id, 'legacy-end-task', { type: 'endTask', id: '30000000-0000-4000-8000-000000000001' }]),
      error => error.message === 'REQUEST_ID_REUSED', '停用命令的旧回执允许不同摘要复用')
    } finally {
      await client.query('reset role')
    }
    const reopened = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
    try {
      await reopened.connect()
      await reopened.query('set role service_role')
      const saved = receipts.find(receipt => receipt.request_id === 'rpc-complete-cancel')
      const replay = await reopened.query('select public.adventure_planning_command($1,$2,0,$3) as receipt', [saved.owner_id, saved.request_id, saved.command])
      assert.deepEqual(replay.rows[0].receipt, saved.receipt, '新连接无法重放已取消完成的回执')
    } finally {
      await reopened.end()
    }
    await assert.rejects(client.query('select public.adventure_planning_command($1,$2,0,$3)',
      [lock.owner_id, 'lock-new-complete', { type: 'completeTask', id: '30000000-0000-4000-8000-000000000001' }]),
    error => error.message === 'REQUEST_ID_REUSED', '不同摘要复用了旧回执')
    const other = before.accounts.find(account => account.owner_id === '00000000-0000-4000-8000-000000000003')
    await assert.rejects(client.query('select public.adventure_planning_command($1,$2,$3,$4)',
      [other.owner_id, 'cross-lock-cancel', other.revision, lock.cancel_command]),
    error => error.message === 'NOT_FOUND', '跨账户取消访问了历史完成')
    await client.query('begin')
    try {
      const cancel = await client.query('select public.adventure_planning_command($1,$2,$3,$4) as result',
        [lock.owner_id, 'unlocked-cancel', lock.expected_version, { type: 'cancelTaskCompletion', completionId: lock.unlocked_completion_id }])
      assert.equal(cancel.rows[0].result.version, Number(lock.expected_version) + 1, '原本允许的完成未能取消')
    } finally {
      await client.query('rollback')
    }
    assert.deepEqual(await capture(client), after, '回执或测试取消改变了迁移后的事实')
    await client.query('begin')
    try {
      const goalId = (await client.query('select goal_id from public.adventure_tasks where owner_id=$1 and id=(select task_id from public.adventure_events where owner_id=$1 and id=$2)',
        [lock.owner_id, lock.unlocked_completion_id])).rows[0].goal_id
      const today = (await client.query("select (clock_timestamp() at time zone 'Asia/Shanghai')::date::text as today")).rows[0].today
      const create = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'freeze-create', lock.expected_version,
        { type: 'createTask', destination: goalId, title: '新行动', description: '', plannedOn: today }])).rows[0].result
      const complete = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'freeze-complete', create.version,
        { type: 'completeTask', id: create.result.entityId }])).rows[0].result
      const completionId = complete.result.completionId
      assert.equal((await client.query('select snapshot->>\'categoryLabel\' as label from public.adventure_events where owner_id=$1 and id=$2', [lock.owner_id, completionId])).rows[0].label, '新方向')
      const edited = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'freeze-edit', complete.version,
        { type: 'editGoal', id: goalId, title: '转移的目标', standards: ['标准'], categoryLabel: '后来修改' }])).rows[0].result
      assert.equal((await client.query('select snapshot->>\'categoryLabel\' as label from public.adventure_events where owner_id=$1 and id=$2', [lock.owner_id, completionId])).rows[0].label, '新方向')
      const achieved = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'freeze-achieve', edited.version,
        { type: 'achieveGoal', id: goalId, coefficient: 1, reflection: '' }])).rows[0].result
      assert.equal((await client.query("select snapshot->>'categoryLabel' as label from public.adventure_events where owner_id=$1 and kind='goal_achieved' and goal_id=$2", [lock.owner_id, goalId])).rows[0].label, '后来修改')
      assert.equal((await client.query('select snapshot->>\'categoryLabel\' as label from public.adventure_events where owner_id=$1 and id=$2', [lock.owner_id, completionId])).rows[0].label, '新方向')
      assert.equal(achieved.version, edited.version + 1)
      const newGoal = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'end-create-goal', achieved.version,
        { type: 'createGoal', title: '可结束目标', standards: ['完成'], categoryLabel: ' 分类 ' }])).rows[0].result
      const ended = (await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [lock.owner_id, 'end-goal-new', newGoal.version,
        { type: 'endGoal', id: newGoal.result.entityId }])).rows[0].result
      await assert.rejects(client.query('select public.adventure_planning_command($1,$2,$3,$4)', [lock.owner_id, 'edit-ended-goal', ended.version,
        { type: 'editGoal', id: newGoal.result.entityId, title: '不能编辑', standards: ['完成'] }]), error => error.message === 'READ_ONLY')
    } finally {
      await client.query('rollback')
    }
    const owner = '00000000-0000-4000-8000-000000000001'
    const expectedActive = after.goals.filter(goal => goal.owner_id === owner && goal.kind === 'real' && goal.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(goal => goal.id)
    const expectedTerminal = after.goals.filter(goal => goal.owner_id === owner && goal.kind === 'real' && goal.status !== 'active')
      .sort((a, b) => b.terminated_at.localeCompare(a.terminated_at) || a.id.localeCompare(b.id)).map(goal => goal.id)
    const pages = []
    for (let page = 1; page <= Math.ceil((expectedActive.length + expectedTerminal.length) / 2); page++) {
      const response = (await client.query('select public.adventure_planning_read($1,$2,2,true) result', [owner, page])).rows[0].result
      assert.equal(response.totalGoals, expectedActive.length + expectedTerminal.length)
      assert.ok(!('mainlines' in response) && !('mainlineDetail' in response) && !('destinations' in response))
      pages.push(...response.goals.map(goal => goal.id))
    }
    assert.deepEqual(pages, [...expectedActive, ...expectedTerminal], '目标分页没有按全账户顺序返回')
    const active = (await client.query('select public.adventure_planning_read($1,1,50,false) result', [owner])).rows[0].result
    assert.deepEqual(active.goals.map(goal => goal.id), expectedActive)
    await client.query('begin')
    try {
      const revision = after.accounts.find(account => account.owner_id === owner).revision
      const moved = await client.query('select public.adventure_planning_command($1,$2,$3,$4) result', [owner, 'test-reorder-global', revision,
        { type: 'reorderGoals', id: expectedActive.at(-1), targetId: expectedActive[0], direction: 'up' }])
      assert.equal(moved.rows[0].result.version, revision + 1)
      const reordered = (await client.query('select public.adventure_planning_read($1,1,50,false) result', [owner])).rows[0].result
      assert.deepEqual(reordered.goals.map(goal => goal.id), [expectedActive.at(-1), ...expectedActive.slice(0, -1)])
      for (const goal of reordered.goals) assert.equal(goal.focused, after.goals.find(row => row.id === goal.id).focused)
      const terminal = (await client.query('select public.adventure_planning_read($1,1,50,true) result', [owner])).rows[0].result.goals
        .filter(goal => goal.status !== 'active').map(goal => goal.id)
      assert.deepEqual(terminal, expectedTerminal)
    } finally {
      await client.query('rollback')
    }
    const workspace = (await client.query("select public.adventure_workspace_read($1,1,20,'today',1,'all','',$2,1,true) result",
      [owner, '20000000-0000-4000-8000-000000000001'])).rows[0].result
    assert.equal(workspace.goalDetail.totalTasks, 1, '目标关系只包含当前归属且未删除的待完成及已完成任务')
    assert.deepEqual(workspace.goalDetail.tasks.map(task => task.id), ['30000000-0000-4000-8000-000000000002'])
    assert.doesNotMatch(JSON.stringify(workspace), /"mainline(?:Id|Name|Kind|s|Detail)"/i)
    const projectionOwner = '00000000-0000-4000-8000-000000000003'
    const rpcAccount = after.accounts.find(account => account.owner_id === projectionOwner)
    const achievedEvent = after.events.find(event => event.owner_id === projectionOwner && event.kind === 'goal_achieved')
    const doneEvent = after.events.find(event => event.owner_id === projectionOwner && event.kind === 'task_completed' && event.invalidated_at === null)
    const today = (await client.query("select (clock_timestamp() at time zone 'Asia/Shanghai')::date::text today")).rows[0].today
    const lockedTask = after.events.find(event => event.id === lock.completion_id).task_id
    const unlockedTask = after.events.find(event => event.id === lock.unlocked_completion_id).task_id
    const lockedView = (await client.query('select public.adventure_task_view($1,$2,$3) result', [lock.owner_id, lockedTask, today])).rows[0].result
    const unlockedView = (await client.query('select public.adventure_task_view($1,$2,$3) result', [lock.owner_id, unlockedTask, today])).rows[0].result
    assert.equal(lockedView.capabilities.cancel.allowed, false)
    assert.equal(unlockedView.capabilities.cancel.allowed, true)
    const projections = [workspace]
    let options
    for (const [query, params] of [
      ['select public.adventure_growth_read($1,$2,null) result', [projectionOwner, rpcAccount.revision]],
      ['select public.adventure_reward_source($1,$2,1,$3) result', [projectionOwner, achievedEvent.id, rpcAccount.revision]],
      ['select public.adventure_task_history($1,$2,1) result', [projectionOwner, doneEvent.task_id]],
      ["select public.adventure_task_list($1,$2,'all',$3,$2,1) result", [projectionOwner, today, rpcAccount.revision]],
      ["select public.adventure_migration_options($1,'task',$2,1) result", [lock.owner_id,
        after.events.find(event => event.owner_id === lock.owner_id && event.id === lock.unlocked_completion_id).task_id]],
    ]) {
      const value = (await client.query(query, params)).rows[0].result
      if (query.includes('adventure_migration_options')) options = value
      projections.push(value)
    }
    assert.ok(options.options.every(option => option.capability.allowed === false), '已完成任务不应显示可迁移目的地')
    const findOldKeys = value => {
      if (!value || typeof value !== 'object') return []
      return Object.entries(value).flatMap(([key, item]) => [/^mainline(?:Id|Name|Kind|Type|s|Detail|_id|_name|_kind|_type)$/i.test(key) ? key : [], findOldKeys(item)]).flat()
    }
    assert.deepEqual(projections.flatMap(findOldKeys), [], '任务、成长或历史投影仍含主线字段')
    const legacyFunctions = (await client.query(`select p.oid::regprocedure::text as name from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'adventure\\_%' escape '\\'
      and pg_get_functiondef(p.oid) ~* 'mainline|主线' order by 1`)).rows.map(row => row.name)
    assert.deepEqual(legacyFunctions, [], '数据库函数仍含旧主线对象或投影')
    const legacyObjects = (await client.query(`select name from (
      select c.relname name from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\' and c.relname ~* 'mainline'
      union all select c.relname||'.'||a.attname from pg_class c join pg_attribute a on a.attrelid=c.oid
        where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\' and a.attnum>0 and not a.attisdropped and a.attname ~* 'mainline'
      union all select c.relname||'.'||k.conname from pg_constraint k join pg_class c on c.oid=k.conrelid
        where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\' and (k.conname ~* 'mainline' or pg_get_constraintdef(k.oid) ~* 'mainline')
    ) objects order by name`)).rows.map(row => row.name)
    assert.deepEqual(legacyObjects, [], '数据库结构仍含旧主线引用')
    const unsafeFunctions = (await client.query(`select p.oid::regprocedure::text as name from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'adventure\\_%' escape '\\'
      and (p.prosecdef or not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c where c in ('search_path=""','search_path='))
        or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute with grant option')
        or not has_function_privilege('service_role',p.oid,'execute')) order by 1`)).rows.map(row => row.name)
    assert.deepEqual(unsafeFunctions, [], '函数权限或安全属性不符合服务端专用约定')
    const unsafeTables = (await client.query(`select c.relname from pg_class c where c.relnamespace='public'::regnamespace
      and c.relname like 'adventure\\_%' escape '\\' and c.relkind='r'
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger,maintain')
        or has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger,maintain')
        or exists(select 1 from unnest(array['select','insert','update']) privilege where not has_table_privilege('service_role',c.oid,privilege))
        or has_table_privilege('service_role',c.oid,'delete,truncate,references,trigger,maintain,select with grant option,insert with grant option,update with grant option')
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)) order by c.relname`)).rows.map(row => row.relname)
    assert.deepEqual(unsafeTables, [], '表权限或 RLS 不符合服务端专用约定')
    const unsafeColumns = (await client.query(`select c.relname||'.'||a.attname as name from pg_class c join pg_attribute a on a.attrelid=c.oid
      where c.relnamespace='public'::regnamespace and c.relname like 'adventure\\_%' escape '\\' and c.relkind='r'
      and a.attnum>0 and not a.attisdropped and (has_column_privilege('anon',c.oid,a.attname,'select,insert,update,references')
        or has_column_privilege('authenticated',c.oid,a.attname,'select,insert,update,references')
        or has_column_privilege('service_role',c.oid,a.attname,'references,select with grant option,insert with grant option,update with grant option')
        or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee=0)) order by 1`)).rows.map(row => row.name)
    assert.deepEqual(unsafeColumns, [], '列权限不符合服务端专用约定')
    assert.equal((await client.query("select has_schema_privilege('anon','public','create') or has_schema_privilege('authenticated','public','create') unsafe")).rows[0].unsafe, false)
    assert.equal((await client.query("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0].rolbypassrls, true)
    assert.equal((await client.query("select to_regclass('public.adventure_mainlines') as relation")).rows[0].relation, null)
    await client.query(migration)
    assert.deepEqual(await capture(client), after, '重复执行改变了持久化事实')
    assertSchemaUnchanged(afterSchema, await schemaSnapshot(client), '重复执行改变了结构或安全属性')
    for (const unsafeCase of ['default_table', 'default_function', 'service_schema', 'role_bypass']) {
      await client.query(`create database goal_unsafe_fresh_${unsafeCase}`)
      const unsafeInit = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: `goal_unsafe_fresh_${unsafeCase}`, password: '', ssl: false })
      try {
        await unsafeInit.connect()
        if (unsafeCase === 'default_table') await unsafeInit.query('alter default privileges in schema public grant truncate on tables to goal_acl_parent')
        if (unsafeCase === 'default_function') await unsafeInit.query('alter default privileges in schema public grant execute on functions to goal_acl_parent')
        if (unsafeCase === 'service_schema') await unsafeInit.query('grant create on schema public to service_role')
        if (unsafeCase === 'role_bypass') await unsafeInit.query('alter role authenticated bypassrls')
        if (unsafeCase === 'default_table' || unsafeCase === 'default_function') await unsafeInit.query('grant goal_acl_parent to anon with inherit false, set true')
        const unsafeInitSchema = await schemaSnapshot(unsafeInit)
        const initialization = await readFile(join(root, 'db/adventure/create-planning.sql'), 'utf8')
        await assert.rejects(unsafeInit.query(initialization), error => error.message === 'GOAL_MIGRATION_UNSAFE_SECURITY', `新库接受了异常授权 ${unsafeCase}`)
        await unsafeInit.query('rollback')
        assertSchemaUnchanged(unsafeInitSchema, await schemaSnapshot(unsafeInit), `${unsafeCase}: 不安全的新库初始化未完全回滚`)
      } finally {
        if (unsafeCase === 'default_table' || unsafeCase === 'default_function') await client.query('revoke goal_acl_parent from anon')
        if (unsafeCase === 'role_bypass') await client.query('alter role authenticated nobypassrls')
        await unsafeInit.end()
        await client.query(`drop database goal_unsafe_fresh_${unsafeCase}`)
      }
    }
    await client.query('create database goal_fresh')
    const fresh = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'goal_fresh', password: '', ssl: false })
    try {
      await fresh.connect()
      for (const path of ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql']) {
        await fresh.query(await readFile(join(root, path), 'utf8'))
      }
      assertSchemaUnchanged(afterSchema, await schemaSnapshot(fresh), '新库和升级库的结构或安全属性不同')
      await fresh.query(businessRegression)
      await fresh.query(retiredRegression)
      await fresh.query(applyBoundaryRegression)
      await assertRoleDenials(fresh)
      assertSchemaUnchanged(afterSchema, await schemaSnapshot(fresh), '新库业务回归未回滚测试触发器')
      await fresh.query('begin')
      try {
        const freshOwner = '00000000-0000-4000-8000-000000000005'
        const today = (await fresh.query("select (clock_timestamp() at time zone 'Asia/Shanghai')::date::text today")).rows[0].today
        const command = async (request, version, value) => (await fresh.query('select public.adventure_planning_command($1,$2,$3,$4) result', [freshOwner, request, version, value])).rows[0].result
        const first = await command('fresh-create-goal', 0, { type: 'createGoal', title: '新目标', standards: ['完成'], categoryLabel: '\t 主题 \n' })
        const goalId = first.result.entityId
        assert.equal((await fresh.query('select category_label from public.adventure_goals where id=$1', [goalId])).rows[0].category_label, '主题')
        assert.equal(Number((await fresh.query("select count(*) n from public.adventure_goals where owner_id=$1 and kind='inbox'", [freshOwner])).rows[0].n), 0)
        const task = await command('fresh-create-task', first.version, { type: 'createTask', destination: goalId, title: '新任务', description: '', plannedOn: today })
        const done = await command('fresh-complete-task', task.version, { type: 'completeTask', id: task.result.entityId })
        const achievement = await command('fresh-achieve-goal', done.version, { type: 'achieveGoal', id: goalId })
        const snapshots = await fresh.query("select kind,snapshot->>'categoryLabel' label from public.adventure_events where owner_id=$1 and kind in ('task_completed','goal_achieved') order by kind", [freshOwner])
        assert.deepEqual(snapshots.rows.map(row => row.label), ['主题', '主题'])
        const standalone = await command('fresh-independent-task', achievement.version, { type: 'createTask', destination: '', title: '独立任务', description: '', plannedOn: today })
        assert.equal(Number((await fresh.query("select count(*) n from public.adventure_goals where owner_id=$1 and kind='inbox'", [freshOwner])).rows[0].n), 1)
        const standaloneDone = await command('fresh-independent-done', standalone.version, { type: 'completeTask', id: standalone.result.entityId })
        const independentSnapshot = (await fresh.query('select snapshot from public.adventure_events where id=$1', [standaloneDone.result.completionId])).rows[0].snapshot
        assert.equal(independentSnapshot.categoryLabel, null)
        const blank = await command('fresh-blank-goal', standaloneDone.version, { type: 'createGoal', title: '无分类', standards: ['完成'], categoryLabel: '\t\n' })
        assert.equal((await fresh.query('select category_label from public.adventure_goals where id=$1', [blank.result.entityId])).rows[0].category_label, null)
        for (const [request, value] of [
          ['fresh-long-label', { type: 'createGoal', title: '过长', standards: ['完成'], categoryLabel: '字'.repeat(201) }],
          ['fresh-old-command', { type: 'createMainline', name: '旧方向' }],
          ['fresh-old-parameter', { type: 'createGoal', title: '旧参数', standards: ['完成'], destination: '' }],
        ]) {
          await fresh.query('savepoint invalid_command')
          await assert.rejects(command(request, blank.version, value), error => error.message === 'INVALID_COMMAND')
          await fresh.query('rollback to savepoint invalid_command')
        }
      } finally {
        await fresh.query('rollback')
      }
      await fresh.query(migration)
      assertSchemaUnchanged(afterSchema, await schemaSnapshot(fresh), '在新库重复执行改变了结构或安全属性')
      await fresh.query('grant select on public.adventure_goals to anon')
      const unsafeFreshSchema = await schemaSnapshot(fresh)
      await assert.rejects(fresh.query(migration), error => error.message === 'GOAL_MIGRATION_UNSAFE_SECURITY')
      await fresh.query('rollback')
      assertSchemaUnchanged(unsafeFreshSchema, await schemaSnapshot(fresh), '重复执行失败未保留原结构')
      await fresh.query('revoke select on public.adventure_goals from anon')
      const freshOwner = '00000000-0000-4000-8000-000000000008'
      await fresh.query('select public.adventure_planning_command($1,$2,0,$3)',
        [freshOwner, 'fresh-acl-goal', { type: 'createGoal', title: '合成权限探针', standards: ['完成'] }])
      const freshBefore = await capture(fresh)
      for (const acl of unsafeMatrix) {
        await fresh.query(`grant ${acl.privilege}${acl.column ? ' (id)' : ''} on public.adventure_events to ${acl.grantee}${acl.delegation ? ' with grant option' : ''}`)
        if (acl.inherited) await fresh.query(`grant goal_acl_parent to ${acl.actor} with inherit false, set true`)
        await fresh.query(`set session authorization ${acl.actor}`)
        if (acl.inherited) await fresh.query('set role goal_acl_parent')
        const privilegeQuery = acl.column
          ? `select has_column_privilege(current_user,'public.adventure_events','id','${acl.privilege}${acl.delegation ? ' with grant option' : ''}') allowed`
          : `select has_table_privilege(current_user,'public.adventure_events','${acl.privilege}${acl.delegation ? ' with grant option' : ''}') allowed`
        assert.equal((await fresh.query(privilegeQuery)).rows[0].allowed, true, `fresh ${acl.id}`)
        await fresh.query('reset session authorization')
        const unsafeSchema = await schemaSnapshot(fresh)
        await assert.rejects(fresh.query(migration), error => error.message === 'GOAL_MIGRATION_UNSAFE_SECURITY', `fresh ${acl.id}`)
        await fresh.query('rollback')
        assertSchemaUnchanged(unsafeSchema, await schemaSnapshot(fresh), `fresh ${acl.id}: failed migration changed schema`)
        assert.deepEqual(await capture(fresh), freshBefore, `fresh ${acl.id}: failed migration changed data`)
        if (acl.delegation && acl.grantee === 'service_role' && !acl.column) {
          await fresh.query(`revoke grant option for ${acl.privilege} on public.adventure_events from service_role`)
        } else {
          await fresh.query(`revoke ${acl.privilege}${acl.column ? ' (id)' : ''} on public.adventure_events from ${acl.grantee}`)
        }
        if (acl.inherited) await fresh.query(`revoke goal_acl_parent from ${acl.actor}`)
      }
      for (const inherited of [false, true]) {
        const grantee = inherited ? 'goal_acl_parent' : 'service_role'
        await fresh.query(`grant execute on function public.adventure_task_capability(uuid,jsonb,date) to ${grantee} with grant option`)
        if (inherited) await fresh.query('grant goal_acl_parent to service_role with inherit false, set true')
        await fresh.query('set session authorization service_role')
        if (inherited) await fresh.query('set role goal_acl_parent')
        await fresh.query('begin')
        await fresh.query('grant execute on function public.adventure_task_capability(uuid,jsonb,date) to anon')
        await fresh.query('rollback')
        await fresh.query('reset session authorization')
        const unsafeSchema = await schemaSnapshot(fresh)
        await assert.rejects(fresh.query(migration), error => error.message === 'GOAL_MIGRATION_UNSAFE_SECURITY')
        await fresh.query('rollback')
        assertSchemaUnchanged(unsafeSchema, await schemaSnapshot(fresh), '函数转授权失败未回滚')
        assert.deepEqual(await capture(fresh), freshBefore, '函数转授权失败改变了业务数据')
        if (inherited) {
          await fresh.query('revoke execute on function public.adventure_task_capability(uuid,jsonb,date) from goal_acl_parent')
          await fresh.query('revoke goal_acl_parent from service_role')
        } else {
          await fresh.query('revoke grant option for execute on function public.adventure_task_capability(uuid,jsonb,date) from service_role')
        }
      }
      assertSchemaUnchanged(afterSchema, await schemaSnapshot(fresh), '权限矩阵清理未恢复新库结构')
      await fresh.query('set role anon')
      await assert.rejects(fresh.query('select * from public.adventure_goals'), error => error.code === '42501')
      await fresh.query('reset role')
      const parallel = await Promise.all([1, 2].map(async n => {
        const connection = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'goal_fresh', password: '', ssl: false })
        try {
          await connection.connect()
          await connection.query('set role service_role')
          const result = await connection.query('select public.adventure_planning_command($1,$2,0,$3) result',
            ['00000000-0000-4000-8000-000000000006', `fresh-race-${n}`, { type: 'createGoal', title: `并发${n}`, standards: ['完成'] }])
          return result.rows[0].result
        } catch (error) { return error } finally { await connection.end() }
      }))
      assert.equal(parallel.filter(result => result instanceof Error && result.message === 'VERSION_CONFLICT').length, 1)
      assert.equal(parallel.filter(result => !(result instanceof Error) && result.version === 1).length, 1)
      // Distinct exposed apply helpers race on the same account version.  Both
      // must use the same lock and only one may publish an event/reward.
      for (const [database, db] of [['postgres', client], ['goal_fresh', fresh]]) {
        const owner = '00000000-0000-4000-8000-000000000099'
        const create = async (request, version) => (await db.query('select public.adventure_planning_command($1,$2,$3,$4) result',
          [owner, request, version, { type: 'createGoal', title: '并发执行器', standards: ['完成'] }])).rows[0].result
        const achievement = await create('apply-race-create-a', 0)
        const ending = await create('apply-race-create-b', 1)
        const calls = [
          ['adventure_goal_apply', 'apply-race-achieve', { type: 'achieveGoal', id: achievement.result.entityId }],
          ['adventure_lifecycle_apply', 'apply-race-end', { type: 'endGoal', id: ending.result.entityId }],
        ]
        const outcomes = await Promise.all(calls.map(async ([fn, request, command]) => {
          const connection = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database, password: '', ssl: false })
          try {
            await connection.connect()
            await connection.query('set role service_role')
            return (await connection.query(`select public.${fn}($1,$2,2,$3,clock_timestamp()) result`, [owner, request, command])).rows[0].result
          } catch (error) { return error } finally { await connection.end() }
        }))
        assert.equal(outcomes.filter(result => result instanceof Error && result.message === 'VERSION_CONFLICT').length, 1, `${database}: apply race conflict`)
        assert.equal(outcomes.filter(result => !(result instanceof Error) && result.version === 3).length, 1, `${database}: apply race success`)
        const state = (await db.query('select revision,total_xp,(select count(*) from public.adventure_events where owner_id=$1) events from public.adventure_accounts where owner_id=$1', [owner])).rows[0]
        assert.equal(Number(state.revision), 3)
        assert.equal(Number(state.events), 3)
        assert.equal(Number(state.total_xp), outcomes[0] instanceof Error ? 0 : 1)
      }
      console.log('通过：新库和升级库业务回归、历史锁定与回执、权限及并发')
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
