import { spawn } from 'node:child_process'
import pg from 'pg'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
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
  const port = await freePort()
  await run(binary('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { quiet: true, interruptible: false })
  await run(binary('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', '-t', '15', 'start'], { quiet: true, interruptible: false })
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false, connectionTimeoutMillis: 5000 })
  await client.connect()
  const sql = input => { cancellation.signal.throwIfAborted(); return client.query(input) }
  await sql('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;')
  for (const path of ['db/adventure/create-planning.sql', 'tests/database/adventure-planning.sql', 'tests/database/adventure-actions.sql', 'tests/database/adventure-goals.sql', 'tests/database/adventure-migrations.sql', 'tests/database/adventure-lifecycle.sql', 'tests/database/adventure-reschedule.sql', 'tests/database/adventure-growth.sql']) await sql(await readFile(join(root, path), 'utf8'))
  await sql(`create function pg_temp.fail_reschedule_http() returns trigger language plpgsql as $$
    begin
      if new.kind='task_rescheduled' and new.snapshot->>'title'='reschedule-http-failpoint' then raise exception 'RESCHEDULE_HTTP_FAILPOINT'; end if;
      return new;
    end $$;
    create trigger reschedule_http_failpoint before insert on public.adventure_events
      for each row execute function pg_temp.fail_reschedule_http();`)
  console.log('通过：空库初始化、规划／任务事务、回滚、历史锁定和权限探针')
  const rpcPort = await freePort()
  cancellation.signal.throwIfAborted()
  rest = spawn(process.env.POSTGREST_BIN || 'postgrest', [], { cwd: work, detached: true, env: { ...cleanEnv,
    PGRST_DB_URI: `postgres://postgres@127.0.0.1:${port}/postgres`, PGRST_DB_ANON_ROLE: 'service_role', PGRST_DB_SCHEMAS: 'public',
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(rpcPort), PGRST_LOG_LEVEL: 'crit',
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
  const env = { ...cleanEnv, ADVENTURE_LOCAL_RPC_URL: url, PLAYWRIGHT_BROWSERS_PATH: '.cache/playwright' }
  await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/api/adventure-actions-database.test.ts', 'tests/api/adventure-lifecycle-database.test.ts', 'tests/api/adventure-reschedule-database.test.ts', 'tests/api/adventure-growth-database.test.ts', 'tests/api/adventure-integration-database.test.ts'], { env })
  if (process.argv.includes('--browser')) await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/adventure-actions-database.spec.ts', 'tests/browser/adventure-growth-database.spec.ts', 'tests/browser/adventure-integration-database.spec.ts'], { env })
  await sql('drop trigger reschedule_http_failpoint on public.adventure_events')
  await sql(await readFile(join(root, 'tests/database/adventure-actions-audit.sql'), 'utf8'))
  console.log('通过：HTTP／浏览器操作后的任务、冻结奖励、取消关联、账户经验、请求数与版本全量核对')
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
