// Isolated legacy cluster and loopback PostgREST only; never accepts a DB URL.
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'

const root = resolve(import.meta.dirname, '../..')
const oldDist = process.env.OLD_ADVENTURE_DIST
if (!oldDist) throw new Error('OLD_ADVENTURE_DIST must point to a separately built legacy client')
const dir = await mkdtemp(join(tmpdir(), 'lifespace-old-cutover-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const bin = name => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : name
const run = (name, args) => {
  const result = spawnSync(name, args, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} exited ${result.status}`)
}
const freePort = async () => {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
let started = false, rest, client
try {
  const port = await freePort(), rpcPort = await freePort()
  run(bin('initdb'), ['-D', dir, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run(bin('pg_ctl'), ['-D', dir, '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start'])
  started = true
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await client.connect()
  await client.query('create role anon; create role authenticated; create role service_role bypassrls; create schema cutover_test; create table cutover_test.marker (id uuid not null);')
  const marker = crypto.randomUUID()
  await client.query('insert into cutover_test.marker values ($1)', [marker])
  for (const path of ['tests/database/legacy-goal-migration/create-planning.sql', 'tests/database/legacy-goal-migration/list-tasks.sql']) await client.query(await readFile(join(root, path), 'utf8'))
  rest = spawn(process.env.POSTGREST_BIN || 'postgrest', [], { cwd: dir, env: { ...env, PGRST_DB_URI: `postgres://postgres@127.0.0.1:${port}/postgres`, PGRST_DB_ANON_ROLE: 'service_role', PGRST_DB_SCHEMAS: 'public', PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(rpcPort), PGRST_LOG_LEVEL: 'crit' }, stdio: ['ignore', 'ignore', 'inherit'] })
  let ready = false
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${rpcPort}`)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('isolated PostgREST not ready')
  const spec = process.argv.includes('--handoff') ? 'tests/browser/adventure-transition-handoff-database.spec.ts' : 'tests/browser/adventure-legacy-cutover-database.spec.ts'
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', spec], { cwd: root, env: { ...env, OLD_ADVENTURE_DIST: oldDist, OLD_CUTOVER_PG_PORT: String(port), OLD_CUTOVER_MARKER: marker, ADVENTURE_LOCAL_RPC_URL: `http://127.0.0.1:${rpcPort}` }, stdio: 'inherit' })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`legacy browser exited ${code}`)
} finally {
  if (rest && rest.exitCode === null) { const exit = once(rest, 'exit'); rest.kill('SIGTERM'); await exit }
  if (client) await client.end()
  if (started) run(bin('pg_ctl'), ['-D', dir, '-m', 'fast', '-w', 'stop'])
  await rm(dir, { recursive: true, force: true })
}
