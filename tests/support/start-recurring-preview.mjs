// Local acceptance preview only: no .dev.vars, hosted project or real identity.
// Browser -> loopback Vite middleware -> production Hono app.request -> local
// PostgREST -> a newly created PostgreSQL cluster. Not a workerd/Auth rehearsal.
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer as netServer } from 'node:net'
import { createServer as httpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import pg from 'pg'
import { buildRecurringInstall } from '../../scripts/build-adventure-recurring-install.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '../..')
// A signal only cancels startup. The same control flow owns cleanup, after the
// in-flight initializer has settled and registered any resource it created.
const cancellation = new AbortController()
const signalHandlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => cancellation.abort(signal)]))
for (const [signal, handler] of signalHandlers) process.on(signal, handler)
const checkCancelled = () => cancellation.signal.throwIfAborted()
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !/SUPABASE|ADVENTURE_/.test(key)))
const bin = name => join(process.env.POSTGRES_BIN || join(root, '.cache/recurring-tools/bin'), name)
const run = (name, args) => {
  const r = spawnSync(name, args, { cwd: root, env, encoding: 'utf8' })
  if (r.error || r.status !== 0) throw new Error(`${name}: ${r.error?.message || r.stderr}`)
}
const freePort = async () => {
  const s = netServer().listen(0, '127.0.0.1'); await once(s, 'listening')
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port
}
const port = Number(process.env.PLAYWRIGHT_PORT || 5230)
const owner = crypto.randomUUID(), email = 'integration@example.invalid'
const user = { id: owner, email, role: 'authenticated', aud: 'authenticated', email_confirmed_at: '2026-11-15', app_metadata: {}, user_metadata: {}, created_at: '2026-11-15' }
let work, pgPort, rpcPort, client, rest, server, listener, database, started = false
async function close() {
  const attempt = async action => {
    try { await action() } catch (error) { console.error(`Preview cleanup: ${error.message}`); process.exitCode = 1 }
  }
  if (listener?.listening) await attempt(() => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve())))
  await attempt(() => server?.close())
  await attempt(() => database?.restore())
  if (rest && rest.exitCode === null && rest.signalCode === null) await attempt(async () => {
    const exited = once(rest, 'exit'); rest.kill('SIGTERM'); await exited
  })
  await attempt(() => client?.end())
  // pg_ctl can fail after starting PG; inspect only our freshly created data
  // directory too. Never delete a live cluster if its shutdown failed.
  const hasPid = work && await access(join(work, 'postmaster.pid')).then(() => true, () => false)
  let stopped = !started && !hasPid
  if (started || hasPid) await attempt(() => { run(bin('pg_ctl'), ['-D', work, '-m', 'fast', '-w', 'stop']); stopped = true })
  if (work && stopped) await attempt(() => rm(work, { recursive: true, force: true }))
}
try {
  checkCancelled()
  work = await mkdtemp(join(tmpdir(), 'lifespace-201-preview-')); checkCancelled()
  pgPort = await freePort(); checkCancelled()
  rpcPort = await freePort(); checkCancelled()
  run(bin('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  checkCancelled()
  run(bin('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -c unix_socket_directories=''`, '-w', 'start']); started = true
  checkCancelled()
  client = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', database: 'postgres', ssl: false }); await client.connect()
  checkCancelled()
  await client.query('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role')
  checkCancelled()
  const install = await buildRecurringInstall(); checkCancelled()
  await client.query(install); checkCancelled()
  rest = spawn(process.env.POSTGREST_BIN || join(root, '.cache/recurring-tools/postgrest'), [], {
    cwd: work, env: { ...env, PGRST_DB_URI: `postgres://postgres@127.0.0.1:${pgPort}/postgres`, PGRST_DB_ANON_ROLE: 'service_role', PGRST_DB_SCHEMAS: 'public', PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(rpcPort), PGRST_LOG_LEVEL: 'crit' }, stdio: ['ignore', 'ignore', 'inherit'],
  })
  let restError
  rest.on('error', error => { restError = error })
  const rpc = `http://127.0.0.1:${rpcPort}`
  let ready = false
  for (let i = 0; i < 50; i++) {
    checkCancelled()
    if (restError) throw restError
    try { if ((await fetch(rpc, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(500)]) })).ok) { ready = true; break } } catch { checkCancelled() }
    await delay(100, undefined, { signal: cancellation.signal })
  }
  checkCancelled()
  if (!ready) throw new Error('Local PostgREST not ready')
  process.env.ADVENTURE_LOCAL_RPC_URL = rpc
  server = await createServer({
    configFile: false, envDir: false, root, cacheDir: '.cache/recurring-preview-vite',
    resolve: { alias: { 'cloudflare:workers': join(root, 'tests/support/cloudflare-workers.ts') } },
    ssr: { noExternal: ['@cloudflare/workers-oauth-provider'] },
    plugins: [react(), {
      name: 'isolated-recurring-acceptance',
      transformIndexHtml() {
        return [{ tag: 'script', injectTo: 'head-prepend', children: `localStorage.setItem('sb-127-auth-token',JSON.stringify(${JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: 4102444800, user })}));` }]
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/') && !req.url?.startsWith('/test-auth/')) return next()
          const respond = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)) }
          if (req.url === '/api/auth/config') return respond(200, { url: `http://127.0.0.1:${port}/test-auth`, publishableKey: 'sb_publishable_local-test-only' })
          if (req.url === '/api/auth/me') return respond(200, { user })
          if (req.url === '/test-auth/auth/v1/user') return respond(200, user)
          if (!req.url.startsWith('/api/adventure')) return respond(503, { error: { code: 'SOURCE_UNAVAILABLE', message: '隔离验收仅开放人生冒险' } })
          try {
            const chunks = []; for await (const chunk of req) chunks.push(chunk)
            const input = Buffer.concat(chunks).toString()
            const response = await database.request(owner, req.url, req.method === 'GET' ? undefined : JSON.parse(input), req.headers['x-adventure-client-version'] ?? null)
            res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text())
          } catch { respond(500, { error: { message: '隔离预览请求失败' } }) }
        })
      },
    }],
    // Own the HTTP listener so Vite's standalone SIGTERM handler cannot exit
    // before the PostgREST/PG cleanup finishes. No HMR needed for acceptance.
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/.cache/**', '**/docs/evidence/**'] }, fs: { deny: ['.env', '.env.*', '**/.dev.vars*', '**/.cache/**', '**/.git/**', '**/.aws/**', '**/.codex/**', '**/dist/lifespace/**'] } },
  })
  checkCancelled()
  const support = await server.ssrLoadModule('/tests/support/planning-database.ts')
  checkCancelled()
  database = support.planningDatabase(email); database.install({ browserOwner: owner })
  const today = (await database.read(owner)).today
  checkCancelled()
  const goal = (await database.command(owner, { type: 'createGoal', title: '提升编程能力', standards: ['完成一项可衡量的成果'] })).result.entityId
  checkCancelled()
  const recurring = (await database.command(owner, { type: 'createRecurringTask', title: '刷 LeetCode', description: '本地隔离验收数据', destination: goal, requiredCount: 5, periodType: 'week', startOn: today, today })).result.entityId
  checkCancelled()
  await database.command(owner, { type: 'recordRecurringCompletion', id: recurring, today })
  checkCancelled()
  await database.command(owner, { type: 'createTask', title: '出门散步三十分钟', description: '', destination: goal, plannedOn: today })
  checkCancelled()
  listener = httpServer(server.middlewares)
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve) })
  checkCancelled()
  await writeFile(join(root, `.cache/201-preview-${port}.json`), JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${port}/adventure`, database: 'new disposable cluster', dataDirectory: work, pgPort, rpcPort, identity: 'synthetic test bridge', worker: 'production worker/index via Node app.request; not workerd' }, null, 2) + '\n')
  checkCancelled()
  console.log(`ISOLATED_PREVIEW_READY http://127.0.0.1:${port}/adventure (synthetic identity, real Worker app.request and new local PostgreSQL)`)
  await new Promise(resolve => {
    if (cancellation.signal.aborted) resolve()
    else cancellation.signal.addEventListener('abort', resolve, { once: true })
  })
} catch (error) {
  if (error !== cancellation.signal.reason && !(cancellation.signal.aborted && error?.name === 'AbortError')) {
    console.error(error?.message ?? String(error)); process.exitCode = 1
  }
} finally {
  await close()
  for (const [signal, handler] of signalHandlers) process.off(signal, handler)
}
