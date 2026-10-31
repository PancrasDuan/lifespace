import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'
import pg from 'pg'

export async function verifyLedgerReadLocks(client, rpcUrl) {
  const writer = new pg.Client({ host: '127.0.0.1', port: client.port, user: 'postgres', database: 'postgres', ssl: false })
  await writer.connect()
  const owner = crypto.randomUUID()
  const input = () => JSON.stringify({ requestId: crypto.randomUUID(), direction: 'expense', amountCents: -100,
    occurredAt: '2024-02-29T00:00:00Z', accountName: '隔离锁验证', categoryCode: 'dining', note: '' })
  let writing
  try {
    await client.query('select public.ledger_create($1,$2)', [owner, input()])
    await client.query('begin')
    const before = await client.query('select public.ledger_list($1) as page', [owner])
    assert.equal(before.rows[0].page.version, 1)
    await writer.query("set statement_timeout='3s'")
    writing = writer.query('select public.ledger_create($1,$2)', [owner, input()])
    // Observe the lock, instead of assuming a sleep means the write has started.
    let blocked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await client.query('select cardinality(pg_blocking_pids($1)) as count', [writer.processID])
      if (result.rows[0].count > 0) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(blocked, '列表共享锁未阻止同 owner 写入')
    await client.query('select public.ledger_create($1,$2)', [crypto.randomUUID(), input()])
    const held = await client.query('select public.ledger_list($1) as page', [owner])
    assert.deepEqual([held.rows[0].page.total, held.rows[0].page.items.length, held.rows[0].page.version], [1, 1, 1])
    await client.query('commit')
    await writing
    const response = await fetch(new URL('/rpc/ledger_list', rpcUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner }) })
    assert.equal(response.status, 200)
    const current = await response.json()
    assert.deepEqual([current.total, current.items.length, current.version], [2, 2, 2])
    console.log('通过：真实列表共享锁阻止同 owner 写入、允许独立 owner；条目／总数／版本在提交前后保持一致')
  } finally {
    await client.query('rollback')
    await writing?.catch(() => {})
    await writer.end()
  }
}

// Called only by the runner after initdb created a fresh loopback database.
export async function seedLedgerScale(client, reportPath) {
  assert.equal(client.host, '127.0.0.1')
  const owner = crypto.randomUUID()
  const started = performance.now()
  await client.query('begin')
  await client.query('insert into public.ledger_owner_revision(owner_id, revision) values ($1, 100000)', [owner])
  await client.query(`insert into public.ledger_entries(id, owner_id, request_id, direction, amount_cents, occurred_at, account_name, category_code, note)
    select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, $1,
      ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      'expense', -100, timestamptz '2024-01-01T00:00:00+08:00' + ((n-1)/10) * interval '1 hour',
      '合成规模验证', 'dining', '隔离环境合成数据'
    from generate_series(1,100000) n`, [owner])
  await client.query('commit')
  const seedMs = performance.now() - started
  await client.query('vacuum analyze public.ledger_entries')
  const queries = [
    { name: '日期末页', text: `select * from public.ledger_entries where owner_id=$1 and deleted_at is null
      and occurred_at >= '2024-02-29T00:00:00+08:00' and occurred_at < '2024-03-01T00:00:00+08:00'
      order by occurred_at desc,id desc limit 30 offset 210` },
    { name: '全部时间深页3334', text: `select * from public.ledger_entries where owner_id=$1 and deleted_at is null
      order by occurred_at desc,id desc limit 30 offset 99990` },
    { name: '日期总数', text: `select count(*) from public.ledger_entries where owner_id=$1 and deleted_at is null
      and occurred_at >= '2024-02-29T00:00:00+08:00' and occurred_at < '2024-03-01T00:00:00+08:00'` },
  ]
  const plans = []
  for (const query of queries) {
    const result = await client.query('explain (analyze, buffers, format json) ' + query.text, [owner])
    const plan = result.rows[0]['QUERY PLAN'][0]
    assert.ok(JSON.stringify(plan).includes('ledger_entries_active_time'), `${query.name} 未使用活跃日期索引`)
    plans.push({ ...query, plan })
  }
  const version = await client.query('select version() as version')
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows: 100000, seedMs,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, postgres: version.rows[0].version },
    notes: '全新隔离本机数据库；合成流水每小时10条同秒记录；SQL计划为等价日期／深页检索的补充索引探针，实际RPC端到端耗时另记HTTP报告；无性能阈值或产品上限。', plans }, null, 2))
  console.log(`通过：单 owner 100000 条隔离合成流水与日期／深页索引计划；造数 ${seedMs.toFixed(1)}ms`)
  return owner
}
