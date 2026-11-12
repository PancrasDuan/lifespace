import { spawn } from 'node:child_process'
import pg from 'pg'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedLedgerScale, verifyLedgerReadLocks } from './ledger-scale.mjs'
import { seedLedgerRefundScale } from './ledger-refund-scale.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ledgerOnly = process.argv.includes('--ledger')
const goalsOnly = process.argv.includes('--goals-only')
const goalModel = process.argv.includes('--goal-model')
const legacyModel = process.argv.includes('--legacy-model')
const legacyRegression = process.argv.includes('--legacy-regression')
const fullAdventure = !ledgerOnly && !goalsOnly && !goalModel && !legacyModel && !legacyRegression
if (process.argv.includes('--browser-only') && !process.argv.includes('--browser')) {
  console.error('--browser-only 必须与 --browser 同时使用')
  process.exit(2)
}
const nonExecutingOptions = new Set(['--list', '--help', '-h', '--version', '-V', '--passWithNoTests', '--pass-with-no-tests'])
if (process.argv.slice(2).some(arg => nonExecutingOptions.has(arg.split('=')[0]))) {
  console.error('不能使用仅列出、帮助或允许空测试的选项作为数据库验收')
  process.exit(2)
}
if (process.argv.slice(2).some(arg => /^--(?:reporter|add-reporter|outputFile)(?:[.=]|$)/.test(arg))) {
  console.error('数据库验收使用固定报告器，不能覆盖测试报告选项')
  process.exit(2)
}
const legacySchema = ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql']
const legacyChecks = ['tests/database/adventure-history-seed.sql', 'tests/database/adventure-planning.sql',
  'tests/database/adventure-actions.sql', 'tests/database/adventure-goals.sql', 'tests/database/adventure-migrations.sql',
  'tests/database/adventure-lifecycle.sql', 'tests/database/adventure-reschedule.sql', 'tests/database/adventure-growth.sql']
const work = await mkdtemp(join(tmpdir(), 'lifespace-actions-db-'))
const binary = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'ADVENTURE_MIGRATED_FIXTURE' && key !== 'ADVENTURE_LOCAL_RPC_URL'))
const freePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法取得隔离端口')
  await new Promise(resolve => server.close(resolve))
  return address.port
}
const cancellation = new AbortController()
const testChildren = new Set()
let interrupted
const interrupt = signal => {
  interrupted ??= signal
  cancellation.abort(new Error('隔离验收已中断'))
  for (const child of testChildren) child.kill(signal)
}
const onInt = () => interrupt('SIGINT')
const onTerm = () => interrupt('SIGTERM')
process.on('SIGINT', onInt)
process.on('SIGTERM', onTerm)

const run = async (command, args, { input, env = cleanEnv, quiet = false, interruptible = true, cleanup = false } = {}) => {
  if (!cleanup) cancellation.signal.throwIfAborted()
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['pipe', quiet ? 'ignore' : 'inherit', 'inherit'] })
  if (interruptible) testChildren.add(child)
  const exited = once(child, 'exit')
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  let code
  try { [code] = await exited } finally { testChildren.delete(child) }
  if (!cleanup) cancellation.signal.throwIfAborted()
  if (code !== 0) throw new Error(`${command} 退出码 ${code}`)
}
const runReported = async (label, args, env, path, counts) => {
  let failure
  try { await run(process.execPath, args, { env }) } catch (error) { failure = error }
  let report
  try { report = JSON.parse(await readFile(path, 'utf8')) } catch {
    if (failure) throw failure
    throw new Error(`${label}测试未生成有效的结构化报告`)
  }
  const { passed, skipped, notRun, total } = counts(report)
  if (![passed, skipped, notRun, total].every(n => Number.isSafeInteger(n) && n >= 0) || passed + skipped + notRun > total) throw new Error(`${label}测试报告的数量无效`)
  console.log(`${label}：执行 ${total - skipped - notRun}，通过 ${passed}，跳过 ${skipped}，未运行 ${notRun}，其他 ${total - skipped - notRun - passed}`)
  if (failure) throw failure
  if (passed === 0) throw new Error(`${label}未执行任何通过的业务测试`)
  return { passed, skipped, notRun, total }
}
const apiCounts = report => {
  if (!Array.isArray(report.testResults)) throw new Error('HTTP 测试报告缺少测试列表')
  const tests = report.testResults.flatMap(file => file.assertionResults || [])
  if (tests.length !== report.numTotalTests || tests.some(test => !['passed', 'failed', 'skipped', 'pending', 'todo'].includes(test.status))) throw new Error('HTTP 测试报告的测试状态无效')
  return {
    total: tests.length,
    passed: tests.filter(test => test.status === 'passed').length,
    skipped: tests.filter(test => test.status === 'skipped').length,
    notRun: tests.filter(test => test.status === 'pending' || test.status === 'todo').length,
  }
}
const browserCounts = report => {
  const tests = []
  const visit = suite => {
    for (const spec of suite.specs || []) tests.push(...spec.tests)
    for (const child of suite.suites || []) visit(child)
  }
  if (!Array.isArray(report.suites)) throw new Error('浏览器测试报告缺少测试列表')
  report.suites.forEach(visit)
  return {
    total: tests.length,
    skipped: tests.filter(test => test.status === 'skipped').length,
    passed: tests.filter(test => test.status !== 'skipped' && test.results?.at(-1)?.status === 'passed').length,
    notRun: tests.filter(test => test.status !== 'skipped' && !test.results?.length).length,
  }
}
let rest, client, result = 1, goalReplayFixture
try {
  if (fullAdventure) {
    // Preserve the old SQL contract and its original upgrade checks in their
    // own legacy database, then exercise the new schema, migrated receipts,
    // goal Worker and exhaustive migration/security probes independently.
    for (const mode of ['--legacy-regression', '--goal-model', '--legacy-model', '--goals-only']) {
      await run(process.execPath, [fileURLToPath(import.meta.url), mode, ...(mode === '--goal-model' ? process.argv.slice(2) : [])])
    }
    await run(process.execPath, ['--test', 'tests/database/goal-migration-reconcile.test.mjs'])
    await run(process.execPath, ['tests/support/run-goal-migration-baseline.mjs', '--migration', 'db/adventure/migrations/20261111000000_goal_categories.sql'])
    if (process.argv.length === 2) {
      console.log('通过：旧库保护、四表 HTTP、历史回执、目标契约与完整迁移安全验收')
    } else {
      console.log(`通过：旧库保护、历史回执、目标契约与迁移安全验收；四表运行范围见上方（参数：${process.argv.slice(2).join(' ')}）`)
    }
    result = 0
  } else {
  await mkdir(join(root, '.cache'), { recursive: true })
  const port = await freePort()
  await run(binary('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { quiet: true, interruptible: false })
  await run(binary('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', '-t', '15', 'start'], { quiet: true, interruptible: false })
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false, connectionTimeoutMillis: 5000 })
  await client.connect()
  const sql = input => { cancellation.signal.throwIfAborted(); return client.query(input) }
  if (ledgerOnly) {
    const version = (await sql('show server_version')).rows[0].server_version
    if (!/^17\./.test(version)) throw new Error('账单结构验收需要 PostgreSQL 17')
    console.log(`隔离账单 PostgreSQL ${version}，随机 127.0.0.1:${port}`)
  }
  await sql('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;')
  if (ledgerOnly) await sql('create schema auth; create table auth.users (id uuid primary key);')
  const setup = ledgerOnly ? ['db/ledger/create-ledger.sql', 'db/ledger/list-ledger.sql', 'db/ledger/refunds.sql', 'db/ledger/delete.sql', 'db/ledger/accounts.sql', 'db/ledger/account-entries.sql', 'db/ledger/transfers.sql', 'db/ledger/migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql', 'db/ledger/migrations/20261106000000_ledger_account_filter.sql', 'db/agent/migrations/20261106031343_agent_access_bindings.sql', 'tests/database/ledger.sql', 'tests/database/ledger-accounts.sql', 'tests/database/ledger-transfers.sql', 'tests/database/agent-bindings.sql']
    : goalsOnly ? legacySchema
    : legacyModel ? [...legacySchema, 'tests/database/goal-migration-fixture.sql']
    : legacyRegression ? [...legacySchema, ...legacyChecks]
    : ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql', 'tests/database/adventure-goal-model-transaction.sql', 'tests/database/adventure-goal-model-history-seed.sql']
  for (const path of setup) await sql(await readFile(join(root, path), 'utf8'))
  if (legacyRegression) console.log(`通过：旧五表 SQL 回归（${legacyChecks.length} 个脚本）`)
  let migratedFixture
  if (goalsOnly) {
    const owner = '00000000-0000-4000-8000-000000000171'
    const create = { type: 'createGoal', destination: '', title: '旧目标', standards: ['旧标准'] }
    const created = (await sql({ text: 'select public.adventure_planning_command($1,$2,$3,$4) result', values: [owner, 'legacy-create-171', 0, create] })).rows[0].result
    const edit = { type: 'editGoal', id: created.result.entityId, destination: '', title: '旧目标更新', standards: ['旧标准'] }
    const edited = (await sql({ text: 'select public.adventure_planning_command($1,$2,$3,$4) result', values: [owner, 'legacy-edit-171', 1, edit] })).rows[0].result
    const orderOwner = '00000000-0000-4000-8000-000000000172'
    const legacyWrite = async (id, revision, command) => (await sql({ text: 'select public.adventure_planning_command($1,$2,$3,$4) result', values: [orderOwner, id, revision, command] })).rows[0].result.result.entityId
    const mainA = await legacyWrite('order-main-a', 0, { type: 'createMainline', name: '同类' })
    const mainB = await legacyWrite('order-main-b', 1, { type: 'createMainline', name: '另一类' })
    const goalA = await legacyWrite('order-goal-a', 2, { type: 'createGoal', destination: mainA, title: '旧组甲', standards: ['标准'] })
    const goalB = await legacyWrite('order-goal-b', 3, { type: 'createGoal', destination: mainB, title: '旧组乙', standards: ['标准'] })
    await legacyWrite('order-focus-a', 4, { type: 'focusGoal', id: goalA, focused: true })
    const oldOrder = { type: 'reorderGoals', mainlineId: mainA, id: goalA, direction: 'down' }
    const orderReceipt = (await sql({ text: 'select public.adventure_planning_command($1,$2,$3,$4) result', values: [orderOwner, 'order-replay-a', 5, oldOrder] })).rows[0].result
    await sql(await readFile(join(root, 'db/adventure/migrations/20261111000000_goal_categories.sql'), 'utf8'))
    goalReplayFixture = JSON.stringify({ owner, create, edit, created, edited, orderOwner, goalA, goalB, oldOrder, orderReceipt })
    console.log('通过：隔离旧库创建目标与编辑回执并迁移到四表')
  }
  if (legacyModel) {
    // Additional genuine legacy non-mainline receipts, plus two unsafe message
    // variants, exist only in this disposable migration fixture.
    await sql(`do $$
    declare o uuid:='00000000-0000-4000-8000-000000000005'; u uuid:='00000000-0000-4000-8000-000000000006';
      m uuid; g uuid; r jsonb; c jsonb; today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
    begin
      r:=public.adventure_planning_command(o,'replay-mainline',0,'{"type":"createMainline","name":"旧方向"}'); m:=(r->'result'->>'entityId')::uuid;
      r:=public.adventure_planning_command(o,'replay-goal',1,jsonb_build_object('type','createGoal','destination',m,'title','历史目标','standards',jsonb_build_array('标准'))); g:=(r->'result'->>'entityId')::uuid;
      c:=jsonb_build_object('type','focusGoal','id',g,'focused',true);
      r:=public.adventure_planning_command(o,'replay-focus',2,c); insert into goal_fixture_receipts values(o,'replay-focus',c,r);
      c:=jsonb_build_object('type','migrateGoal','id',g,'destination','');
      r:=public.adventure_planning_command(o,'replay-goal-migrate',3,c); insert into goal_fixture_receipts values(o,'replay-goal-migrate',c,r);
      for i in 0..1 loop
        c:=jsonb_build_object('type','createTask','title','旧回执任务 '||i,'description','','plannedOn',today,'destination','');
        r:=public.adventure_planning_command(u,case i when 0 then 'unsafe-cn-receipt' else 'unsafe-en-receipt' end,i,c);
        insert into goal_fixture_receipts values(u,case i when 0 then 'unsafe-cn-receipt' else 'unsafe-en-receipt' end,c,r);
      end loop;
    end $$;
    update public.adventure_events set snapshot=jsonb_set(snapshot,'{result}',snapshot->'result' || jsonb_build_object('unknownSource',jsonb_build_object('alias','retired'))) where request_id in ('unsafe-cn-receipt','unsafe-en-receipt');
    update goal_fixture_receipts set receipt=jsonb_set(receipt,'{result,message}',to_jsonb(case request_id when 'unsafe-cn-receipt' then '旧主线已保存' else 'Old MainLine saved' end)) where request_id in ('unsafe-cn-receipt','unsafe-en-receipt');`)
    // Put old structured attribution inside a genuine success receipt; retain
    // the original envelope so HTTP replay can be checked after migration.
    await sql(`update public.adventure_events set snapshot=jsonb_set(snapshot,'{result}',snapshot->'result' || '{"mainlineName":"旧方向","source":{"mainlineId":"10000000-0000-4000-8000-000000000001","goalTitle":"保留的旧名称"}}'::jsonb) where request_id='rpc-complete-task';
      update goal_fixture_receipts set receipt=jsonb_set(receipt,'{result}',receipt->'result' || '{"mainlineName":"旧方向","source":{"mainlineId":"10000000-0000-4000-8000-000000000001","goalTitle":"保留的旧名称"}}'::jsonb) where request_id='rpc-complete-task';`)
    const receipts = (await sql('select * from goal_fixture_receipts')).rows
    const locks = (await sql('select * from goal_fixture_historical_lock')).rows
    await sql(await readFile(join(root, 'db/adventure/migrations/20261111000000_goal_categories.sql'), 'utf8'))
    const cleaned = (await sql("select snapshot->'result' result from public.adventure_events where request_id='rpc-complete-task'")).rows[0]?.result
    if (!cleaned || 'mainlineName' in cleaned || 'mainlineId' in cleaned.source || cleaned.source.goalTitle !== '保留的旧名称') throw new Error('旧回执结构化归属清理失败')
    migratedFixture = JSON.stringify({ receipts, locks })
  }
  if (!ledgerOnly && !goalModel && !legacyModel && !goalsOnly) {
    await sql(await readFile(join(root, 'tests/database/adventure-today-upgrade-before.sql'), 'utf8'))
    const migration = await readFile(join(root, 'db/adventure/migrations/20261106200055_adventure_today_task_rules.sql'), 'utf8')
    await sql(migration)
    await sql(migration)
    await sql(await readFile(join(root, 'tests/database/adventure-today-upgrade-after.sql'), 'utf8'))
    if (legacyRegression) await sql(await readFile(join(root, 'tests/database/adventure-actions-audit.sql'), 'utf8'))
    console.log('通过：非空五表函数升级可重复执行，旧结束任务、完成奖励与成功回执均保留')
  }
  if (ledgerOnly) await sql(`insert into auth.users (id) values ('00000000-0000-4000-8000-000000000007');
    insert into public.agent_identity_bindings (client_id, owner_id, enabled)
      values ('synthetic-http-active.access', '00000000-0000-4000-8000-000000000007', true);`)
  if (!ledgerOnly && !legacyModel && !goalsOnly && !legacyRegression) await sql(`create function pg_temp.fail_reschedule_http() returns trigger language plpgsql as $$
    begin
      if new.kind='task_rescheduled' and new.snapshot->>'title'='reschedule-http-failpoint' then raise exception 'RESCHEDULE_HTTP_FAILPOINT'; end if;
      return new;
    end $$;
    create trigger reschedule_http_failpoint before insert on public.adventure_events
      for each row execute function pg_temp.fail_reschedule_http();`)
  if (goalModel) await sql(`create function pg_temp.unsafe_receipt_fixture() returns trigger language plpgsql as $$
    begin
      if new.kind='task_created' and new.snapshot->>'title'='unsafe-receipt-fixture' and new.snapshot ? 'result' then
        new.snapshot := new.snapshot - 'result';
      elsif new.kind='task_created' and new.snapshot->>'title' in ('unsafe-cn-fixture','unsafe-en-fixture') and new.snapshot ? 'result' then
        new.snapshot := jsonb_set(new.snapshot,'{result}',new.snapshot->'result' || '{"unknownSource":{"alias":"retired"}}'::jsonb);
      end if;
      return new;
    end $$;
    create trigger unsafe_receipt_fixture before update on public.adventure_events
      for each row execute function pg_temp.unsafe_receipt_fixture();`)
  if (ledgerOnly) await sql(`create function pg_temp.ledger_failpoint() returns trigger language plpgsql as $$
    begin
      if exists(select from public.ledger_entries where owner_id=new.owner_id and note='ledger91-rollback') then raise exception 'LEDGER_TEST_ROLLBACK_AFTER_INSERT'; end if;
      if exists(select from public.ledger_entries where owner_id=new.owner_id and note='ledger94-delete-rollback' and deleted_at is not null) then raise exception 'LEDGER_TEST_ROLLBACK_AFTER_DELETE'; end if;
      if exists(select from public.ledger_accounts where owner_id=new.owner_id and name='ledger119-rollback') then raise exception 'LEDGER_TEST_ROLLBACK_AFTER_ACCOUNT'; end if;
      return new;
    end $$;
    create trigger ledger_test_failpoint before update on public.ledger_owner_revision
      for each row execute function pg_temp.ledger_failpoint();
    create function pg_temp.ledger_transfer_failpoint() returns trigger language plpgsql as $$
    begin
      if new.category_code='transfer_in' and new.note='ledger121-second-side-failure' then raise exception 'LEDGER_TEST_SECOND_SIDE'; end if;
      return new;
    end $$;
    create trigger ledger_transfer_test_failpoint before insert on public.ledger_entries
      for each row execute function pg_temp.ledger_transfer_failpoint();`)
  if (!legacyRegression) {
  console.log(ledgerOnly ? '通过：隔离账单基线与账户结构升级（四表）' : goalsOnly ? '通过：目标控制台旧库升级至四表' : legacyModel ? '通过：合成旧库升级至四表' : goalModel ? '通过：四表空库初始化' : '通过：空库初始化、规划／任务事务、回滚、历史锁定和权限探针')
  const rpcPort = await freePort()
  const ledgerJwtSecret = ledgerOnly ? crypto.randomUUID() + crypto.randomUUID() : undefined
  cancellation.signal.throwIfAborted()
  rest = spawn(process.env.POSTGREST_BIN || 'postgrest', [], { cwd: work, detached: true, env: { ...cleanEnv,
    PGRST_DB_URI: `postgres://postgres@127.0.0.1:${port}/postgres`, PGRST_DB_ANON_ROLE: 'service_role', PGRST_DB_SCHEMAS: 'public',
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(rpcPort), PGRST_LOG_LEVEL: 'crit',
    ...(ledgerJwtSecret ? { PGRST_JWT_SECRET: ledgerJwtSecret } : {}),
    ...(process.env.POSTGRES_LIB ? { [process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH']: process.env.POSTGRES_LIB } : {}),
  }, stdio: ['ignore', 'ignore', 'pipe'] })
  let restError = ''
  rest.on('error', error => { restError = error.message })
  rest.stderr.on('data', chunk => { restError = (restError + chunk).slice(-2000) })
  const url = `http://127.0.0.1:${rpcPort}`
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    cancellation.signal.throwIfAborted()
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break } } catch {}
    if (rest.exitCode !== null || rest.signalCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error(`本机 PostgREST 未就绪：${restError}`)
  if (ledgerOnly) await verifyLedgerReadLocks(client, url)
  const scaleOwner = ledgerOnly && process.argv.includes('--ledger-scale') ? await seedLedgerScale(client, process.env.LEDGER_SCALE_INDEX_REPORT || join(root, '.cache/ledger-scale-index.json')) : undefined
  const refundScaleOwner = scaleOwner ? await seedLedgerRefundScale(client, process.env.LEDGER_REFUND_SCALE_INDEX_REPORT || join(root, '.cache/ledger-refund-scale-index.json')) : undefined
  const env = { ...cleanEnv, GOAL_REPLAY_FIXTURE: goalReplayFixture, ADVENTURE_LOCAL_RPC_URL: url, ...(migratedFixture ? { ADVENTURE_MIGRATED_FIXTURE: migratedFixture } : {}), LEDGER_LOCAL_RPC_URL: url, LEDGER_LOCAL_JWT_SECRET: ledgerJwtSecret, ...(scaleOwner ? { LEDGER_SCALE_OWNER: scaleOwner, LEDGER_REFUND_SCALE_OWNER: refundScaleOwner } : {}), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '.cache/playwright' }
  const apiArgs = process.argv.includes('--api') ? process.argv.slice(process.argv.indexOf('--api') + 1, process.argv.includes('--browser') ? process.argv.indexOf('--browser') : undefined) : goalsOnly ? ['tests/api/adventure-goals-database.test.ts'] : legacyModel ? ['tests/api/adventure-migrated-task-database.test.ts'] : goalModel ? [
    'tests/api/adventure-category-database.test.ts', 'tests/api/adventure-task-edit-database.test.ts',
    'tests/api/adventure-task-delete-database.test.ts', 'tests/api/adventure-actions-database.test.ts',
    'tests/api/adventure-overdue-database.test.ts', 'tests/api/adventure-date-list-database.test.ts',
    'tests/api/adventure-lifecycle-database.test.ts', 'tests/api/adventure-reschedule-database.test.ts',
    'tests/api/adventure-growth-database.test.ts', 'tests/api/adventure-integration-database.test.ts',
    'tests/api/adventure-goal-relations-database.test.ts',
  ] : []
  if (!process.argv.includes('--browser-only')) {
    const reportPath = join(work, 'vitest-results.json')
    await runReported('HTTP', ['node_modules/vitest/vitest.mjs', 'run', ...(apiArgs.length ? apiArgs : ledgerOnly ? ['tests/api/ledger-database.test.ts', 'tests/api/ledger-accounts-database.test.ts', 'tests/api/ledger-account-entries-database.test.ts', 'tests/api/ledger-transfers-database.test.ts', 'tests/api/ledger-dates-database.test.ts', 'tests/api/ledger-account-filter-database.test.ts', 'tests/api/ledger-refunds-database.test.ts', 'tests/api/ledger-delete-database.test.ts', 'tests/api/agent-bindings-database.test.ts', 'tests/api/agent-mcp-database.test.ts', ...(scaleOwner ? ['tests/api/ledger-scale-database.test.ts', 'tests/api/ledger-refund-scale-database.test.ts'] : [])] : ['tests/api/adventure-task-edit-database.test.ts', 'tests/api/adventure-task-delete-database.test.ts', 'tests/api/adventure-actions-database.test.ts', 'tests/api/adventure-overdue-database.test.ts', 'tests/api/adventure-date-list-database.test.ts', 'tests/api/adventure-lifecycle-database.test.ts', 'tests/api/adventure-reschedule-database.test.ts', 'tests/api/adventure-growth-database.test.ts', 'tests/api/adventure-integration-database.test.ts']), '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`], env, reportPath,
      apiCounts)
  }
  let browserScope = '未运行'
  if (process.argv.includes('--browser')) {
    const browserArgs = process.argv.slice(process.argv.indexOf('--browser') + 1)
    // Flags such as --output/--grep refine the domain defaults; a leading file
    // selector replaces them. Never run another domain against this database.
    const specs = browserArgs.length && !browserArgs[0].startsWith('-') ? [] : goalsOnly ? ['tests/browser/adventure-goal-console-database.spec.ts'] : ledgerOnly ? ['tests/browser/ledger-database.spec.ts', 'tests/browser/ledger-accounts-database.spec.ts', 'tests/browser/ledger-account-entries-database.spec.ts', 'tests/browser/ledger-transfers-database.spec.ts', 'tests/browser/ledger-dates-database.spec.ts', 'tests/browser/ledger-account-filter-database.spec.ts', 'tests/browser/ledger-refunds-database.spec.ts', 'tests/browser/ledger-delete-database.spec.ts'] : ['tests/browser/adventure-actions-database.spec.ts', 'tests/browser/adventure-overdue-database.spec.ts', 'tests/browser/adventure-date-list-database.spec.ts', 'tests/browser/adventure-growth-database.spec.ts', 'tests/browser/adventure-integration-database.spec.ts', 'tests/browser/adventure-task-edit-database.spec.ts', 'tests/browser/adventure-task-delete-database.spec.ts', 'tests/browser/adventure-review-fixes-database.spec.ts', 'tests/browser/adventure-task-date-interaction-database.spec.ts', ...(goalModel ? ['tests/browser/adventure-goal-relations-database.spec.ts'] : [])]
    const reportPath = join(work, 'playwright-results.json')
    await runReported('浏览器', ['node_modules/@playwright/test/cli.js', 'test', ...specs, ...browserArgs, '--reporter=list,json'], { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, reportPath, browserCounts)
    browserScope = `已运行（参数：${[...specs, ...browserArgs].join(' ')}）`
  }
  if (!ledgerOnly && !legacyModel && !goalsOnly) await sql('drop trigger reschedule_http_failpoint on public.adventure_events')
  if (goalModel) await sql(await readFile(join(root, 'tests/database/adventure-goal-model-audit.sql'), 'utf8'))
  if (!ledgerOnly && !goalModel && !legacyModel && !goalsOnly) await sql(await readFile(join(root, 'tests/database/adventure-actions-audit.sql'), 'utf8'))
  const httpScope = process.argv.includes('--browser-only') ? '未运行' : process.argv.includes('--api') ? `筛选：${apiArgs.join(' ') || '默认列表'}` : '默认列表'
  console.log(`通过：HTTP ${httpScope}；浏览器：${browserScope}；数据库检查已执行，临时环境将清理`)
  }
  result = 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '隔离数据库验收失败')
} finally {
  if (rest && rest.exitCode === null && rest.signalCode === null && rest.pid) {
    const exited = once(rest, 'exit')
    rest.kill('SIGTERM')
    await exited
  }
  if (client) await client.end()
  if (existsSync(join(work, 'postmaster.pid'))) await run(binary('pg_ctl'), ['-D', work, '-m', 'fast', '-w', 'stop'], { quiet: true, interruptible: false, cleanup: true })
  await rm(work, { recursive: true, force: true })
  process.off('SIGINT', onInt)
  process.off('SIGTERM', onTerm)
}
process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : result
