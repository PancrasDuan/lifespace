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
import { verifyWorkerPostgres } from './worker-postgres-runtime.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ledgerOnly = process.argv.includes('--ledger')
const ciPort = process.env.CI_POSTGRES_PORT
if (ciPort && (process.env.CI !== 'true' || !/^\d{4,5}$/.test(ciPort))) throw new Error('CI 数据库仅允许显式回环端口')
const work = await mkdtemp(join(tmpdir(), 'lifespace-actions-db-'))
const binary = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
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
let rest, client, result = 1
try {
  await mkdir(join(root, '.cache'), { recursive: true })
  const port = ciPort ? Number(ciPort) : await freePort()
  if (!ciPort) {
    await run(binary('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { quiet: true, interruptible: false })
    await run(binary('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', '-t', '15', 'start'], { quiet: true, interruptible: false })
  }
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false, connectionTimeoutMillis: 5000 })
  await client.connect()
  const sql = input => { cancellation.signal.throwIfAborted(); return client.query(input) }
  if (ciPort && Number((await sql("select count(*) from information_schema.tables where table_schema in ('public','auth')")).rows[0].count)) throw new Error('CI 必须提供空的独立数据库')
  if (ledgerOnly) {
    const version = (await sql('show server_version')).rows[0].server_version
    if (!/^17\./.test(version)) throw new Error('账单结构验收需要 PostgreSQL 17')
    console.log(`隔离账单 PostgreSQL ${version}，随机 127.0.0.1:${port}`)
  }
  await sql('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;')
  await sql('create schema auth; create table auth.users (id uuid primary key);')
  for (const path of ledgerOnly ? ['db/ledger/create-ledger.sql', 'db/ledger/list-ledger.sql', 'db/ledger/refunds.sql', 'db/ledger/delete.sql', 'db/ledger/accounts.sql', 'db/ledger/account-entries.sql', 'db/ledger/transfers.sql', 'db/ledger/migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql', 'db/ledger/migrations/20261106000000_ledger_account_filter.sql', 'db/agent/migrations/20261106031343_agent_access_bindings.sql', 'tests/database/ledger.sql', 'tests/database/ledger-accounts.sql', 'tests/database/ledger-transfers.sql', 'tests/database/agent-bindings.sql'] : ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql', 'tests/database/adventure-history-seed.sql', 'tests/database/adventure-planning.sql', 'tests/database/adventure-actions.sql', 'tests/database/adventure-goals.sql', 'tests/database/adventure-migrations.sql', 'tests/database/adventure-lifecycle.sql', 'tests/database/adventure-reschedule.sql', 'tests/database/adventure-growth.sql']) await sql(await readFile(join(root, path), 'utf8'))
  // Install the other domain's schema as well: the unified role migration is
  // checked against the complete application schema on every isolated run.
  for (const path of ledgerOnly ? ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql'] : ['db/ledger/create-ledger.sql', 'db/ledger/list-ledger.sql', 'db/ledger/refunds.sql', 'db/ledger/delete.sql', 'db/ledger/accounts.sql', 'db/ledger/account-entries.sql', 'db/ledger/transfers.sql', 'db/ledger/migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql', 'db/ledger/migrations/20261106000000_ledger_account_filter.sql', 'db/agent/migrations/20261106031343_agent_access_bindings.sql']) await sql(await readFile(join(root, path), 'utf8'))
  if (!ledgerOnly) {
    await sql(await readFile(join(root, 'tests/database/adventure-today-upgrade-before.sql'), 'utf8'))
    const migration = await readFile(join(root, 'db/adventure/migrations/20261106200055_adventure_today_task_rules.sql'), 'utf8')
    await sql(migration)
    await sql(migration)
    await sql(await readFile(join(root, 'tests/database/adventure-today-upgrade-after.sql'), 'utf8'))
    console.log('通过：非空五表函数升级可重复执行，旧结束任务、完成奖励与成功回执均保留')
  }
  if (ledgerOnly) await sql(`insert into auth.users (id) values ('00000000-0000-4000-8000-000000000007');
    insert into public.agent_identity_bindings (client_id, owner_id, enabled)
      values ('synthetic-http-active.access', '00000000-0000-4000-8000-000000000007', true);`)
  if (!ledgerOnly) await sql(`create function pg_temp.fail_reschedule_http() returns trigger language plpgsql as $$
    begin
      if new.kind='task_rescheduled' and new.snapshot->>'title'='reschedule-http-failpoint' then raise exception 'RESCHEDULE_HTTP_FAILPOINT'; end if;
      return new;
    end $$;
    create trigger reschedule_http_failpoint before insert on public.adventure_events
      for each row execute function pg_temp.fail_reschedule_http();`)
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
  await sql(`create table public.tasks(id bigint primary key,title text not null,area text not null,planned_at bigint not null,due_at bigint,status text not null,is_deleted boolean not null);`)
  const businessSnapshot = async () => {
    const result=[]
    for(const table of ['adventure_accounts','adventure_mainlines','adventure_goals','adventure_tasks','adventure_events','ledger_owner_revision','ledger_accounts','ledger_entries','ledger_balance_adjustments','agent_identity_bindings']) {
      result.push((await sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) digest from public.${table} t`)).rows[0].digest)
    }
    return JSON.stringify(result)
  }
  const beforeRoleMigration=await businessSnapshot()
  const roleMigration=await readFile(join(root, 'db/migrations/20261108000000_worker_database_role.sql'), 'utf8')
  await sql(roleMigration)
  await sql(roleMigration)
  if(beforeRoleMigration!==await businessSnapshot()) throw new Error('权限迁移改变了已有业务行')
  console.log('通过：新角色／RLS 迁移可重复执行，已有业务行逐表摘要未变')
  if (process.argv.includes('--runtime')) await verifyWorkerPostgres(client, root)
  console.log(ledgerOnly ? '通过：隔离账单基线与账户结构升级（四表）' : '通过：空库初始化、规划／任务事务、回滚、历史锁定和权限探针')
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
  const env = { ...cleanEnv, WORKER_TEST_DATABASE_URL: `postgres://lifespace_worker@127.0.0.1:${port}/postgres`, WORKER_TEST_ADMIN_URL: `postgres://postgres@127.0.0.1:${port}/postgres`, ADVENTURE_LOCAL_RPC_URL: url, LEDGER_LOCAL_RPC_URL: url, LEDGER_LOCAL_JWT_SECRET: ledgerJwtSecret, ...(scaleOwner ? { LEDGER_SCALE_OWNER: scaleOwner, LEDGER_REFUND_SCALE_OWNER: refundScaleOwner } : {}), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '.cache/playwright' }
  const apiArgs = process.argv.includes('--api') ? process.argv.slice(process.argv.indexOf('--api') + 1, process.argv.includes('--browser') ? process.argv.indexOf('--browser') : undefined) : []
  if (!process.argv.includes('--browser-only')) await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...(apiArgs.length ? apiArgs : ledgerOnly ? ['tests/api/database-boundaries.test.ts', 'tests/api/database-latency.test.ts', 'tests/api/worker-database.test.ts', 'tests/api/tasks-database.test.ts', 'tests/api/agent-mcp-database.test.ts', 'tests/api/ledger-database.test.ts', 'tests/api/ledger-accounts-database.test.ts', 'tests/api/ledger-account-entries-database.test.ts', 'tests/api/ledger-transfers-database.test.ts', 'tests/api/ledger-dates-database.test.ts', 'tests/api/ledger-account-filter-database.test.ts', 'tests/api/ledger-refunds-database.test.ts', 'tests/api/ledger-delete-database.test.ts', 'tests/api/agent-bindings-database.test.ts', ...(scaleOwner ? ['tests/api/ledger-scale-database.test.ts', 'tests/api/ledger-refund-scale-database.test.ts'] : [])] : ['tests/api/adventure-task-edit-database.test.ts', 'tests/api/adventure-task-delete-database.test.ts', 'tests/api/adventure-actions-database.test.ts', 'tests/api/adventure-overdue-database.test.ts', 'tests/api/adventure-date-list-database.test.ts', 'tests/api/adventure-lifecycle-database.test.ts', 'tests/api/adventure-reschedule-database.test.ts', 'tests/api/adventure-growth-database.test.ts', 'tests/api/adventure-integration-database.test.ts'])], { env })
  if (process.argv.includes('--browser')) {
    const browserArgs = process.argv.slice(process.argv.indexOf('--browser') + 1)
    // Flags such as --output/--grep refine the domain defaults; a leading file
    // selector replaces them. Never run another domain against this database.
    const specs = browserArgs.length && !browserArgs[0].startsWith('-') ? [] : ledgerOnly ? ['tests/browser/ledger-database.spec.ts', 'tests/browser/ledger-accounts-database.spec.ts', 'tests/browser/ledger-account-entries-database.spec.ts', 'tests/browser/ledger-transfers-database.spec.ts', 'tests/browser/ledger-dates-database.spec.ts', 'tests/browser/ledger-account-filter-database.spec.ts', 'tests/browser/ledger-refunds-database.spec.ts', 'tests/browser/ledger-delete-database.spec.ts'] : ['tests/browser/adventure-actions-database.spec.ts', 'tests/browser/adventure-overdue-database.spec.ts', 'tests/browser/adventure-date-list-database.spec.ts', 'tests/browser/adventure-growth-database.spec.ts', 'tests/browser/adventure-integration-database.spec.ts', 'tests/browser/adventure-task-edit-database.spec.ts', 'tests/browser/adventure-task-delete-database.spec.ts', 'tests/browser/adventure-review-fixes-database.spec.ts', 'tests/browser/adventure-task-date-interaction-database.spec.ts']
    await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...specs, ...browserArgs], { env })
  }
  if (!ledgerOnly) await sql('drop trigger reschedule_http_failpoint on public.adventure_events')
  if (!ledgerOnly) await sql(await readFile(join(root, 'tests/database/adventure-actions-audit.sql'), 'utf8'))
  console.log(ledgerOnly ? '通过：真实账单数据库验收，临时环境将清理' : '通过：HTTP／浏览器操作后的任务、冻结奖励、取消关联、账户经验、请求数与版本全量核对')
  result = 0
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
