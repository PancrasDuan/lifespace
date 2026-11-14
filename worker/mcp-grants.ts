import { z } from 'zod'
import { publicConfig } from './auth'
import { readBoundedBody } from './read-body'
import { mcpScopes, oauthUnavailable, type OAuthEnv } from './mcp-oauth-config'

const grantSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), clientId: z.string().min(1), clientName: z.string(), resource: z.string(),
  scopes: z.array(z.enum(mcpScopes)), createdAt: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(),
  providerGrantId: z.string().nullable(),
})
export type McpGrant = z.infer<typeof grantSchema>

async function rpc<T>(env: OAuthEnv, name: string, params: object, schema: z.ZodType<T>): Promise<T> {
  if (!env.SUPABASE_SECRET_KEY) throw oauthUnavailable()
  const base = publicConfig(env).url
  const headers = new Headers({ apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' })
  if (env.SUPABASE_SECRET_KEY.startsWith('eyJ')) headers.set('Authorization', `Bearer ${env.SUPABASE_SECRET_KEY}`)
  try {
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(params), redirect: 'manual', signal: AbortSignal.timeout(5000),
    })
    if (!response.ok || !response.body) throw oauthUnavailable()
    return schema.parse(JSON.parse(await readBoundedBody(response.body, 524288, 5000)))
  } catch { throw oauthUnavailable() }
}
export function createMcpGrant(env: OAuthEnv, grant: Pick<McpGrant, 'id' | 'ownerId' | 'clientId' | 'clientName' | 'resource' | 'scopes'>, consentHash: string) {
  return rpc(env, 'agent_oauth_grant_create', { p_id: grant.id, p_owner: grant.ownerId, p_client: grant.clientId, p_name: grant.clientName, p_resource: grant.resource, p_scopes: grant.scopes, p_consent_hash: consentHash }, grantSchema)
}
export function checkMcpGrant(env: OAuthEnv, id: string, ownerId: string, clientId: string, resource: string, providerGrantId?: string, exchangeCode = false) {
  return rpc(env, 'agent_oauth_grant_check', { p_id: id, p_owner: ownerId, p_client: clientId, p_resource: resource, p_provider_grant: providerGrantId ?? null, p_exchange_code: exchangeCode }, grantSchema.nullable())
}
export function listMcpGrants(env: OAuthEnv, ownerId: string, before?: string, beforeId?: string) {
  return rpc(env, 'agent_oauth_grants_list', { p_owner: ownerId, p_before: before ?? null, p_before_id: beforeId ?? null }, z.array(grantSchema).max(21))
}
export function revokeMcpGrant(env: OAuthEnv, id: string, ownerId: string) {
  return rpc(env, 'agent_oauth_grant_revoke', { p_id: id, p_owner: ownerId }, grantSchema.nullable())
}
