import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

// This suite owns a new PG17 cluster; it never accepts an existing database URL.
const work = await mkdtemp(join(tmpdir(), 'ledger126-db-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const binary = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const run = (name, args) => {
  const result = spawnSync(binary(name), args, { env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
}
const oldChain = ['create-ledger', 'list-ledger', 'refunds', 'delete', 'accounts', 'account-entries', 'transfers']
const migrationPath = 'db/ledger/migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql'
let db, started = false
try {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  run('initdb', ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start'])
  started = true
  db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await db.connect()
  assert.match((await db.query('select version()')).rows[0].version, /PostgreSQL 17\./)
  console.log(`PostgreSQL 17 isolated loopback port ${port}`)
  await db.query('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role')
  const install = async () => {
    await db.query('drop schema public cascade; create schema public; grant usage on schema public to service_role')
    for (const name of oldChain) await db.query(await readFile(`db/ledger/${name}.sql`, 'utf8'))
    await db.query("set search_path=pg_catalog,public; set timezone='UTC'")
  }
  const catalog = await readFile('db/ledger/maintenance/legacy-backfill-catalog.sql', 'utf8')
  const factsSql = catalog.replace(/select encode\(sha256\(convert_to\(jsonb_object_agg[\s\S]+$/, 'select jsonb_object_agg(key,value) as facts from facts')
  const fingerprint = async () => (await db.query(catalog)).rows[0].catalog_hash
  const facts = async () => (await db.query(factsSql)).rows[0].facts
  const data = async () => (await db.query(`select jsonb_build_object(
    'owners',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.ledger_owner_revision t),
    'accounts',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_accounts t),
    'entries',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_entries t),
    'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_balance_adjustments t)) as data`)).rows[0].data
  const functionProperties = async () => (await db.query(`select to_jsonb(p) as properties from pg_proc p
    where oid='public.ledger_entry_immutable()'::regprocedure`)).rows[0].properties
  const snapshot = async () => ({ facts: await facts(), data: await data(), function: await functionProperties(),
    views: (await db.query("select viewname,definition from pg_views where schemaname='public' order by viewname")).rows })
  const migration = await readFile(migrationPath, 'utf8')
  const migrate = async (sql = migration) => db.query(sql)
  const rpc = async (name, args) => {
    await db.query('set role service_role')
    try {
      return (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as receipt`, args)).rows[0].receipt
    } finally { await db.query('reset role') }
  }
  const entry = accountId => ({ requestId: crypto.randomUUID(), direction: 'expense', amountCents: -1000,
    occurredAt: '2025-01-01T00:00:00Z', accountId, categoryCode: 'dining', note: '合成支出' })
  const fixture = async () => {
    await install()
    const owner = crypto.randomUUID(), other = crypto.randomUUID()
    const account = (await rpc('ledger_account_create', [owner, { requestId: crypto.randomUUID(), name: '合成银行卡', balanceCents: 10000 }])).accountId
    const second = (await rpc('ledger_account_create', [owner, { requestId: crypto.randomUUID(), name: '合成钱包', balanceCents: -200 }])).accountId
    const otherAccount = (await rpc('ledger_account_create', [other, { requestId: crypto.randomUUID(), name: '合成其他所有者', balanceCents: 55 }])).accountId
    const parent = (await rpc('ledger_create', [owner, entry(account)])).entryId
    await rpc('ledger_refund', [owner, parent, { requestId: crypto.randomUUID(), amountCents: 100, occurredAt: '2025-01-02T00:00:00Z', note: '合成退款' }])
    await rpc('ledger_account_update', [owner, account, { requestId: crypto.randomUUID(), name: '合成现名', balanceCents: 9000, expectedBalanceCents: 9100 }])
    await rpc('ledger_transfer', [owner, { requestId: crypto.randomUUID(), fromAccountId: account, toAccountId: second, amountCents: 300, occurredAt: '2025-01-03T00:00:00Z' }])
    const deleted = (await rpc('ledger_create', [other, entry(otherAccount)])).entryId
    const scope = (await rpc('ledger_delete_preview', [other, deleted])).scope
    await rpc('ledger_delete', [other, deleted, scope])
    return { owner, other, account, parent }
  }
  const rejected = async (pattern, sql = migration) => {
    const before = await snapshot()
    await assert.rejects(migrate(sql), pattern)
    await db.query('rollback')
    assert.deepEqual(await snapshot(), before, 'failed migration must preserve all schema and data')
  }
  for (const name of ['old name', 'empty old name', 'unassigned account', 'unknown index', 'unknown check', 'unknown view', 'disabled protection', 'changed function context']) {
    const { owner } = await fixture()
    if (['old name', 'empty old name', 'unassigned account'].includes(name)) {
      if (name === 'empty old name') await db.query('alter table public.ledger_entries drop constraint ledger_entries_account_name_check')
      await db.query(`insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code)
        values($1,gen_random_uuid(),'expense',-1,'2025-01-01T00:00:00Z',$2,'dining')`,
        [owner, name === 'old name' ? '合成残留' : name === 'empty old name' ? '' : null])
    } else if (name === 'unknown index') await db.query('create index ledger126_unreviewed_dependency on public.ledger_entries(account_name)')
    else if (name === 'unknown check') await db.query('alter table public.ledger_entries add constraint ledger126_unreviewed_check check(account_name is null)')
    else if (name === 'unknown view') await db.query('create view public.ledger126_unreviewed_view as select account_name from public.ledger_entries')
    else if (name === 'disabled protection') await db.query('alter table public.ledger_entries disable trigger ledger_entry_immutable')
    else await db.query('alter function public.ledger_entry_immutable() set search_path=public')
    await rejected(['old name', 'empty old name', 'unassigned account'].includes(name) ? /ACCOUNT_NAME_CLEANUP_LEGACY_DATA/
      : name === 'unknown view' ? /other objects depend/ : /ACCOUNT_NAME_CLEANUP_CATALOG_DRIFT/)
    console.log(`PASS rejected ${name}; complete schema/data unchanged`)
  }
  for (const marker of ['execute immutable_ddl;', 'drop constraint ledger_entries_account_name_check restrict;',
    'drop constraint ledger_entries_account_name_snapshot restrict;', 'alter column account_id set not null;', 'drop column account_name restrict;']) {
    await fixture()
    assert.ok(migration.includes(marker))
    await rejected(/LEDGER126_INJECTED_FAILURE/, migration.replace(marker, marker + " raise exception 'LEDGER126_INJECTED_FAILURE';"))
    console.log(`PASS atomic rollback after ${marker}`)
  }
  await fixture()
  await rejected(/ACCOUNT_NAME_CLEANUP_DATA_CHANGED/, migration.replace('execute immutable_ddl;',
    'execute immutable_ddl; update public.ledger_owner_revision set revision=revision+1;'))
  await rejected(/ACCOUNT_NAME_CLEANUP_POSTCONDITION/, migration.replace(
    'a022cf8559153d2dcdbf9810a212138cd61595d29dac0054bf565f462a9fe272', '0'.repeat(64)))
  console.log('PASS injected data change and failed final catalog check roll back all data and DDL')
  const upgraded = await fixture()
  // pg_get_functiondef must preserve properties outside the historical fingerprint too.
  await db.query('alter function public.ledger_entry_immutable() cost 321')
  const before = await snapshot()
  assert.equal(await fingerprint(), '04898ad1a371ac32cb793acbf9aeaa93631d41a1d9acebcfd0c05e0e42e21e9c')
  await migrate()
  const after = await snapshot()
  const expected = structuredClone(before)
  expected.data.entries = expected.data.entries.map(({ account_name, ...row }) => { assert.equal(account_name, null); return row })
  delete expected.facts['column:ledger_entries:account_name']
  delete expected.facts['constraint:ledger_entries:ledger_entries_account_name_check']
  delete expected.facts['constraint:ledger_entries:ledger_entries_account_name_snapshot']
  expected.facts['column:ledger_entries:account_id'][2] = true
  const withoutName = source => source.replace('new.account_name,', '').replace('old.account_name,', '')
  expected.facts['function:ledger_entry_immutable()'][0] = withoutName(expected.facts['function:ledger_entry_immutable()'][0])
  expected.function.prosrc = withoutName(expected.function.prosrc)
  assert.deepEqual(after, expected)
  assert.equal(await fingerprint(), 'a022cf8559153d2dcdbf9810a212138cd61595d29dac0054bf565f462a9fe272')
  assert.equal((await rpc('ledger_detail', [upgraded.owner, upgraded.parent])).entry.accountName, '合成现名')
  await rejected(/ACCOUNT_NAME_CLEANUP_STATE/)
  console.log('PASS populated upgrade: exact expected schema diff; all four tables, balances, versions, ACL/RLS/FK/triggers/function properties retained; repeat refuses safely')
  for (const name of ['ledger', 'ledger-accounts', 'ledger-transfers']) await db.query(await readFile(`tests/database/${name}.sql`, 'utf8'))
  console.log('PASS current physical retention, every immutable field, NOT NULL, owner FK, ACL/RLS and transfer pair probes')
  await install()
  await migrate()
  assert.equal((await db.query(`select count(*)::int as count from pg_attribute
    where attrelid='public.ledger_entries'::regclass and attname='account_name' and not attisdropped`)).rows[0].count, 0)
  assert.equal((await db.query(`select attnotnull from pg_attribute
    where attrelid='public.ledger_entries'::regclass and attname='account_id'`)).rows[0].attnotnull, true)
  console.log(`After catalog SHA-256 ${await fingerprint()}`)
  console.log('PASS fresh installation ends without account_name and with required account_id')
} finally {
  await db?.end()
  if (started) run('pg_ctl', ['-D', work, '-m', 'fast', '-w', 'stop'])
  await rm(work, { recursive: true, force: true })
}
