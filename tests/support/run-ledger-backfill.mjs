import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { renderLedgerBackfill } from '../../scripts/render-ledger-backfill.mjs'

// Always create a new cluster; no connection URL or pre-existing database accepted.
const work = await mkdtemp(join(tmpdir(), 'ledger124-db-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG')))
const bin = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const run = (name, args) => {
  const result = spawnSync(bin(name), args, { env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
}
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
  for (const name of ['create-ledger', 'list-ledger', 'refunds', 'delete', 'accounts', 'account-entries', 'transfers']) {
    await db.query(await readFile(`db/ledger/${name}.sql`, 'utf8'))
  }
  const owner = '12400000-0000-4000-8000-000000000001'
  await db.query('insert into public.ledger_owner_revision(owner_id,revision) values($1,14)', [owner])
  const groups = ['合成银行卡', '合成钱包', '合成现金'].map((name, i) => ({ name, requestId: `12400000-0000-4000-8001-00000000000${i}`, entryIds: [] }))
  for (let i = 1; i <= 14; i++) {
    const id = `12400000-0000-4000-8002-${String(i).padStart(12, '0')}`
    const group = groups[i <= 12 ? 0 : i - 12]
    group.entryIds.push(id)
    await db.query(`insert into public.ledger_entries(id,owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note)
      values($1,$2,gen_random_uuid(),'expense',$3,'2026-01-02T03:04:05Z',$4,'dining','合成旧支出')`, [id, owner, -i * 100, group.name])
  }
  const snapshot = async () => (await db.query('select to_jsonb(e) as entry from public.ledger_entries e order by id')).rows.map(r => r.entry)
  await db.query("set search_path=pg_catalog,public; set timezone='UTC'")
  const before = await snapshot()
  // First tracer: the delivered SQL must migrate a real legacy set atomically.
  const catalog = await readFile('db/ledger/maintenance/legacy-backfill-catalog.sql', 'utf8')
  await db.query("set search_path=pg_catalog,public; set timezone='UTC'")
  const catalogHash = (await db.query(catalog)).rows[0].catalog_hash
  console.log(`Reviewed local catalog SHA-256 ${catalogHash}`)
  const input = { ownerId: owner, revision: 14, catalogHash, groups }
  const migrate = async (value = input) => db.query(await renderLedgerBackfill(value))
  await migrate()
  const after = await snapshot()
  assert.deepEqual(after.map(({ account_id, account_name, ...e }) => e), before.map(({ account_id, account_name, ...e }) => e))
  assert.ok(after.every(e => e.account_id && e.account_name === null))
  assert.equal((await db.query('select revision from public.ledger_owner_revision where owner_id=$1', [owner])).rows[0].revision, '15')
  const accounts = (await db.query('select * from public.ledger_accounts order by name')).rows
  assert.equal(accounts.length, 3)
  assert.ok(accounts.every(a => a.balance_cents === '0'))
  console.log('PASS success: exact 14 entries, preserved fields, three zero balances, revision +1')
  const state = async () => (await db.query(`select jsonb_build_object(
    'owners',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.ledger_owner_revision t),
    'accounts',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_accounts t),
    'entries',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_entries t),
    'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_balance_adjustments t)) as state`)).rows[0].state
  const fingerprint = async () => (await db.query(catalog)).rows[0].catalog_hash
  const rpc = async (name, args) => {
    await db.query('set role service_role')
    try {
      const placeholders = args.map((_, i) => '$' + (i + 1)).join(',')
      return (await db.query(`select public.${name}(${placeholders}) as receipt`, args)).rows[0].receipt
    } finally { await db.query('reset role') }
  }
  const unchanged = async action => {
    const before = await state()
    await action()
    assert.deepEqual(await state(), before)
    assert.equal(await fingerprint(), catalogHash)
  }
  await unchanged(() => migrate())
  const page = await rpc('ledger_list', [owner])
  assert.equal(page.total, 14)
  assert.equal(page.version, 15)
  for (const group of groups) {
    const account = accounts.find(a => a.request_id === group.requestId)
    const actual = after.filter(e => e.account_id === account.id).map(e => e.id).sort()
    assert.deepEqual(actual, [...group.entryIds].sort())
    for (const id of group.entryIds) {
      const detail = await rpc('ledger_detail', [owner, id])
      assert.equal(detail.entry.accountName, group.name)
      assert.equal(detail.entry.accountId, account.id)
    }
  }
  assert.equal((await rpc('ledger_accounts_list', [owner])).accounts.length, 3)
  await assert.rejects(db.query('update public.ledger_entries set amount_cents=-777 where id=$1', [groups[0].entryIds[0]]), /LEDGER_IMMUTABLE/)
  assert.equal((await db.query('select count(*) from public.ledger_balance_adjustments')).rows[0].count, '0')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.query(`set role ${role}`)
    try { await assert.rejects(db.query('select * from public.ledger_entries'), /permission denied/) }
    finally { await db.query('reset role') }
  }
  await db.query('set role anon')
  try { await assert.rejects(db.query('select public.ledger_list($1)', [owner]), /permission denied/) }
  finally { await db.query('reset role') }
  await assert.rejects(db.query("update public.ledger_accounts set request_hash=repeat('0',64)"), /LEDGER_IMMUTABLE/)
  console.log('PASS exact grouping, service-role list/detail visibility, restored immutable protection, immediate retry no-op')

  const account = accounts.find(a => a.request_id === groups[0].requestId)
  await rpc('ledger_account_update', [owner, account.id, { requestId: crypto.randomUUID(), name: '合成更名', balanceCents: 5000, expectedBalanceCents: 0 }])
  const entryInput = accountId => ({ requestId: crypto.randomUUID(), direction: 'expense', amountCents: -250,
    occurredAt: '2026-01-03T03:04:05Z', accountId, categoryCode: 'dining', note: '合成迁移后支出' })
  await assert.rejects(db.query('update public.ledger_balance_adjustments set after_cents=1'), /LEDGER_IMMUTABLE/)
  await rpc('ledger_create', [owner, entryInput(account.id)])
  await unchanged(() => migrate())
  const renamed = await rpc('ledger_detail', [owner, groups[0].entryIds[0]])
  assert.equal(renamed.entry.accountName, '合成更名')
  const preview = await rpc('ledger_delete_preview', [owner, groups[0].entryIds[0]])
  const deleted = await rpc('ledger_delete', [owner, groups[0].entryIds[0], preview.scope])
  const balance = async () => (await rpc('ledger_accounts_list', [owner])).accounts.find(a => a.id === account.id).balanceCents
  assert.equal(await balance(), 4850) // 5000 - 250 + original expense 100
  await unchanged(() => rpc('ledger_delete', [owner, groups[0].entryIds[0], preview.scope]))
  await unchanged(() => migrate())
  assert.equal((await rpc('ledger_accounts_list', [owner])).version, deleted.version)
  console.log('PASS retry preserves committed rename, correction, new expense and deletion; deletion adds 100 once')

  const fixture = async (names) => {
    const fixtureOwner = crypto.randomUUID()
    const fixtureGroups = groups.map((g, i) => ({ name: names?.[i] ?? g.name, requestId: crypto.randomUUID(), entryIds: g.entryIds.map(() => crypto.randomUUID()) }))
    await db.query('insert into public.ledger_owner_revision(owner_id,revision) values($1,14)', [fixtureOwner])
    for (const group of fixtureGroups) for (const id of group.entryIds) {
      await db.query(`insert into public.ledger_entries(id,owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note)
        values($1,$2,gen_random_uuid(),'expense',-100,'2026-01-02T03:04:05Z',$3,'dining','合成失败验证')`, [id, fixtureOwner, group.name])
    }
    return { ownerId: fixtureOwner, revision: 14, catalogHash, groups: fixtureGroups }
  }
  const rejected = async (value, pattern, transform = sql => sql) => unchanged(async () => {
    await assert.rejects(db.query(transform(await renderLedgerBackfill(value))), pattern)
    await db.query('rollback')
  })
  const drift = await fixture()
  await rejected({ ...drift, revision: 13 }, /BACKFILL_REVISION_DRIFT/)
  const wrongIds = structuredClone(drift)
  wrongIds.groups[0].entryIds[0] = crypto.randomUUID()
  await rejected(wrongIds, /BACKFILL_SCOPE_DRIFT/)
  const wrongName = structuredClone(drift)
  wrongName.groups[0].name = '合成未批准名称'
  await rejected(wrongName, /BACKFILL_SCOPE_DRIFT/)
  const duplicate = structuredClone(drift)
  duplicate.groups[0].entryIds[0] = duplicate.groups[0].entryIds[1]
  await rejected(duplicate, /duplicate key/)
  const crossOwner = structuredClone(drift)
  crossOwner.groups[0].entryIds[0] = groups[0].entryIds[0]
  await rejected(crossOwner, /BACKFILL_SCOPE_DRIFT/)
  await rejected({ ...drift, catalogHash: '0'.repeat(64) }, /BACKFILL_CATALOG_DRIFT/)
  const extra = await fixture()
  await db.query(`insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code)
    values($1,gen_random_uuid(),'expense',-100,'2026-01-02T03:04:05Z','合成新增旧流水','dining')`, [extra.ownerId])
  await rejected(extra, /BACKFILL_SCOPE_DRIFT/)
  const deletedFixture = await fixture()
  await db.query('update public.ledger_entries set deleted_at=now() where id=$1', [deletedFixture.groups[0].entryIds[0]])
  await rejected(deletedFixture, /BACKFILL_SCOPE_DRIFT/)
  const mixed = await fixture()
  await rpc('ledger_account_create', [mixed.ownerId, { requestId: mixed.groups[0].requestId, name: mixed.groups[0].name, balanceCents: 0 }])
  await rejected({ ...mixed, revision: 15 }, /BACKFILL_ACCOUNT_STATE/)
  const partial = await fixture()
  await migrate(partial)
  await db.query(`begin; alter table public.ledger_entries disable trigger ledger_entry_immutable;
    update public.ledger_entries set account_id=null,account_name='合成银行卡' where id='${partial.groups[0].entryIds[0]}';
    set constraints public.ledger_transfer_pair immediate;
    alter table public.ledger_entries enable trigger ledger_entry_immutable; commit;`)
  await rejected(partial, /BACKFILL_REVISION_DRIFT/)
  const collision = await fixture()
  await rpc('ledger_account_create', [collision.ownerId, { requestId: crypto.randomUUID(), name: collision.groups[0].name, balanceCents: 0 }])
  await rejected({ ...collision, revision: 15 }, /BACKFILL_ACCOUNT_STATE/)
  const wrongHash = structuredClone(input)
  wrongHash.groups[0].name = '合成摘要冲突'
  await rejected(wrongHash, /BACKFILL_REVISION_DRIFT/)
  await assert.rejects(rpc('ledger_detail', [drift.ownerId, groups[0].entryIds[1]]), /NOT_FOUND/)
  await assert.rejects(rpc('ledger_create', [drift.ownerId, entryInput(account.id)]), /ACCOUNT_NOT_FOUND/)
  await assert.rejects(db.query(`insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code)
    values($1,gen_random_uuid(),'expense',-100,'2026-01-02T03:04:05Z',$2,'dining')`, [drift.ownerId, account.id]), /foreign key/)
  await db.query('alter table public.ledger_entries disable trigger ledger_entry_immutable')
  const disabledHash = await fingerprint()
  await assert.rejects(migrate({ ...drift, catalogHash: disabledHash }), /BACKFILL_CATALOG_DRIFT/)
  await db.query('rollback')
  assert.equal(await fingerprint(), disabledHash)
  await db.query('alter table public.ledger_entries enable trigger ledger_entry_immutable')
  console.log('PASS stale version, exact-ID/name drift, duplicates, extra/deleted rows, catalog drift, mixed/name-conflict states and cross-owner rejection')

  // Fault injection is confined to the test copy of the SQL: no production switch.
  const failure = await fixture()
  await rejected(failure, /LEDGER124_PARTIAL_UPDATE/, sql => sql.replace(
    'where e.id=m.id and e.owner_id=owner;',
    `where e.id=m.id and e.owner_id=owner and e.id='${failure.groups[0].entryIds[0]}'; raise exception 'LEDGER124_PARTIAL_UPDATE';`))
  await rejected(failure, /LEDGER124_DURING_UPDATE/, sql => sql.replace('get diagnostics updated_count = row_count;',
    "raise exception 'LEDGER124_DURING_UPDATE';"))
  await rejected(failure, /LEDGER124_BEFORE_RESTORE/, sql => sql.replace('alter table public.ledger_entries enable trigger ledger_entry_immutable;',
    "raise exception 'LEDGER124_BEFORE_RESTORE';"))
  await rejected(failure, /pending trigger events/, sql => sql.replace('set constraints public.ledger_transfer_pair immediate;', '-- deliberately omit drain'))
  await rejected(failure, /LEDGER124_AFTER_RESTORE/, sql => sql.replace('set constraints public.ledger_transfer_pair deferred;',
    "raise exception 'LEDGER124_AFTER_RESTORE';"))
  const unrelated = snapshot => Object.fromEntries(Object.entries(snapshot).map(([table, rows]) =>
    [table, rows?.filter(row => row.owner_id !== failure.ownerId)]))
  const unrelatedBefore = unrelated(await state())
  await migrate(failure)
  assert.deepEqual(unrelated(await state()), unrelatedBefore)
  console.log('PASS failures after update, before/after protection restore all roll back; omitted event drain fails; exact script succeeds')

  const waitingFixture = await fixture()
  const writer = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await writer.connect()
  try {
    // Keep the migration transaction open after its original owner/table locks.
    const sql = (await renderLedgerBackfill(waitingFixture)).replace(/commit;\s*$/, '')
    await db.query(sql)
    let finished = false
    const writing = writer.query('select public.ledger_account_create($1,$2) as receipt', [waitingFixture.ownerId,
      { requestId: crypto.randomUUID(), name: '合成并发开户', balanceCents: 9 }]).then(result => { finished = true; return result })
    const deadline = Date.now() + 3000
    let waiting = false
    while (Date.now() < deadline) {
      const locks = await db.query('select wait_event_type from pg_stat_activity where pid=$1', [writer.processID])
      if (locks.rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(waiting, 'real RPC must wait on held maintenance lock')
    assert.equal(finished, false)
    await db.query('commit')
    assert.equal((await writing).rows[0].receipt.version, 16)
    await unchanged(() => migrate(waitingFixture))
  } finally {
    await db.query('rollback')
    await writer.end()
  }
  // Reverse direction: maintenance itself must wait for an existing owner lock.
  const heldFixture = await fixture()
  const holder = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await holder.connect()
  try {
    await holder.query('begin')
    await holder.query('select from public.ledger_owner_revision where owner_id=$1 for update', [heldFixture.ownerId])
    const migrating = migrate(heldFixture)
    const deadline = Date.now() + 3000
    let waiting = false
    while (Date.now() < deadline) {
      const locks = await holder.query('select wait_event_type from pg_stat_activity where pid=$1', [db.processID])
      if (locks.rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(waiting)
    await holder.query('commit')
    await migrating
  } finally { await holder.query('rollback'); await holder.end() }
  const escapedFixture = await fixture(["合成'\\银行卡$&", '合成$$钱包', '合成现金'])
  await migrate(escapedFixture)
  await unchanged(() => migrate(escapedFixture))
  assert.equal(await fingerprint(), catalogHash)
  await writeFile('/tmp/ledger124-reviewed-catalog-hash.txt', catalogHash + '\n', { mode: 0o600 })
  console.log('PASS SQL literal escaping, maintenance waits for existing owner lock')
  console.log('PASS concurrent real RPC waits for maintenance then writes normally; all ACL/RLS/functions/indexes/constraints/triggers unchanged')

} finally {
  await db?.end()
  if (started) run('pg_ctl', ['-D', work, '-m', 'fast', '-w', 'stop'])
  await rm(work, { recursive: true, force: true })
}
