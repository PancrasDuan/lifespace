// Local-only review harness: synthetic Auth, real Worker/PG/PostgREST/collectors.
// No production config is loaded. All listeners bind numeric loopback.
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { randomBytes, createHmac } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as viteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { Agent, buildConnector, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import pg from 'pg'

const port = Number(process.env.TOKEN_PREVIEW_PORT || 5220)
const origin = `http://127.0.0.1:${port}`
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port')
if (process.argv[2]) {
  const action = process.argv[2], device = process.argv[3] || 'linux'
  if (!['start', 'claim', 'sync'].includes(action) || !['linux', 'macos'].includes(device)) throw Error('Use start|claim|sync linux|macos')
  const response = await fetch(`${origin}/__token219/${action}/${device}`, { method: 'POST' })
  if (!response.ok) throw Error(`Local preview operation failed: ${response.status}`)
  console.log(await response.text()); process.exit(0)
}
if (!process.env.POSTGRES_BIN || !process.env.POSTGREST_BIN) throw Error('Explicit local POSTGRES_BIN and POSTGREST_BIN required')
process.umask(0o077)
const work = await mkdtemp(join(tmpdir(), 'token219-preview-'))
const exec = promisify(execFile)
const bin = name => join(process.env.POSTGRES_BIN, name)
const run = (file, args) => exec(file, args, { timeout: 30000, maxBuffer: 1024 * 1024 })
const listen = async (server, requested = 0) => { server.listen(requested, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const freePort = async () => { const s = tcpServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p }
const close = async server => { if (server) { server.closeAllConnections?.(); await new Promise(r => server.close(r)) } }
let db, rest, gateway, web, modules, started = false
const stores = new Map(), previous = getGlobalDispatcher()
let dispatcher
const owner = '00000000-0000-4000-8000-000000000219'
const email = 'token219@example.com', signing = randomBytes(32).toString('hex'), serviceKey = randomBytes(32).toString('base64url')
const publishableKey = 'sb_publishable_' + randomBytes(12).toString('base64url')
const jwt = claims => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url')
  return head + '.' + createHmac('sha256', signing).update(head).digest('base64url')
}
const expires = Math.floor(Date.now() / 1000) + 86400
const browserToken = jwt({ sub: owner, session_id: '00000000-0000-4000-8000-000000000001', exp: expires })
const user = { id: owner, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-11-16', is_anonymous: false, app_metadata: {}, user_metadata: {} }
const authKv = { get: async key => key === 'AUTH_ALLOWED_EMAILS' ? email : null }
const bindings = { SUPABASE_URL: 'https://127.0.0.1', SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: serviceKey, AUTH_KV: authKv }
const reply = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
const cleanup = async () => {
  await close(web); await modules?.close(); await close(gateway)
  setGlobalDispatcher(previous); await dispatcher?.close()
  for (const s of stores.values()) s.store.close()
  if (rest && rest.exitCode === null) { rest.kill('SIGTERM'); await once(rest, 'exit') }
  await db?.end()
  if (started) await run(bin('pg_ctl'), ['-D', join(work, 'pg'), '-m', 'immediate', '-w', 'stop'])
  await rm(work, { recursive: true, force: true })
}
try {
  const pgPort = await freePort(), restPort = await freePort(), data = join(work, 'pg')
  await run(bin('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  await run(bin('pg_ctl'), ['-D', data, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -c unix_socket_directories=''`, '-w', 'start']); started = true
  db = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres` }); await db.connect()
  await db.query('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login noinherit; grant anon,authenticated,service_role to authenticator; create schema extensions; grant usage on schema public to anon,authenticated,service_role;')
  for (const file of (await readdir('db/token/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.query(await readFile(join('db/token/migrations', file), 'utf8'))
  rest = spawn(process.env.POSTGREST_BIN, [], { env: { PATH: process.env.PATH, PGRST_DB_URI: `postgresql://authenticator@127.0.0.1:${pgPort}/postgres`, PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_SCHEMAS: 'public', PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_JWT_SECRET: signing }, stdio: 'ignore' })
  const deadline = Date.now() + 15000
  while (true) { try { if ((await fetch(`http://127.0.0.1:${restPort}`)).ok) break } catch {} if (Date.now() > deadline) throw Error('PostgREST startup failed'); await new Promise(r => setTimeout(r, 100)) }
  const key = join(work, 'gateway.key'), cert = join(work, 'gateway.crt')
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=token219-local-only', '-addext', 'subjectAltName=IP:127.0.0.1'])
  gateway = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      if (req.url === '/auth/v1/user') { reply(res, req.headers.authorization === 'Bearer ' + browserToken ? 200 : 401, req.headers.authorization === 'Bearer ' + browserToken ? user : {}); return }
      if (![publishableKey, serviceKey].includes(req.headers.apikey)) { reply(res, 401, {}); return }
      const chunks = []; for await (const c of req) chunks.push(c)
      const headers = { 'Content-Type': 'application/json' }
      if (req.headers.apikey === serviceKey) headers.Authorization = 'Bearer ' + jwt({ role: 'service_role', exp: expires })
      if (req.headers['x-lifespace-device-token']) headers['x-lifespace-device-token'] = req.headers['x-lifespace-device-token']
      const response = await fetch(`http://127.0.0.1:${restPort}` + req.url.replace('/rest/v1', ''), { method: 'POST', headers, body: Buffer.concat(chunks) })
      res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text())
    } catch { reply(res, 503, {}) }
  })
  const gatewayPort = await listen(gateway), connector = buildConnector({ ca: await readFile(cert) })
  dispatcher = new Agent({ connect(options, callback) { connector({ ...options, ...(options.protocol === 'https:' && options.hostname === '127.0.0.1' ? { port: String(gatewayPort) } : {}) }, callback) } }); setGlobalDispatcher(dispatcher)
  modules = await viteServer({ configFile: false, envDir: false, cacheDir: 'test-results/token219/preview-ssr-cache', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { 'cloudflare:workers': resolve('tests/support/cloudflare-workers.ts') } } })
  const { default: app } = await modules.ssrLoadModule('/worker/index.ts')
  const { Store } = await modules.ssrLoadModule('/tools/token-collector/store.ts')
  const { scan } = await modules.ssrLoadModule('/tools/token-collector/collector.ts')
  const { startRegistration, claimRegistration, uploadPending } = await modules.ssrLoadModule('/tools/token-collector/transport.ts')
  const { syntheticCodexLog } = await modules.ssrLoadModule('/tests/fixtures/token-usage/synthetic.ts')
  for (const kind of ['linux', 'macos']) {
    const state = join(work, kind), home = join(work, kind + '-source')
    await mkdir(join(home, '.codex/sessions'), { recursive: true })
    // Each state has its own synthetic source; both execute on this Linux host.
    const today = new Date().toISOString().slice(0, 10)
    for (let days = 0; days < 30; days++) {
      const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - days)
      const day = date.toISOString().slice(0, 10)
      const source = syntheticCodexLog().replaceAll('2026-11-14', day).replaceAll('2026-11-15', day).replaceAll('synthetic-token-206', `synthetic-${kind}-${days}`).replaceAll('gpt-5.5', kind === 'linux' ? 'gpt-5.5' : 'gpt-5.4')
      await writeFile(join(home, '.codex/sessions', `synthetic-${days}.jsonl`), source, { mode: 0o600 })
    }
    const store = await Store.open(state)
    store.set('config', { deviceId: `synthetic-token219-${kind}`, server: origin + '/', sourceHome: home, hours: 3, loopback: true })
    stores.set(kind, { store, state })
  }
  const workerRequest = (path, body) => app.request(origin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + browserToken }, ...(body ? { body: JSON.stringify(body) } : {}) }, bindings)
  const { sensitiveFileDeny } = await modules.ssrLoadModule('/build-plugins/sensitive-file-deny.ts')
  const { tokenCollectorBoundary } = await modules.ssrLoadModule('/build-plugins/token-collector-boundary.ts')
  let frontend
  // API and harness operations are not part of the product router or production bundle.
  web = httpServer(async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) { reply(res, 403, {}); return }
    try {
      if (req.url === '/__token219/session' && req.method === 'GET') {
        const session = { access_token: browserToken, refresh_token: 'local-synthetic-only', token_type: 'bearer', expires_at: expires, user }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        res.end('<!doctype html><meta charset="utf-8"><title>Token219 隔离认证</title><script>localStorage.setItem("sb-127-auth-token",' + JSON.stringify(JSON.stringify(session)) + ');location.replace("/token")</script>'); return
      }
      const match = /^\/__token219\/(start|claim|sync)\/(linux|macos)$/.exec(req.url)
      if (match && req.method === 'POST') {
        const entry = stores.get(match[2]); let result
        if (match[1] === 'start') result = await startRegistration(entry.store, entry.store.config(), `synthetic-${match[2]}-state`, match[2])
        if (match[1] === 'claim') result = await claimRegistration(entry.store)
        if (match[1] === 'sync') { await scan(entry.store, entry.state, { offline: true }); result = await uploadPending(entry.store, `synthetic-${match[2]}-state`) }
        reply(res, 200, result); return
      }
      if (req.url.startsWith('/api/')) {
        const chunks = []; for await (const c of req) chunks.push(c)
        const response = await app.request(origin + req.url, { method: req.method, headers: req.headers, ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}) }, bindings)
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return
      }
      frontend.middlewares(req, res)
    } catch { reply(res, 503, { error: { code: 'LOCAL_PREVIEW_ERROR' } }) }
  })
  frontend = await viteServer({ configFile: false, envDir: false, cacheDir: 'test-results/token219/preview-client-cache', plugins: [tokenCollectorBoundary(), react()], server: { middlewareMode: true, hmr: false, ws: { server: web, host: '127.0.0.1', clientPort: port }, fs: { deny: sensitiveFileDeny(resolve('.'), ['**/test-results/**']) } } })
  web.on('close', () => void frontend.close())
  await listen(web, port)
  // Seed through registration approval, terminal claim, Tokscale/SQLite and HTTPS RPC.
  for (const [kind, entry] of stores) {
    const display = await startRegistration(entry.store, entry.store.config(), `synthetic-${kind}-state`, kind)
    const inspected = await (await workerRequest('/api/token/registrations/inspect', { code: display.code })).json()
    const approved = await workerRequest('/api/token/registrations/decide', { code: display.code, requestId: inspected.requestId, approve: true, replaceExisting: false })
    if (!approved.ok || (await claimRegistration(entry.store)).status !== 'claimed') throw Error('Synthetic authorization failed')
    await scan(entry.store, entry.state, { offline: true })
    if ((await uploadPending(entry.store, `synthetic-${kind}-state`)).pending) throw Error('Synthetic upload failed')
  }
  await writeFile(resolve('test-results/token219/preview.json'), JSON.stringify({ origin, pid: process.pid, work, data: 'two independent synthetic collector states on Linux; 30 source days each', authentication: 'loopback-only synthetic Auth, real product AuthGate/allowlist/Worker', bootstrap: origin + '/__token219/session' }, null, 2))
  console.log(`Token219 isolated preview ${origin}/__token219/session (synthetic authentication and sources; real Worker, PostgreSQL, PostgREST, SQLite, Tokscale)`)
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await cleanup(); process.exit(0) })
} catch (error) { console.error('Local preview failed:', error.message); await cleanup(); process.exitCode = 1 }
