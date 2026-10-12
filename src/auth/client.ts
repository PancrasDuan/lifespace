import { createClient, isAuthApiError, isAuthRefreshDiscardedError, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { publicAuthConfig } from './config'

let clientPromise: Promise<SupabaseClient> | undefined
const cleanupHandlers = new WeakMap<SupabaseClient, () => Promise<void>>()
let recoverySession: string | undefined
const recoveryKey = 'lifespace.auth.recovery'
export function authMarker(key: string): string | undefined {
  try { return sessionStorage.getItem(key) ?? undefined } catch { return undefined }
}
export function saveAuthMarker(key: string, value?: string) {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); return true } catch { return false }
}
export function sessionIdentifier(session: Session) {
  try {
    const parsed = z.object({ session_id: z.uuid() }).parse(JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))
    return parsed.session_id
  } catch { return undefined }
}
export const isRecoveryFlow = (sessionId?: string) => Boolean(sessionId && (recoverySession === sessionId || authMarker(recoveryKey) === sessionId))
export const resetPendingKey = 'lifespace.auth.resetPending'
export const temporarilyUnavailable = (error: unknown) => isAuthRetryableFetchError(error) || isAuthRefreshDiscardedError(error) || (isAuthApiError(error) && error.status >= 500)
export async function currentSession() {
  const client = await authClient()
  let result = await client.auth.getSession()
  if (isAuthRefreshDiscardedError(result.error)) result = await client.auth.getSession()
  return result
}
const configSchema = z.object({ url: z.url(), publishableKey: z.string().startsWith('sb_publishable_') })
export function authClient(): Promise<SupabaseClient> {
  if (!clientPromise) clientPromise = (async () => {
    const config = configSchema.parse(await publicAuthConfig())
    let cleanupOnly = false
    const client = createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce' },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        // 远端撤销已确认后，仅让 SDK 清理本地状态，不重复发送 logout。
        if (cleanupOnly && url.pathname.endsWith('/auth/v1/logout')) return new Response(null, { status: 204 })
        const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
        const response = await fetch(input, { ...init, signal })
        return response
      } },
    })
    client.auth.onAuthStateChange((event, session) => {
      const id = session ? sessionIdentifier(session) : undefined
      if (event === 'PASSWORD_RECOVERY') { recoverySession = id; saveAuthMarker(recoveryKey, id) }
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !isRecoveryFlow(id))) { recoverySession = undefined; saveAuthMarker(recoveryKey) }
    })
    cleanupHandlers.set(client, async () => {
      cleanupOnly = true
      try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error }
      finally { cleanupOnly = false }
    })
    return client
  })().catch(error => { clientPromise = undefined; throw error })
  return clientPromise
}

export async function revokeSession(scope: 'local' | 'global') {
  const client = await authClient()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) throw new Error('会话撤销未确认，请重新登录后重试')
  // 此 SDK 方法使用用户自己的 JWT 调用 logout，无需 service_role。
  // 避免普通 signOut 在失败时清掉本地会话，保留明确的重试能力。
  const result = await client.auth.admin.signOut(data.session.access_token, scope)
  if (result.error) throw new Error('会话撤销未确认，请重试')
  await cleanupHandlers.get(client)?.()
}
