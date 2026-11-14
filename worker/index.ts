import { Hono } from 'hono'
import { listLedger, detailLedger, createLedger, createLedgerEntry, createLedgerRefund, createLedgerTransfer, refundLedger, previewLedgerDelete, deleteLedger, listLedgerAccounts, readLedgerAccounts, createLedgerAccount, updateLedgerAccount } from './ledger'
import { readTaskList, readRewardSource, readGrowth, readTaskHistory, readMigrationOptions, readPlanning, previewPlanning, commandPlanning, lookupPlanningReceipt, oldClientUnavailable } from './adventure/planning'
import { adventureClientVersion, adventureClientVersionHeader } from '../src/shared/adventure-client-version'
import { readHoroscope } from './horoscope'
import { readTasks } from './tasks'
import { ApiError, apiErrorBody } from './upstream'
import { searchLocations } from './weather'
import { readWeatherDetail, readAirQuality } from './weather-detail'
import { readDomainCard } from './domain-card'
import { newsSources } from '../src/shared/news-sources'
import { readNews } from './news'
import { readAiStatus } from './ai-status'
import { publicConfig, registrationHook, verifyIdentity, type Identity } from './auth'
import { verifyAgentIdentity } from './agent-auth'
import { handleAgentMcp } from './agent-mcp'
import { beginTrace, traceErrorCode, withRootSpan } from './trace'
import { McpAuthError, bearerChallenge, mcpScopes, oauthConfig, trustedOAuthOrigin, type OAuthEnv } from './mcp-oauth-config'
// The OAuth dependency imports a Workers-only builtin. Load it only for OAuth
// traffic so existing Node-hosted REST/browser fixtures can still import this app.
const mcpOAuth = () => import('./mcp-oauth')

const app = new Hono<{ Bindings: OAuthEnv; Variables: { identity: Identity } }>()
app.use('*', async (c, next) => {
  const path = c.req.path
  const oauthDocument = c.req.method === 'GET' && ['/oauth/authorize', '/oauth/grants'].includes(path)
  if (path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path.startsWith('/api/oauth/') || path === '/api/agent/mcp') {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
    c.header('Content-Security-Policy', "frame-ancestors 'none'")
    // Public SPA documents can be previewed on a local/test host. Only the
    // canonical issuer may process discovery, credentials or consent APIs.
    if (!oauthDocument) trustedOAuthOrigin(c.env, c.req.raw)
    const origin = !oauthDocument ? c.req.header('Origin') : undefined
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Vary', 'Origin')
      c.header('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version')
    }
    if (c.req.method === 'OPTIONS') {
      const headers = (c.req.header('Access-Control-Request-Headers') ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
      if (headers.some(value => !['authorization', 'content-type', 'mcp-protocol-version', 'accept'].includes(value))) return c.body(null, 403)
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Accept')
      return c.body(null, 204)
    }
  }
  await next()
  if (path.startsWith('/api/') || path.startsWith('/oauth/') || path.startsWith('/.well-known/')) {
    c.res = new Response(c.res.body, c.res)
    c.res.headers.set('Cache-Control', 'no-store')
  }
  if (path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path.startsWith('/api/oauth/') || path === '/api/agent/mcp') {
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('X-Frame-Options', 'DENY')
    // Keep the asset response's complete CSP (script/connect policy) intact.
    const policy = c.res.headers.get('Content-Security-Policy') ?? ''
    if (!policy.includes('frame-ancestors')) c.res.headers.set('Content-Security-Policy', `${policy}${policy ? '; ' : ''}frame-ancestors 'none'`)
    if (!oauthDocument && c.req.header('Origin')) {
      c.res.headers.set('Access-Control-Allow-Origin', c.req.header('Origin')!)
      c.res.headers.set('Vary', 'Origin')
      c.res.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version')
    }
  }
  // Library protocol responses default to wildcard CORS; use this deployment's
  // explicit origin policy for both successful responses and OAuth errors.
  if (path === '/oauth/token' || path === '/oauth/register' || path.startsWith('/.well-known/')) {
    c.res.headers.delete('Access-Control-Allow-Origin')
    if (c.req.header('Origin')) c.res.headers.set('Access-Control-Allow-Origin', c.req.header('Origin')!)
  }
})
app.get('/.well-known/oauth-protected-resource/api/agent/mcp', c => {
  const { issuer, resource } = oauthConfig(c.env)
  return c.json({ resource, authorization_servers: [issuer], scopes_supported: [mcpScopes[0]], bearer_methods_supported: ['header'] })
})
app.get('/.well-known/oauth-protected-resource', c => {
  const { issuer, resource } = oauthConfig(c.env)
  return c.json({ resource, authorization_servers: [issuer], scopes_supported: [mcpScopes[0]], bearer_methods_supported: ['header'] })
})
app.all('/.well-known/oauth-authorization-server', async c => (await mcpOAuth()).serveOAuthProtocol(c))
app.all('/oauth/token', async c => (await mcpOAuth()).serveOAuthProtocol(c))
app.all('/oauth/register', async c => (await mcpOAuth()).serveOAuthProtocol(c))
app.get('/oauth/authorize', async c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('页面不存在', 404))
app.get('/oauth/grants', async c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('页面不存在', 404))
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await withRootSpan(beginTrace(c), () => next())
})
app.get('/api/auth/config', c => c.json(publicConfig(c.env)))
app.post('/api/auth/hooks/before-user-created', async c => {
  try {
    const result = await registrationHook(c.env, c.req.raw)
    return c.json(result.body, result.status)
  } catch (error) {
    traceErrorCode(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', c.req.path, c)
    return c.json({ error: { http_code: 503, message: '注册服务暂时不可用' } }, 503)
  }
})
// A fixed failure before authentication keeps an old client's unknown envelope
// pending. No request body, identity, receipt or business data is accessed.
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/adventure/commands'
    && c.req.header(adventureClientVersionHeader) !== adventureClientVersion) throw oldClientUnavailable()
  await next()
})
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/agent/mcp') {
    const grant = await (await mcpOAuth()).verifyMcpIdentity(c.env, c.req.header('Authorization'))
    c.set('identity', { ...grant.identity, mcpScopes: grant.scopes })
    await next()
    return
  }
  if (c.req.path === '/api/agent/legacy/mcp' && c.env.MCP_LEGACY_ENABLED === 'true') {
    c.set('identity', await verifyAgentIdentity(c.env, c.req.header('Cf-Access-Jwt-Assertion')))
    await next()
    return
  }
  c.set('identity', await verifyIdentity(c.env, c.req.header('Authorization'), c.req.path))
  await next()
})
app.all('/api/agent/mcp', async c => {
  const response = await handleAgentMcp(c.req.raw, {
    listAccounts: input => readLedgerAccounts(c, input),
    createEntry: input => createLedgerEntry(c, input),
    refundEntry: (id, input) => createLedgerRefund(c, id, input),
  }, name => {
    const required = ({ list_ledger_accounts: mcpScopes[0], create_ledger_entry: mcpScopes[1], create_ledger_refund: mcpScopes[2] } as Record<string, string>)[name]
    if (required && !(c.get('identity').mcpScopes ?? []).includes(required)) throw new McpAuthError('insufficient_scope', [required])
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
})
app.all('/api/agent/legacy/mcp', async c => {
  if (c.env.MCP_LEGACY_ENABLED !== 'true') return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404)
  return handleAgentMcp(c.req.raw, {
    listAccounts: input => readLedgerAccounts(c, input),
    createEntry: input => createLedgerEntry(c, input),
    refundEntry: (id, input) => createLedgerRefund(c, id, input),
  })
})
app.post('/api/oauth/consent/start', async c => (await mcpOAuth()).beginMcpConsent(c))
app.post('/api/oauth/consent/finish', async c => (await mcpOAuth()).finishMcpConsent(c))
app.get('/api/oauth/grants', async c => (await mcpOAuth()).readMcpGrants(c))
app.post('/api/oauth/grants/revoke', async c => (await mcpOAuth()).revokeMcpConsent(c))
app.get('/api/auth/me', c => c.json({ user: c.get('identity') }))
app.get('/api/horoscope', async c => c.json(await readHoroscope(c.env, new URL(c.req.url).searchParams)))
app.get('/api/ledger/entries', listLedger)
app.get('/api/ledger/accounts', listLedgerAccounts)
app.post('/api/ledger/accounts', createLedgerAccount)
app.patch('/api/ledger/accounts/:id', updateLedgerAccount)
app.get('/api/ledger/entries/:id', detailLedger)
app.post('/api/ledger/entries', createLedger)
app.post('/api/ledger/transfers', createLedgerTransfer)
app.post('/api/ledger/entries/:id/refunds', refundLedger)
app.get('/api/ledger/entries/:id/delete-preview', previewLedgerDelete)
app.post('/api/ledger/entries/:id/delete', deleteLedger)
app.get('/api/adventure', readPlanning)
app.post('/api/adventure/tasks/list', readTaskList)
app.get('/api/adventure/migration-options', readMigrationOptions)
app.get('/api/adventure/task-history', readTaskHistory)
app.get('/api/adventure/growth', readGrowth)
app.get('/api/adventure/reward-source', readRewardSource)
app.get('/api/adventure/compatibility', c => c.json({ model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false }))
app.post('/api/adventure/legacy-retry', () => { throw oldClientUnavailable() })
app.post('/api/adventure/preview', previewPlanning)
app.post('/api/adventure/receipts/lookup', lookupPlanningReceipt)
app.post('/api/adventure/commands', commandPlanning)
app.get('/api/tasks/today', async c => c.json(await readTasks(c.env, c.req.query('timeZone'))))
app.get('/api/domains', async c => c.json(await readDomainCard(c.env)))
app.get('/api/ai-status', async c => c.json(await readAiStatus()))
app.get('/api/news/sources', c => c.json({ sources: newsSources }))
app.get('/api/news/source', async c => c.json(await readNews(c.env, c.req.query('id'))))
app.get('/api/weather/detail', async c => c.json(await readWeatherDetail(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/air-quality', async c => c.json(await readAirQuality(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/locations', async c => c.json(await searchLocations(c.req.query('q'))))
app.onError((error, c) => {
  traceErrorCode(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', c.req.path, c)
  if (error instanceof ApiError) {
    if (error instanceof McpAuthError) c.header('WWW-Authenticate', bearerChallenge(c.env, error))
    else if (c.req.path === '/api/agent/mcp' && [401, 403].includes(error.status)) c.header('WWW-Authenticate', bearerChallenge(c.env))
    if (error.status === 429) c.header('Retry-After', '60')
    return c.json(apiErrorBody(error), error.status)
  }
  console.error(JSON.stringify({ event: 'api_error', code: 'INTERNAL_ERROR' }))
  return c.json(apiErrorBody(error), 500)
})
app.notFound(c => {
  if (c.req.path.startsWith('/oauth/') || c.req.path.startsWith('/.well-known/')) return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404)
  if (!c.req.path.startsWith('/api/')) return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('页面不存在', 404)
  traceErrorCode('NOT_FOUND', c.req.path, c)
  return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404)
})
export default app
