import assert from 'node:assert/strict'

// Run against the disposable ledger database, before PostgREST starts.
export async function verifyAgentBindingsRetirement(client, migration) {
  const state = async () => (await client.query(`select
    to_regclass('public.agent_identity_bindings') is not null as bindings,
    to_regprocedure('public.agent_resolve_owner(text)') is not null as resolver,
    to_regclass('public.agent_oauth_grants')::text as oauth_table,
    (select count(*)::int from public.agent_oauth_grants) as oauth_rows,
    (select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname)
       from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'agent_oauth_%') as oauth_functions`)).rows[0]
  const before = await state()
  assert(before.bindings && before.resolver)
  const reject = async pattern => {
    await assert.rejects(client.query(migration), pattern)
    await client.query('rollback')
    assert.deepEqual(await state(), before, 'Failed migration must restore resolver and preserve OAuth')
  }
  const owner = '00000000-0000-4000-8000-000000000204'
  await client.query(`insert into auth.users(id) values ($1)`, [owner])
  await client.query(`insert into public.agent_identity_bindings(client_id,owner_id) values ('synthetic-retirement-guard.access',$1)`, [owner])
  await reject(/LEGACY_BINDINGS_NOT_EMPTY/)
  assert.equal((await client.query('select count(*)::int as n from public.agent_identity_bindings')).rows[0].n, 1)
  await client.query(`delete from public.agent_identity_bindings where client_id='synthetic-retirement-guard.access'`)
  await client.query('delete from auth.users where id=$1', [owner])

  for (const body of [
    'select count(*) from public.agent_identity_bindings',
    'select count(*) from public.AGENT_IDENTITY_BINDINGS',
    "select case when public.AGENT_RESOLVE_OWNER('synthetic-retired.access') is null then 0::bigint else 1::bigint end",
  ]) {
    await client.query(`create function public.retirement_reference_probe() returns bigint language sql as $probe$${body}$probe$`)
    await reject(/LEGACY_BINDINGS_STILL_REFERENCED/)
    await client.query('drop function public.retirement_reference_probe()')
  }

  // The resolver is dropped first, but a dependent view must roll the entire
  // transaction back rather than cascade-delete the view or leave half a change.
  await client.query('create view public.retirement_view_probe as select client_id from public.agent_identity_bindings')
  await reject(/cannot drop table.*because other objects depend/)
  assert.equal((await client.query('select * from public.retirement_view_probe')).rowCount, 0)
  await client.query('drop view public.retirement_view_probe')

  await client.query(migration)
  assert.deepEqual(await state(), { ...before, bindings: false, resolver: false })
  await client.query(migration)
  assert.deepEqual(await state(), { ...before, bindings: false, resolver: false })
  console.log('通过：旧绑定迁移拒绝非空、拒绝函数/视图依赖并完整回滚；删除与重放保持 OAuth 对象不变')
}
