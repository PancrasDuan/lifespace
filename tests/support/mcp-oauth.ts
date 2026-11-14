import { vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import app from '../../worker/index'
import { authorizationServer } from '../../worker/mcp-oauth'
import { mcpScopes, type OAuthEnv } from '../../worker/mcp-oauth-config'
import type { McpGrant } from '../../worker/mcp-grants'

export const oauthOwner = '00000000-0000-4000-8000-000000000007'
export const oauthOther = '00000000-0000-4000-8000-000000000008'
export const oauthIssuer = 'https://mcp.example.invalid'
export const oauthRedirect = 'http://127.0.0.1:19234/callback'
export class OAuthTestKv {
  records = new Map<string, { value: string; metadata?: unknown; expiry?: number }>()
  ignoreDeletes = false
  fail = false
  async get(key: string, options?: { type?: string } | string) {
    if (this.fail) throw new Error('synthetic KV failure')
    const record = this.records.get(key)
    if (!record || (record.expiry && record.expiry <= Date.now() / 1000)) return null
    return (typeof options === 'string' ? options : options?.type) === 'json' ? JSON.parse(record.value) : record.value
  }
  async put(key: string, value: string, options?: { metadata?: unknown; expirationTtl?: number; expiration?: number }) {
    if (this.fail) throw new Error('synthetic KV failure')
    this.records.set(key, { value, metadata: options?.metadata, expiry: options?.expiration ?? (options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined) })
  }
  async delete(key: string) { if (this.fail) throw new Error('synthetic KV failure'); if (!this.ignoreDeletes) this.records.delete(key) }
  async list(options?: { prefix?: string }) {
    return { keys: [...this.records].filter(([key]) => key.startsWith(options?.prefix ?? '')).map(([name, record]) => ({ name, metadata: record.metadata })), list_complete: true, cursor: '' }
  }
  binding() { return this as unknown as KVNamespace }
}

export function oauthFixture(databaseUrl?: string) {
  const nativeFetch = globalThis.fetch
  const kv = new OAuthTestKv()
  const grants = new Map<string, McpGrant & { codeUsed?: boolean; consentHash?: string }>()
  const users = new Map([oauthOwner, oauthOther].map(id => [id, { id, email: 'oauth@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, banned_until: null as string | null, deleted_at: null as string | null }]))
  const env: OAuthEnv = {
    MCP_OAUTH_ISSUER: oauthIssuer, OAUTH_KV: kv.binding(),
    SUPABASE_URL: 'https://oauth-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
    SUPABASE_SECRET_KEY: 'sb_secret_test-only', AUTH_ALLOWED_EMAILS: 'oauth@example.invalid',
    ASSETS: { fetch: async () => new Response('<!doctype html><div id="root"></div>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
  }
  const writes: { name: string; input: Record<string, unknown> }[] = []
  const documents = new Map<string, object>()
  let databaseFailed = false
  let rpcGate: ((name: string) => Promise<void>) | undefined
  vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } })
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (documents.has(url.href)) return Response.json(documents.get(url.href), { headers: { 'Cache-Control': 'no-store' } })
    if (url.origin !== env.SUPABASE_URL) return nativeFetch(input, init)
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init?.headers).get('Authorization')!.split('.')[1]
      return Response.json(users.get(JSON.parse(atob(token)).sub) ?? {}, { status: users.has(JSON.parse(atob(token)).sub) ? 200 : 401 })
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const user = users.get(url.pathname.split('/').at(-1)!)
      return Response.json(user ?? {}, { status: user ? 200 : 404 })
    }
    if (!url.pathname.startsWith('/rest/v1/rpc/')) throw new Error('unexpected synthetic upstream')
    if (databaseFailed) return new Response(null, { status: 503 })
    const name = url.pathname.split('/').at(-1)!
    const p = JSON.parse(String(init?.body))
    await rpcGate?.(name)
    if (databaseUrl) return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), databaseUrl), init)
    if (name === 'agent_oauth_grant_create') {
      if (grants.has(p.p_id) || [...grants.values()].some(grant => grant.consentHash === p.p_consent_hash)) return new Response(null, { status: 409 })
      const grant = { id: p.p_id, ownerId: p.p_owner, clientId: p.p_client, clientName: p.p_name, resource: p.p_resource, scopes: p.p_scopes,
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 2592000000).toISOString(), revokedAt: null, providerGrantId: null, consentHash: p.p_consent_hash }
      grants.set(grant.id, grant)
      return Response.json(grant)
    }
    if (name === 'agent_oauth_grants_list') return Response.json([...grants.values()].filter(grant => grant.ownerId === p.p_owner && (!p.p_before || grant.createdAt < p.p_before || (grant.createdAt === p.p_before && grant.id > p.p_before_id))).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0,101))
    const grant = grants.get(p.p_id)
    if (name === 'agent_oauth_grant_revoke') {
      if (!grant || grant.ownerId !== p.p_owner) return Response.json(null)
      grant.revokedAt ??= new Date().toISOString()
      return Response.json(grant)
    }
    if (name === 'agent_oauth_grant_check') {
      if (!grant || grant.ownerId !== p.p_owner || grant.clientId !== p.p_client || grant.resource !== p.p_resource || grant.revokedAt || Date.parse(grant.expiresAt) <= Date.now()) return Response.json(null)
      if (p.p_provider_grant) {
        if ((grant.providerGrantId && grant.providerGrantId !== p.p_provider_grant) || (p.p_exchange_code && grant.codeUsed)) return Response.json(null)
        grant.providerGrantId = p.p_provider_grant
        if (p.p_exchange_code) grant.codeUsed = true
      }
      return Response.json(grant)
    }
    writes.push({ name, input: p })
    if (name === 'ledger_accounts_list') return Response.json({ accounts: [], version: 0 })
    if (name === 'ledger_create' || name === 'ledger_refund') return Response.json({ entryId: p.p_input.requestId, version: 1, deleted: false })
    throw new Error('unexpected synthetic RPC')
  }))
  const browserToken = (owner = oauthOwner) => `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, session_id: owner, exp: 4102444800 })).toString('base64url')}.synthetic`
  // Hono's test API accepts the real runtime context as its fourth argument.
  const context = { waitUntil: (_promise: Promise<unknown>) => {}, passThroughOnException: () => {}, props: {} }
  const request = (path: string, init: RequestInit = {}) => app.request(new URL(path, oauthIssuer).href, init, env, context)
  const browser = (path: string, body?: unknown, owner = oauthOwner, cookie = '') => request(path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: oauthIssuer, Authorization: `Bearer ${browserToken(owner)}`, 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const tokenRequest = (params: Record<string, string>) => request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const mcp = (token?: string, name?: string, args?: object) => request('/api/agent/mcp', { method: 'POST', headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: name ? 'tools/call' : 'tools/list', ...(name ? { params: { name, arguments: args ?? {} } } : {}) }) })
  const client = () => authorizationServer(env).getOAuthApi(env).createClient({ clientName: 'Synthetic MCP Client', redirectUris: [oauthRedirect], tokenEndpointAuthMethod: 'none', grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'] })
  const start = async (clientId: string, scopes: readonly string[] = mcpScopes, owner = oauthOwner, extra: Record<string, string> = {}) => {
    const verifier = randomBytes(32).toString('base64url')
    const query = '?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: oauthRedirect, state: 'synthetic-state', scope: scopes.join(' '), resource: `${oauthIssuer}/api/agent/mcp`, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...extra })
    const response = await browser('/api/oauth/consent/start', { query }, owner)
    const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const body = await response.json() as { handle: string; details: object }
    return { response, ...body, cookies, verifier, query }
  }
  const approve = async (clientId: string, scopes: readonly string[] = mcpScopes, owner = oauthOwner) => {
    const consent = await start(clientId, scopes, owner)
    if (consent.response.status !== 200) throw new Error('synthetic consent start failed')
    const response = await browser('/api/oauth/consent/finish', { handle: consent.handle, decision: 'approve', scopes }, owner, consent.cookies)
    const result = await response.json() as { redirectTo: string }
    if (response.status !== 200) throw new Error('synthetic consent finish failed: ' + response.status)
    return { ...consent, code: new URL(result.redirectTo).searchParams.get('code')!, redirectTo: result.redirectTo }
  }
  const issue = async (clientId: string, scopes: readonly string[] = mcpScopes, owner = oauthOwner) => {
    const consent = await approve(clientId, scopes, owner)
    const response = await tokenRequest({ grant_type: 'authorization_code', code: consent.code, code_verifier: consent.verifier, client_id: clientId, redirect_uri: oauthRedirect, resource: `${oauthIssuer}/api/agent/mcp` })
    const token = await response.json() as { access_token: string; refresh_token: string; scope: string; resource: string }
    if (response.status !== 200) throw new Error('synthetic token exchange failed: ' + response.status + ' ' + JSON.stringify(token))
    return { ...consent, ...token }
  }
  return { env, kv, grants, users, writes, documents, request, browser, tokenRequest, mcp, client, start, approve, issue, browserToken, failDatabase: () => { databaseFailed = true }, setRpcGate: (gate: (name: string) => Promise<void>) => { rpcGate = gate } }
}
