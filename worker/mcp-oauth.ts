import { AuthorizationError, CimdFetchError, OAuthAuthorizationServer, OAuthError } from '@cloudflare/workers-oauth-provider'
import { z } from 'zod'
import type { Context } from 'hono'
import { verifyAgentUser } from './agent-auth'
import type { Identity } from './auth'
import { checkMcpGrant, createMcpGrant, listMcpGrants, revokeMcpGrant } from './mcp-grants'
import { McpAuthError, mcpScopes, oauthConfig, oauthUnavailable, trustedOAuthOrigin, type OAuthEnv } from './mcp-oauth-config'
import { readBoundedBody } from './read-body'
import { ApiError } from './upstream'

const propsSchema = z.object({ authorizationId: z.uuid(), ownerId: z.uuid(), clientId: z.string().min(1), issuer: z.string(), resource: z.string() })
type OAuthContext = Context<{ Bindings: OAuthEnv; Variables: { identity: Identity } }>

export function authorizationServer(env: OAuthEnv, requestedScopes?: string[]) {
  const { issuer, resource } = oauthConfig(env)
  return new OAuthAuthorizationServer<OAuthEnv>({
    issuer, resources: [resource], authorizeEndpoint: `${issuer}/oauth/authorize`, tokenEndpoint: `${issuer}/oauth/token`,
    clientRegistrationEndpoint: env.MCP_OAUTH_DCR_ENABLED === 'true' ? `${issuer}/oauth/register` : undefined,
    clientIdMetadataDocumentEnabled: true, scopesSupported: [...mcpScopes], accessTokenTTL: 900, refreshTokenTTL: 2592000,
    allowTokenExchangeGrant: false,
    // No token, client metadata, user email, or provider error description in logs.
    onError: () => undefined,
    tokenExchangeCallback: async options => {
      // 1.2.4 intersects requested scopes silently. Reject an attempted increase
      // explicitly before the callback claims a code or rotates a refresh token.
      if (requestedScopes?.some(scope => !options.scope.includes(scope))) throw new OAuthError('invalid_scope', { description: 'Requested scope exceeds the authorization grant' })
      const props = propsSchema.safeParse(options.props)
      if (!props.success || props.data.ownerId !== options.userId || props.data.clientId !== options.clientId ||
        props.data.issuer !== issuer || props.data.resource !== resource || options.resource !== resource) throw new OAuthError('invalid_grant', { description: 'Authorization is invalid or revoked' })
      try {
        await verifyAgentUser(options.env, options.userId)
        const grant = await checkMcpGrant(options.env, props.data.authorizationId, options.userId, options.clientId, resource,
          options.grantId, options.grantType === 'authorization_code')
        if (!grant || options.requestedScope.some(scope => !grant.scopes.includes(scope as typeof mcpScopes[number]))) throw new OAuthError('invalid_grant', { description: 'Authorization is invalid or revoked' })
      } catch (error) {
        if (error instanceof OAuthError) throw error
        if (error instanceof ApiError && error.status !== 503) throw new OAuthError('invalid_grant', { description: 'Authorization is invalid or revoked' })
        throw new OAuthError('temporarily_unavailable', { description: 'Authorization service unavailable', statusCode: 503 })
      }
    },
  })
}

export async function serveOAuthProtocol(c: OAuthContext) {
  let scopes: string[] | undefined
  if (c.req.path === '/oauth/token' && c.req.method === 'POST') {
    try {
      const clone = c.req.raw.clone()
      if (!clone.body) throw new Error()
      const text = await readBoundedBody(clone.body, 16384, 5000)
      const contentType = clone.headers.get('Content-Type') ?? ''
      const scope = contentType.startsWith('application/json') ? JSON.parse(text).scope : new URLSearchParams(text).get('scope')
      if (typeof scope === 'string') scopes = scope.split(' ').filter(Boolean)
      else if (Array.isArray(scope) && scope.every(item => typeof item === 'string')) scopes = scope
    } catch { return c.json({ error: 'invalid_request', error_description: 'Invalid or oversized token request' }, 400) }
  }
  return authorizationServer(c.env, scopes).fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext)
}

export async function verifyMcpIdentity(env: OAuthEnv, authorization?: string) {
  if (!authorization) throw new McpAuthError()
  const match = /^Bearer ([A-Za-z0-9:_-]+)$/.exec(authorization)
  if (!match || match[1].length > 16384) throw new McpAuthError('invalid_token')
  const { issuer, resource } = oauthConfig(env)
  if (!env.OAUTH_KV) throw oauthUnavailable()
  let token: Awaited<ReturnType<ReturnType<typeof authorizationServer>['validateToken']>>
  try { token = await authorizationServer(env).validateToken(resource, match[1], env) }
  catch { throw oauthUnavailable() }
  const props = propsSchema.safeParse(token?.props)
  if (!token || !props.success || props.data.issuer !== issuer || props.data.resource !== resource ||
    props.data.ownerId !== token.userId || props.data.clientId !== token.clientId || !token.expiresAt || token.expiresAt <= Date.now() / 1000) throw new McpAuthError('invalid_token')
  const grant = await checkMcpGrant(env, props.data.authorizationId, props.data.ownerId, props.data.clientId, resource)
  if (!grant || !grant.providerGrantId) throw new McpAuthError('invalid_token')
  let identity: Identity
  try { identity = await verifyAgentUser(env, grant.ownerId) }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) throw new McpAuthError('invalid_token')
    throw error
  }
  if (token.expiresAt <= Date.now() / 1000) throw new McpAuthError('invalid_token')
  return { identity, scopes: token.scope.filter(scope => grant.scopes.includes(scope as typeof mcpScopes[number])) }
}


export async function oauthJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') ?? '') || !request.body) throw new ApiError('INVALID_REQUEST', '请求格式无效', 400)
  try { return schema.parse(JSON.parse(await readBoundedBody(request.body, 16384, 5000))) }
  catch { throw new ApiError('INVALID_REQUEST', '请求格式无效', 400) }
}

export async function beginMcpConsent(c: OAuthContext) {
  trustedOAuthOrigin(c.env, c.req.raw)
  const { query } = await oauthJson(c.req.raw, z.object({ query: z.string().max(12000) }).strict())
  if (!c.env.OAUTH_KV) throw oauthUnavailable()
  const oauth = authorizationServer(c.env).getOAuthApi(c.env)
  try {
    const url = new URL('/oauth/authorize', oauthConfig(c.env).issuer)
    url.search = query
    const request = await oauth.parseAuthRequest(new Request(url))
    if (request.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge ?? '')) throw new AuthorizationError('invalid_request', { description: '必须使用 PKCE S256' })
    if (request.scope.some(scope => !mcpScopes.includes(scope as typeof mcpScopes[number]))) throw new AuthorizationError('invalid_scope', { description: 'Unsupported scope' })
    if (!request.scope.length) request.scope = [mcpScopes[0]]
    const details = await oauth.describeConsent(request)
    const consent = await oauth.beginConsent(request)
    await c.env.OAUTH_KV.put(`lifespace-consent-owner:${consent.handle}`, c.get('identity').id, { expirationTtl: 600 })
    consent.headers.forEach((value, key) => c.header(key, value))
    return c.json({ handle: consent.handle, details })
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) return c.json({ error: { code: 'OAUTH_REQUEST_INVALID', message: '授权请求无效或客户端信息暂时不可用，请从客户端重新连接' } }, 400)
    throw oauthUnavailable()
  }
}

export async function finishMcpConsent(c: OAuthContext) {
  trustedOAuthOrigin(c.env, c.req.raw)
  const input = await oauthJson(c.req.raw, z.object({ handle: z.string().min(1).max(256), decision: z.enum(['approve', 'deny']), scopes: z.array(z.enum(mcpScopes)).max(3) }).strict())
  if (!c.env.OAUTH_KV) throw oauthUnavailable()
  const ownerId = c.get('identity').id
  if (await c.env.OAUTH_KV.get(`lifespace-consent-owner:${input.handle}`) !== ownerId) throw new ApiError('OAUTH_CONSENT_INVALID', '授权页面已失效，请从客户端重新连接', 400)
  const oauth = authorizationServer(c.env).getOAuthApi(c.env)
  try {
    if (input.decision === 'deny') {
      const denied = await oauth.denyConsent(c.req.raw, input.handle)
      denied.headers.forEach((value, key) => { if (key !== 'location') c.header(key, value) })
      return c.json({ redirectTo: denied.headers.get('Location') })
    }
    if (!input.scopes.length) throw new ApiError('OAUTH_SCOPE_REQUIRED', '请至少选择一项权限', 400)
    const approved = await oauth.approveConsent(c.req.raw, input.handle, { scope: [...new Set(input.scopes)] })
    const request = approved.request
    const details = await oauth.describeConsent(request)
    const { issuer, resource } = oauthConfig(c.env)
    const authorizationId = crypto.randomUUID()
    const consentHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.handle)))].map(value => value.toString(16).padStart(2, '0')).join('')
    await createMcpGrant(c.env, { id: authorizationId, ownerId, clientId: request.clientId, clientName: Array.from(details.clientName).slice(0, 200).join(''), resource, scopes: [...new Set(input.scopes)] }, consentHash)
    const { redirectTo } = await oauth.completeAuthorization({
      request, userId: ownerId, scope: request.scope, metadata: { authorizationId },
      props: { authorizationId, ownerId, clientId: request.clientId, issuer, resource },
      // Separate installations and re-authorizations stay individually revocable.
      revokeExistingGrants: false,
    })
    approved.headers.forEach((value, key) => c.header(key, value))
    return c.json({ redirectTo })
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) throw new ApiError('OAUTH_CONSENT_INVALID', '授权页面已失效，请从客户端重新连接', 400)
    throw oauthUnavailable()
  }
}

export async function readMcpGrants(c: OAuthContext) {
  const query = z.object({ before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict().safeParse(c.req.query())
  if (!query.success || Boolean(query.data.before) !== Boolean(query.data.beforeId)) throw new ApiError('INVALID_QUERY', '分页参数无效', 400)
  const results = await listMcpGrants(c.env, c.get('identity').id, query.data.before, query.data.beforeId)
  const grants = results.slice(0, 20)
  const last = grants.at(-1)
  return c.json({ grants, nextCursor: results.length > 20 && last ? { before: last.createdAt, beforeId: last.id } : null })
}
export async function revokeMcpConsent(c: OAuthContext) {
  trustedOAuthOrigin(c.env, c.req.raw)
  const { id } = await oauthJson(c.req.raw, z.object({ id: z.uuid() }).strict())
  const grant = await revokeMcpGrant(c.env, id, c.get('identity').id)
  if (!grant) throw new ApiError('NOT_FOUND', '授权不存在', 404)
  // Commit the authoritative denial before attempting eventually-consistent cleanup.
  // Cleanup failure cannot undo the revocation or make the UI claim it failed.
  if (grant.providerGrantId && c.env.OAUTH_KV) {
    try { await authorizationServer(c.env).getOAuthApi(c.env).revokeGrant(grant.providerGrantId, grant.ownerId) }
    catch { /* Library KV TTLs clean up the already unusable credentials. */ }
  }
  return c.json({ revoked: true })
}
