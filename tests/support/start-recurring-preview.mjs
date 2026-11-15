// Local acceptance preview only: no .dev.vars, hosted project or real identity.
// Browser -> loopback Vite middleware -> production Hono app.request -> local
// PostgREST -> a newly created PostgreSQL cluster. Not a workerd/Auth rehearsal.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer as netServer } from 'node:net'
import { createServer as httpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import pg from 'pg'
import { buildRecurringInstall } from '../../scripts/build-adventure-recurring-install.mjs'

const root = resolve(import.meta.dirname, '../..')
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
const work = await mkdtemp(join(tmpdir(), 'lifespace-201-preview-'))
const port = Number(process.env.PLAYWRIGHT_PORT || 5230)
const pgPort = await freePort(), rpcPort = await freePort()
const owner = crypto.randomUUID(), email = 'integration@example.invalid'
const user = { id: owner, email, role: 'authenticated', aud: 'authenticated', email_confirmed_at: '2026-11-15', app_metadata: {}, user_metadata: {}, created_at: '2026-11-15' }
let client, rest, server, listener, database, started = false, closing = false
async function close() {
  if (closing) return; closing = true
  if (listener) await new Promise(resolve => listener.close(resolve))
  await server?.close(); database?.restore()
  if (rest && rest.exitCode === null) { rest.kill('SIGTERM'); await once(rest, 'exit') }
  await client?.end()
  if (started) run(bin('pg_ctl'), ['-D', work, '-m', 'fast', '-w', 'stop'])
  await rm(work, { recursive: true, force: true })
}
try {
  run(bin('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run(bin('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -c unix_socket_directories=''`, '-w', 'start']); started = true
  client = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', database: 'postgres', ssl: false }); await client.connect()
  await client.query('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role')
  await client.query(await buildRecurringInstall())
  rest = spawn(process.env.POSTGREST_BIN || join(root, '.cache/recurring-tools/postgrest'), [], {
    cwd: work, env: { ...env, PGRST_DB_URI: `postgres://postgres@127.0.0.1:${pgPort}/postgres`, PGRST_DB_ANON_ROLE: 'service_role', PGRST_DB_SCHEMAS: 'public', PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(rpcPort), PGRST_LOG_LEVEL: 'crit' }, stdio: ['ignore', 'ignore', 'inherit'],
  })
  const rpc = `http://127.0.0.1:${rpcPort}`
  let ready = false
  for (let i = 0; i < 50; i++) { try { if ((await fetch(rpc)).ok) { ready = true; break } } catch {} await new Promise(resolve => setTimeout(resolve, 100)) }
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
  const support = await server.ssrLoadModule('/tests/support/planning-database.ts')
  database = support.planningDatabase(email); database.install({ browserOwner: owner })
  const today = (await database.read(owner)).today
  const goal = (await database.command(owner, { type: 'createGoal', title: '提升编程能力', standards: ['完成一项可衡量的成果'] })).result.entityId
  const recurring = (await database.command(owner, { type: 'createRecurringTask', title: '刷 LeetCode', description: '本地隔离验收数据', destination: goal, requiredCount: 5, periodType: 'week', startOn: today, today })).result.entityId
  await database.command(owner, { type: 'recordRecurringCompletion', id: recurring, today })
  await database.command(owner, { type: 'createTask', title: '出门散步三十分钟', description: '', destination: goal, plannedOn: today })
  listener = httpServer(server.middlewares)
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve) })
  await writeFile(join(root, `.cache/201-preview-${port}.json`), JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${port}/adventure`, database: 'new disposable cluster', dataDirectory: work, pgPort, rpcPort, identity: 'synthetic test bridge', worker: 'production worker/index via Node app.request; not workerd' }, null, 2) + '\n')
  console.log(`ISOLATED_PREVIEW_READY http://127.0.0.1:${port}/adventure (synthetic identity, real Worker app.request and new local PostgreSQL)`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)) })
} catch (error) { console.error(error.message); await close(); process.exitCode = 1 }
