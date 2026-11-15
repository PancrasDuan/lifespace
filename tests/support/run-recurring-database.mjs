import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import pg from 'pg'
import { buildRecurringInstall } from '../../scripts/build-adventure-recurring-install.mjs'

const root = resolve(import.meta.dirname, '../..')
const tools = resolve(root, '.cache/recurring-tools')
const bin = name => join(process.env.POSTGRES_BIN || join(tools, 'bin'), name)
const work = await mkdtemp(join(tmpdir(), 'lifespace-199-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && !/SUPABASE|ADVENTURE_/.test(k)))
const freePort = async () => {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
const run = (name, args, options = {}) => {
  const r = spawnSync(name, args, { cwd: root, env, encoding: 'utf8', ...options })
  if (r.error || r.status !== 0) throw new Error(`${name} failed (${r.status}): ${r.error?.message || r.stderr}`)
  return r.stdout
}
const port = await freePort()
const config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false }
const clients = []
let rest, started = false
const connect = async database => {
  const c = new pg.Client({ ...config, database }); await c.connect(); clients.push(c); return c
}
try {
  run(bin('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run(bin('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start'])
  started = true
  const admin = await connect('postgres')
  console.log(`PostgreSQL ${(await admin.query('show server_version')).rows[0].server_version}; isolated loopback cluster`)
  await admin.query('create role anon;create role authenticated;create role service_role bypassrls;')
  await admin.query('create database recurring_fresh')
  await admin.query('create database recurring_upgrade')
  const fresh = await connect('recurring_fresh'), upgrade = await connect('recurring_upgrade')
  const migration = await readFile(join(root, 'db/adventure/migrations/20261115082114_recurring_tasks.sql'), 'utf8')
  for (const c of [upgrade]) {
    await c.query('grant usage on schema public to service_role')
    for (const path of ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql']) await c.query(await readFile(join(root, path), 'utf8'))
  }
  const owner = crypto.randomUUID()
  const command = async (c, owner, id, version, value) => (await c.query('select public.adventure_planning_command($1,$2,$3,$4) r', [owner,id,version,value])).rows[0].r
  const today = (await upgrade.query("select to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD') d")).rows[0].d
  const oldEnvelope = { type: 'createTask', title: '保留一次性事实', description: '升级前', destination: '', plannedOn: today }
  const oldCreate = await command(upgrade,owner,'old-create-task',0,oldEnvelope)
  const oldComplete = await command(upgrade,owner,'old-complete-task',1,{type:'completeTask',id:oldCreate.result.entityId})
  // Preserve a frozen historical reward larger than today's fixed +1 rule.
  await upgrade.query(`update public.adventure_events set amount=7,calculation=jsonb_set(calculation,'{coefficient}','7'),
    snapshot=jsonb_set(snapshot,'{result}',jsonb_set(jsonb_set(jsonb_set(jsonb_set(snapshot->'result','{reward,amount}','7'),'{reward,calculation,coefficient}','7'),'{growthChange,xpDelta}','7'),'{growthChange,after}',public.adventure_growth($1,6,0))) where id=$2`,[owner,oldComplete.result.completionId])
  await upgrade.query('update public.adventure_accounts set total_xp=7 where owner_id=$1',[owner])
  const historicalReceipt=(await upgrade.query('select public.adventure_receipt_lookup($1,$2,$3) r',[owner,'old-complete-task',{type:'completeTask',id:oldCreate.result.entityId}])).rows[0].r
  const oldFixture={owner,envelope:{requestId:'old-complete-task',expectedVersion:1,command:{type:'completeTask',id:oldCreate.result.entityId}},receipt:historicalReceipt}
  // Produce a genuine retired-command receipt using the repository's legacy
  // fixture, migrate it to the current four-table model, and import only rows.
  await admin.query('create database recurring_legacy_receipt')
  const legacy=await connect('recurring_legacy_receipt')
  await legacy.query('grant usage on schema public to service_role')
  for(const path of ['tests/database/legacy-goal-migration/create-planning.sql','tests/database/legacy-goal-migration/list-tasks.sql']) await legacy.query(await readFile(join(root,path),'utf8'))
  const retiredOwner=crypto.randomUUID()
  const main=(await command(legacy,retiredOwner,'retired-main-create',0,{type:'createMainline',name:'历史方向'})).result.entityId
  const goal=(await command(legacy,retiredOwner,'retired-goal-create',1,{type:'createGoal',destination:main,title:'保留旧目标',standards:['标准']})).result.entityId
  const retiredCommand={type:'focusGoal',id:goal,focused:true}
  await command(legacy,retiredOwner,'retired-focus-command',2,retiredCommand)
  await legacy.query(await readFile(join(root,'db/adventure/migrations/20261111000000_goal_categories.sql'),'utf8'))
  const retiredReceipt=(await legacy.query('select public.adventure_receipt_lookup($1,$2,$3) r',[retiredOwner,'retired-focus-command',retiredCommand])).rows[0].r
  for(const table of ['adventure_accounts','adventure_goals','adventure_tasks','adventure_events']) {
    for(const row of (await legacy.query(`select to_jsonb(t) j from public.${table} t where owner_id=$1`,[retiredOwner])).rows)
      await upgrade.query(`insert into public.${table} select (jsonb_populate_record(null::public.${table},$1::jsonb)).*`,[row.j])
  }
  oldFixture.retired={owner:retiredOwner,envelope:{requestId:'retired-focus-command',expectedVersion:2,command:retiredCommand},receipt:retiredReceipt}
  const data = async c => (await c.query(`select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(t) order by owner_id) from public.adventure_accounts t),'goals',(select jsonb_agg(to_jsonb(t) order by id) from public.adventure_goals t),'tasks',(select jsonb_agg(to_jsonb(t)-'recurring_parent_id' order by id) from public.adventure_tasks t),'events',(select jsonb_agg(to_jsonb(t)-'recurring_parent_id' order by id) from public.adventure_events t)) r`)).rows[0].r
  const before = await data(upgrade)
  const failing = migration.replace("notify pgrst,'reload schema';", () => "do $$ begin raise exception 'TEST_UPGRADE_FAILURE'; end $$;")
  await assert.rejects(upgrade.query(failing), /TEST_UPGRADE_FAILURE/)
  await upgrade.query('rollback')
  assert.equal((await upgrade.query("select to_regclass('public.adventure_recurring_tasks') r")).rows[0].r,null)
  assert.deepEqual(await data(upgrade),before)
  await fresh.query('grant usage on schema public to service_role')
  const install=await buildRecurringInstall()
  await assert.rejects(fresh.query(install.replace(/\ncommit;\n$/, () => "\ndo $$ begin raise exception 'TEST_INSTALL_FAILURE'; end $$;\ncommit;\n")),/TEST_INSTALL_FAILURE/)
  await fresh.query('rollback')
  assert.equal((await fresh.query("select to_regclass('public.adventure_accounts') r")).rows[0].r,null)
  await fresh.query(install)
  assert.equal((await fresh.query("select count(*)::integer r from pg_proc where pronamespace='public'::regnamespace and proname like 'adventure_test_%'")).rows[0].r,0)
  await upgrade.query(migration)
  assert.deepEqual(await data(upgrade),before)
  await assert.rejects(upgrade.query(migration),/RECURRING_ALREADY_INSTALLED/);await upgrade.query('rollback')
  assert.deepEqual(await data(upgrade),before)
  const schema = async c => (await c.query(`select jsonb_build_object(
    'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname,p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace and proname like 'adventure_%'),
    'constraints',(select jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) order by c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public'),
    'permissions',(select jsonb_agg(jsonb_build_array(relname,relrowsecurity,relacl::text) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r')) r`)).rows[0].r
  assert.deepEqual(await schema(fresh),await schema(upgrade))
  assert.deepEqual((await upgrade.query('select public.adventure_receipt_lookup($1,$2,$3) r',[owner,'old-create-task',oldEnvelope])).rows[0].r,oldCreate)
  console.log('PASS: empty install/nonempty upgrade equivalence, full old-row/receipt reconciliation, injected failure rollback, repeat rejected without effects')
  await (await import('../database/adventure-first-account-read.mjs')).verifyFirstAccountReads({client:upgrade,connect:()=>connect('recurring_upgrade'),command,today,assert})
  await (await import('../database/adventure-recurring.mjs')).verifyRecurring({client:upgrade,connect:()=>connect('recurring_upgrade'),command,today,assert,root})
  await upgrade.query(await readFile(join(root,'tests/database/adventure-goal-model-history-seed.sql'),'utf8'))
  await upgrade.query(`create function pg_temp.fail_reschedule_http() returns trigger language plpgsql as $$ begin
    if new.kind='task_rescheduled' and new.snapshot->>'title'='reschedule-http-failpoint' then raise exception 'RESCHEDULE_HTTP_FAILPOINT';end if;return new;end $$;
    create trigger reschedule_http_failpoint before insert on public.adventure_events for each row execute function pg_temp.fail_reschedule_http()`)
  await upgrade.query(await readFile(join(root,'tests/database/fixtures/adventure-receipt-validation.sql'),'utf8'))
  const rpcPort = await freePort()
  rest = spawn(process.env.POSTGREST_BIN || join(tools,'postgrest'), [], { cwd: work, env: { ...env,
    PGRST_DB_URI:`postgres://postgres@127.0.0.1:${port}/recurring_upgrade`,PGRST_DB_ANON_ROLE:'service_role',PGRST_DB_SCHEMAS:'public',
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(rpcPort),PGRST_LOG_LEVEL:'crit',
  },stdio:['ignore','ignore','pipe']})
  let restError='';rest.stderr.on('data',x=>{restError=(restError+x).slice(-1500)})
  const url=`http://127.0.0.1:${rpcPort}`
  let ready=false
  for(let i=0;i<50;i++) {
    try {if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok){ready=true;break}}catch{}
    if(rest.exitCode!==null)break
    await new Promise(r=>setTimeout(r,100))
  }
  if(!ready)throw new Error(`PostgREST not ready: ${restError}`)
  const report=join(root,'.cache/recurring-http-report.json')
  const suites = [
    'adventure-recurring', 'adventure-category', 'adventure-task-edit', 'adventure-task-delete', 'adventure-actions',
    'adventure-overdue', 'adventure-date-list', 'adventure-future-completion', 'adventure-lifecycle',
    'adventure-reschedule', 'adventure-growth', 'adventure-integration', 'adventure-goal-relations',
  ].map(name => `tests/api/${name}-database.test.ts`)
  let httpFailure
  try { run(process.execPath,['node_modules/vitest/vitest.mjs','run',...suites,'--maxWorkers=2','--reporter=json',`--outputFile=${report}`],{
    env:{...env,ADVENTURE_LOCAL_RPC_URL:url,ADVENTURE_RECURRING_OLD_RECEIPT:JSON.stringify(oldFixture)},stdio:'inherit',
  }) } catch(error) { httpFailure=error }
  const result=JSON.parse(await readFile(report,'utf8'))
  for (const file of result.testResults) for (const test of file.assertionResults) if(test.status==='failed') console.error(test.fullName, test.failureMessages.join('\n'))
  if(httpFailure) throw httpFailure
  assert.ok(result.numPassedTests>0)
  assert.equal(result.numFailedTests,0)
  assert.equal(result.numPendingTests,0)
  console.log(`PASS: real RPC + Worker HTTP ${result.numPassedTests} tests, 0 skipped`)
} finally {
  if(rest && rest.exitCode===null){rest.kill('SIGTERM');await once(rest,'exit')}
  for(const c of clients)await c.end().catch(()=>{})
  if(started) run(bin('pg_ctl'),['-D',work,'-m','immediate','-w','stop'])
  await rm(work,{recursive:true,force:true})
}
