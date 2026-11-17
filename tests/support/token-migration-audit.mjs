import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

// Additive migration + complete database backup/restore in this run's cluster.
// The existing-app fixture uses actual ledger and OAuth DDL, never a remote URL.
export async function auditTokenMigrations(admin, url, files, work, bin) {
  const command = async (name, args) => {
    const child = spawn(bin(name), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c)
    const [code] = await once(child, 'exit')
    if (code !== 0) throw Error(`${name} failed (${code}): ${output.slice(-500)}`)
  }
  const connection = name => { const u = new URL(url); u.pathname = '/' + name; return u.href }
  const auditACL = async db => {
    const rls = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='token_private' and c.relkind='r' order by c.relname")).rows
    assert.equal(rls.length, 5); assert(rls.every(r => r.relrowsecurity))
    const functions = (await db.query("select p.proname,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'token_%' order by p.proname")).rows
    assert.deepEqual(functions.filter(f => f.anon).map(f => f.proname), ['token_usage_heartbeat', 'token_usage_upload'])
    assert(functions.every(f => !f.authenticated && f.proconfig?.includes('search_path=""')))
    const permissions = (await db.query("select has_schema_privilege(role,'token_private','usage') allowed from unnest(array['anon','authenticated','service_role']) role")).rows
    assert(permissions.every(p => !p.allowed))
    return { rls, functions, permissions }
  }
  await admin.query('create database token_compat'); await admin.query('create database token_restore')
  const db = new pg.Client({ connectionString: connection('token_compat') }); await db.connect()
  const restored = new pg.Client({ connectionString: connection('token_restore') }); await restored.connect()
  try {
    await db.query('create schema auth; create table auth.users(id uuid primary key); create schema extensions;')
    for (const file of ['db/ledger/create-ledger.sql', 'db/agent/migrations/20261106031343_agent_access_bindings.sql', 'db/agent/migrations/20261114130000_agent_oauth_grants.sql', 'db/agent/migrations/20261117000000_mcp_ledger_entries_read_scope.sql', 'db/agent/migrations/20261115151152_retire_legacy_agent_bindings.sql']) await db.query(await readFile(file, 'utf8'))
    await db.query("insert into auth.users values('00000000-0000-4000-8000-000000000219'); insert into public.ledger_owner_revision(owner_id,revision) values('00000000-0000-4000-8000-000000000219',7)")
    const before = (await db.query('select row_to_json(t) v from public.ledger_owner_revision t')).rows
    for (const file of files) await db.query(await readFile(join('db/token/migrations', file), 'utf8'))
    assert.deepEqual((await db.query('select row_to_json(t) v from public.ledger_owner_revision t')).rows, before)
    assert.equal((await db.query("select to_regclass('public.agent_identity_bindings') old,to_regclass('public.agent_oauth_grants') oauth")).rows[0].old, null)
    await db.query("insert into token_private.devices(device_id,hostname,platform,owner_id,generation,token_hash) values('synthetic-migration-219','synthetic-compat','linux','00000000-0000-4000-8000-000000000219',1,extensions.digest('synthetic-no-credential','sha256'))")
    const acl = await auditACL(db)
    // The dump includes schema, functions, constraints, RLS, ACLs and data. No
    // --no-acl/--no-owner shortcut; harness roles are present in both databases.
    const backup = join(work, 'compat.dump')
    await command('pg_dump', ['--format=custom', '--file', backup, connection('token_compat')])
    await command('pg_restore', ['--exit-on-error', '--dbname', connection('token_restore'), backup])
    assert.deepEqual(await auditACL(restored), acl)
    assert.deepEqual((await restored.query('select row_to_json(t) v from public.ledger_owner_revision t')).rows, before)
    assert.deepEqual((await restored.query('select row_to_json(t) v from token_private.devices t')).rows, (await db.query('select row_to_json(t) v from token_private.devices t')).rows)
    assert((await restored.query("select to_regprocedure('public.agent_oauth_grants_list(uuid,timestamp with time zone,uuid)') fn")).rows[0].fn)
    assert.equal((await restored.query("select count(*)::int n from pg_constraint where conrelid='public.agent_oauth_grants'::regclass and contype='c' and pg_get_constraintdef(oid) like '%ledger:entries:read%'")).rows[0].n, 1)
    console.log('Token migration audit: empty baseline + compatible ledger/OAuth/retired-bindings state; existing facts preserved; full database dump restored with data, functions, RLS and ACLs (existing harness roles).')
  } finally { await db.end(); await restored.end() }
}
