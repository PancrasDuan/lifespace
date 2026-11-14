import type { AuthEnv } from './auth'
import { ApiError } from './upstream'
import { mcpScopes } from '../src/shared/mcp-oauth'

export { mcpScopes }
export type McpScope = typeof mcpScopes[number]
export type OAuthEnv = AuthEnv & {
  OAUTH_KV?: KVNamespace
  MCP_OAUTH_ISSUER?: string
  MCP_OAUTH_DCR_ENABLED?: string
  MCP_LEGACY_ENABLED?: string
  MCP_ALLOWED_ORIGINS?: string
}
export const oauthUnavailable = () => new ApiError('AUTH_UNAVAILABLE', '授权服务暂时不可用，请稍后重试', 503)
export function oauthConfig(env: OAuthEnv) {
  try {
    const url = new URL(env.MCP_OAUTH_ISSUER ?? '')
    if (url.origin !== env.MCP_OAUTH_ISSUER || url.username || url.password || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw oauthUnavailable()
    return { issuer: url.origin, resource: `${url.origin}/api/agent/mcp`, metadata: `${url.origin}/.well-known/oauth-protected-resource/api/agent/mcp` }
  } catch { throw oauthUnavailable() }
}

export class McpAuthError extends ApiError {
  constructor(public readonly challengeError?: 'invalid_token' | 'insufficient_scope', public readonly scopes: readonly string[] = []) {
    super(scopes.length ? 'AUTH_SCOPE_REQUIRED' : 'AUTH_INVALID', scopes.length ? '此操作需要额外授权' : 'MCP 凭据无效或已失效', scopes.length ? 403 : 401)
  }
}
export function bearerChallenge(env: OAuthEnv, error?: McpAuthError) {
  const { metadata } = oauthConfig(env)
  const parts = [`resource_metadata="${metadata}"`]
  if (error?.challengeError) parts.push(`error="${error.challengeError}"`)
  const scopes = error?.scopes.length ? error.scopes : error?.challengeError ? [] : [mcpScopes[0]]
  if (scopes.length) parts.push(`scope="${scopes.join(' ')}"`)
  return `Bearer ${parts.join(', ')}`
}

export function trustedOAuthOrigin(env: OAuthEnv, request: Request) {
  const { issuer } = oauthConfig(env)
  if (new URL(request.url).origin !== issuer) throw new ApiError('OAUTH_ORIGIN_DENIED', '授权入口地址不匹配', 400)
  const origin = request.headers.get('Origin')
  if (!origin) return
  const configured = env.MCP_ALLOWED_ORIGINS?.split(',').map(item => item.trim()).filter(Boolean) ?? []
  for (const value of configured) {
    try {
      const parsed = new URL(value)
      if (parsed.origin !== value || parsed.username || parsed.password ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw oauthUnavailable()
    } catch { throw oauthUnavailable() }
  }
  const allowed = [issuer, ...configured]
  if (!allowed.includes(origin) || origin === 'null') throw new ApiError('OAUTH_ORIGIN_DENIED', '此来源未获准访问', 403)
}
