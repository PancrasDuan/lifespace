import { expect, test } from 'vitest'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { authorizationServer } from '../../worker/mcp-oauth'
import type { OAuthEnv } from '../../worker/mcp-oauth-config'

const rpc = process.env.LEDGER_LOCAL_RPC_URL
test.skipIf(!rpc)('真实 workerd + KV + 隔离 PostgreSQL 完成发现、同意、刷新与撤销', async () => {
  const issuer = 'https://runtime.example.invalid'
  const owner = '00000000-0000-4000-8000-000000000007'
  const user = { id: owner, email: 'runtime@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false }
  const env = { MCP_OAUTH_ISSUER: issuer, SUPABASE_URL: 'https://runtime-auth.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runtime-test-only', SUPABASE_SECRET_KEY: 'sb_secret_runtime-test-only', AUTH_ALLOWED_EMAILS: user.email }
  const workerFiles = await readdir(resolve('dist/lifespace'), { recursive: true })
  const modules = ['index.js', ...workerFiles.filter(path => path.endsWith('.js') && path !== 'index.js')].map(path => ({ type: 'ESModule' as const, path: resolve('dist/lifespace', path) }))
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'lifespace-oauth-runtime-test', modules, modulesRoot: resolve('dist/lifespace'),
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], bindings: env,
    kvNamespaces: ['OAUTH_KV', 'HOROSCOPE_KV'],
    assets: { directory: resolve('dist/client'), binding: 'ASSETS', run_worker_first: ['/api/*', '/oauth/*', '/.well-known/*'], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
    outboundService: async request => {
      const url = new URL(request.url)
      if (url.origin !== env.SUPABASE_URL) throw new Error('runtime test forbids external upstreams')
      if (url.pathname === '/auth/v1/user' || url.pathname === '/auth/v1/admin/users/' + owner) return new RuntimeResponse(JSON.stringify(user), { headers: { 'Content-Type': 'application/json' } })
      if (!url.pathname.startsWith('/rest/v1/rpc/agent_oauth_')) throw new Error('runtime test forbids business writes')
      const response = await fetch(new URL(url.pathname.replace('/rest/v1', ''), rpc!), { method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() })
      return new RuntimeResponse(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) })
    },
  }] }))
  try {
    const kv = await runtime.getKVNamespace('OAUTH_KV')
    const helpers = authorizationServer({ ...env, OAUTH_KV: kv as unknown as KVNamespace } satisfies OAuthEnv).getOAuthApi({ ...env, OAUTH_KV: kv as unknown as KVNamespace })
    const client = await helpers.createClient({ clientName: 'Runtime synthetic client', redirectUris: ['http://127.0.0.1:19234/callback'], tokenEndpointAuthMethod: 'none', grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'] })
    const request = (path: string, init?: Parameters<Miniflare['dispatchFetch']>[1]) => runtime.dispatchFetch(new URL(path, issuer).href, init)
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.runtime-test`
    const browser = (path: string, body?: object, cookie = '') => request(path, { method: body ? 'POST' : 'GET', headers: { Origin: issuer, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    const challenge = await request('/api/agent/mcp')
    expect(challenge.status).toBe(401)
    expect(challenge.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
    const metadata = await request('/.well-known/oauth-authorization-server')
    expect(await metadata.json()).toMatchObject({ issuer, client_id_metadata_document_supported: true })
    expect((await request('/oauth/authorize')).headers.get('Content-Type')).toContain('text/html')
    expect((await request('/.well-known/absent')).status).toBe(404)
    const verifier = randomBytes(32).toString('base64url')
    const query = '?' + new URLSearchParams({ client_id: client.clientId, redirect_uri: 'http://127.0.0.1:19234/callback', response_type: 'code', resource: issuer + '/api/agent/mcp', scope: 'ledger:accounts:read', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })
    const start = await browser('/api/oauth/consent/start', { query })
    expect(start.status).toBe(200)
    const { handle } = await start.json() as { handle: string }
    const cookie = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const approved = await browser('/api/oauth/consent/finish', { handle, decision: 'approve', scopes: ['ledger:accounts:read'] }, cookie)
    expect(approved.status).toBe(200)
    const { redirectTo } = await approved.json() as { redirectTo: string }
    const exchange = (params: Record<string,string>) => request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
    const issued = await exchange({ grant_type: 'authorization_code', code: new URL(redirectTo).searchParams.get('code')!, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:19234/callback', client_id: client.clientId })
    expect(issued.status).toBe(200)
    const credentials = await issued.json() as { access_token: string; refresh_token: string }
    const mcp = () => request('/api/agent/mcp', { method: 'POST', headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect((await mcp()).status).toBe(200)
    expect((await request('/api/ledger/accounts', { headers: { Authorization: `Bearer ${credentials.access_token}` } })).status).toBe(401)
    expect((await exchange({ grant_type: 'refresh_token', client_id: client.clientId, refresh_token: credentials.refresh_token })).status).toBe(200)
    const grants = await (await browser('/api/oauth/grants')).json() as { grants: { id: string; clientId: string }[] }
    const grant = grants.grants.find(grant => grant.clientId === client.clientId)!
    expect((await browser('/api/oauth/grants/revoke', { id: grant.id })).status).toBe(200)
    expect((await mcp()).status).toBe(401)
    expect((await exchange({ grant_type: 'refresh_token', client_id: client.clientId, refresh_token: credentials.refresh_token })).status).toBe(400)
  } finally { await runtime.dispose() }
}, 30000)
