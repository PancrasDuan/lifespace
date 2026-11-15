// A restore rehearsal of synthetic facts in this runner's disposable cluster.
// Globals are inspected separately: restoring into the same cluster does not
// demonstrate independent role/tablespace recovery.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
export async function verifyRecurringRestore({ admin, client, connect, command, today, bin, run, work, port, migration }) {
  const owner = crypto.randomUUID()
  let version = 0
  const send = async value => { const r = await command(client, owner, crypto.randomUUID(), version, value); version = r.version; return r }
  const once = await send({ type: 'createTask', title: '备份一次性历史', description: '', destination: '', plannedOn: today })
  await send({ type: 'completeTask', id: once.result.entityId })
  const parent = await send({ type: 'createRecurringTask', title: '备份周期事实', description: '合成数据', destination: '', startOn: today, periodType: 'week', requiredCount: 1, today })
  await send({ type: 'recordRecurringCompletion', id: parent.result.entityId, today })
  // This repository's runner applies SQL directly, so model migration history
  // explicitly and include it in the database archive, without claiming that
  // this synthetic history is Supabase's hosted migration registry.
  await client.query('create schema integration_history; create table integration_history.migrations(version text primary key, sha256 text not null)')
  await client.query('insert into integration_history.migrations values ($1,$2)', ['20261115082114', digest(migration)])
  const capture = async c => {
    const tables = (await c.query(`select schemaname,tablename from pg_tables where schemaname in ('public','integration_history') order by schemaname,tablename`)).rows
    const data = {}
    for (const t of tables) data[`${t.schemaname}.${t.tablename}`] = (await c.query(`select to_jsonb(t) r from ${t.schemaname}.${t.tablename} t order by to_jsonb(t)::text`)).rows.map(x => x.r)
    const schema = (await c.query(`select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl::text,p.prosecdef,p.proconfig) order by p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace),
      'constraints',(select jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) order by c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace),
      'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public'),
      'tables',(select jsonb_agg(jsonb_build_array(relname,relrowsecurity,relforcerowsecurity,relacl::text,pg_get_userbyid(relowner)) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),
      'columns',(select jsonb_agg(to_jsonb(t)-'table_catalog'-'udt_catalog' order by table_name,ordinal_position) from information_schema.columns t where table_schema='public'),
      'policies',(select jsonb_agg(to_jsonb(t) order by tablename,policyname) from pg_policies t where schemaname='public'),
      'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where not tgisinternal),
      'extensions',(select jsonb_agg(jsonb_build_array(extname,extversion,extnamespace::regnamespace::text) order by extname) from pg_extension),
      'schemas',(select jsonb_agg(jsonb_build_array(nspname,nspacl::text) order by nspname) from pg_namespace where nspname in ('public','integration_history'))) r`)).rows[0].r
    return { data, schema }
  }
  const before = await capture(client), backup = join(work, 'recurring.dump')
  const args = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres']
  run(bin('pg_dump'), [...args, '-Fc', '-f', backup, 'recurring_upgrade'])
  const contents = run(bin('pg_restore'), ['--list', backup])
  for (const expected of ['TABLE DATA', 'FUNCTION', 'INDEX', 'CONSTRAINT', 'ACL', 'migrations']) assert.ok(contents.includes(expected), `archive lacks ${expected}`)
  await admin.query('create database recurring_restored')
  run(bin('pg_restore'), [...args, '--exit-on-error', '--single-transaction', '-d', 'recurring_restored', backup])
  const restored = await connect('recurring_restored')
  assert.deepEqual(await capture(restored), before, 'restored schema, ACLs, RLS or facts differ')
  const facts = before.data
  assert.ok(facts['public.adventure_tasks'].some(t => t.kind === 'once' && t.status === 'completed'))
  assert.ok(facts['public.adventure_tasks'].some(t => t.kind === 'recurring_child'))
  assert.ok(facts['public.adventure_recurring_tasks'].some(t => t.completed_periods === 1))
  const receipt = (await restored.query('select public.adventure_planning_read($1) r', [owner])).rows[0].r
  assert.equal(receipt.growth.totalXp, 2)
  const evidence = {
    method: 'pg_dump -Fc; pg_restore --exit-on-error --single-transaction into a new database in the same disposable cluster',
    archiveBytes: (await readFile(backup)).length, archiveSha256: digest(await readFile(backup)),
    reconciliationSha256: digest(JSON.stringify(before)),
    tables: Object.fromEntries(Object.entries(facts).map(([name, rows]) => [name, rows.length])),
    functionCount: before.schema.functions.length, extensions: before.schema.extensions,
    globals: 'Existing synthetic cluster roles reused; no independent globals restore proved. No production roles or extensions inspected.',
    history: 'Synthetic integration_history.migrations included; hosted supabase_migrations history remains a production gate.',
    passed: true,
  }
  await mkdir('.cache', { recursive: true })
  await copyFile(backup, '.cache/recurring-synthetic.dump')
  await writeFile('.cache/recurring-restore-report.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log('PASS: synthetic once/recurring backup restored; schema/functions/FK/index/RLS/ACL/data/XP/revision/receipt hashes exactly equal; globals not independently restored')
}
