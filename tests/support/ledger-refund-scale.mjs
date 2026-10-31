import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'

// Fresh isolated DB only: 40k expenses + 60k refund facts, including 30k
// logically deleted refunds: 10k fully refunded, 10k partial, 20k completed.
export async function seedLedgerRefundScale(client, reportPath) {
  assert.equal(client.host, '127.0.0.1')
  const owner = crypto.randomUUID(), started = performance.now()
  await client.query('begin')
  await client.query('insert into public.ledger_owner_revision(owner_id,revision) values($1,100000)', [owner])
  await client.query(`insert into public.ledger_entries(id,owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note)
    select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,gen_random_uuid(),'expense',-100,
      timestamptz '2024-01-01T00:00:00+08:00'+n*interval '1 second','退款规模合成','dining','隔离环境合成数据'
    from generate_series(1,40000)n`, [owner])
  for (const [prefix, amount, deleted] of [['3', 30, 'n%3=2'], ['4', 70, 'n%3<>0']]) {
    await client.query(`insert into public.ledger_entries(id,owner_id,request_id,direction,amount_cents,occurred_at,account_name,category_code,note,parent_entry_id,deleted_at)
      select ('${prefix}0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,gen_random_uuid(),'income',${amount},
        timestamptz '2024-02-01T00:00:00+08:00'+n*interval '1 second','退款规模合成','dining','隔离环境合成数据',
        ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when ${deleted} then now() else null end
      from generate_series(1,30000)n`, [owner])
  }
  await client.query('commit')
  const seedMs = performance.now() - started
  await client.query('vacuum analyze public.ledger_entries')
  const queries = [
    { name: '退款加入后深页及派生状态', index: 'ledger_entries_active_time', text: `select public.ledger_entry_json(e) from
      (select * from public.ledger_entries where owner_id=$1 and deleted_at is null order by occurred_at desc,id desc limit 30 offset 69990)e` },
    { name: '有效退款关联及额度', index: 'ledger_entries_active_refunds', text: `select sum(amount_cents),count(*) from public.ledger_entries
      where owner_id=$1 and parent_entry_id='20000000-0000-4000-8000-000000030000' and deleted_at is null` },
    { name: '删除范围全部有效退款标识', index: 'ledger_entries_active_refunds', text: `select id from public.ledger_entries
      where owner_id=$1 and parent_entry_id='20000000-0000-4000-8000-000000030000' and deleted_at is null order by id` },
  ]
  const plans = []
  for (const query of queries) {
    const result = await client.query('explain (analyze,buffers,format json) ' + query.text, [owner])
    const plan = result.rows[0]['QUERY PLAN'][0]
    assert.ok(JSON.stringify(plan).includes(query.index), `${query.name} 未命中预期索引`)
    plans.push({ ...query, plan })
  }
  const version = await client.query('select version() as version')
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows: 100000, activeRows: 70000, expenses: 40000, refundFacts: 60000, deletedRefunds: 30000, seedMs,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, postgres: version.rows[0].version },
    notes: '仅隔离合成数据；与原十万条普通流水 owner 分开；SQL计划为补充索引探针，真实Worker HTTP另记；无产品条数或性能承诺。', plans }, null, 2))
  console.log(`通过：单 owner 十万条含退款合成事实（7万有效），造数 ${seedMs.toFixed(1)}ms；关联、范围和深页索引命中`)
  return owner
}
