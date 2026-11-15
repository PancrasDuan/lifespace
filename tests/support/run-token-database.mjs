import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'

// Never accepts a database URL; every run creates and deletes its own local cluster.
const work = await mkdtemp(join(tmpdir(), 'lifespace-token-db-'))
const bin = n => process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, n) : n
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && !k.startsWith('TOKEN_DB_')))
const freePort = async () => {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const port = s.address().port; await new Promise(r => s.close(r)); return port
}
const run = async (cmd, args, options = {}) => {
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let output = ''; child.stdout?.on('data', c => output += c); child.stderr?.on('data', c => output += c)
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`${cmd} failed (${code}): ${output.slice(-3000)}`)
}
let client, rest, started = false
try {
  const port = await freePort()
  await run(bin('initdb'), ['-D', work, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  await run(bin('pg_ctl'), ['-D', work, '-l', join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', '-t', '15', 'start'])
  started = true
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`
  client = new pg.Client({ connectionString: url, ssl: false }); await client.connect()
  await client.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator; create schema extensions; grant usage on schema public to anon,authenticated,service_role;")
  const files = (await readdir('db/token/migrations')).filter(f => f.endsWith('.sql')).sort()
  if (!files.length) throw new Error('Missing Token migration')
  for (const file of files) await client.query(await readFile(join('db/token/migrations', file), 'utf8'))
  let rpcUrl
  if (process.env.POSTGREST_BIN) {
    const restPort = await freePort()
    rest = spawn(process.env.POSTGREST_BIN, [], { env: { ...env, PGRST_DB_URI: `postgresql://authenticator@127.0.0.1:${port}/postgres`, PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_SCHEMAS: 'public', PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort) }, stdio: 'ignore' })
    rpcUrl = `http://127.0.0.1:${restPort}`
    const deadline = Date.now() + 15000
    for (;;) {
      try { if ((await fetch(rpcUrl)).ok) break } catch {}
      if (Date.now() > deadline || rest.exitCode !== null) throw new Error('PostgREST did not become ready')
      await new Promise(r => setTimeout(r, 100))
    }
  }
  console.log(`Token isolated PostgreSQL ${(await client.query('show server_version')).rows[0].server_version}; PostgREST ${rpcUrl ? 'enabled' : 'not requested'}`)
  const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/api/token-backend-database.test.ts'], { env: { ...env, TOKEN_DB_URL: url, ...(rpcUrl ? { TOKEN_DB_RPC_URL: rpcUrl } : {}) }, stdio: 'inherit' })
  const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(`Token database tests failed (${code})`)
} finally {
  if (rest && rest.exitCode === null) { rest.kill('SIGTERM'); await once(rest, 'exit') }
  await client?.end()
  if (started) await run(bin('pg_ctl'), ['-D', work, '-m', 'immediate', '-w', 'stop'])
  await rm(work, { recursive: true, force: true })
}
