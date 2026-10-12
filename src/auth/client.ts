import { createClient, isAuthApiError, isAuthRefreshDiscardedError, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { publicAuthConfig } from './config'
import { authStorage, AuthSessionChangedError } from './storage'

let clientPromise: Promise<SupabaseClient> | undefined
const confirmedRevocations = new WeakMap<SupabaseClient, { token: string; scope: 'local' | 'global' }>()
const cleanupHandlers = new WeakMap<SupabaseClient, (token: string) => Promise<void>>()
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
    let cleanupToken: string | undefined
    const storageKey = `sb-${new URL(config.url).hostname.split('.')[0]}-auth-token`
    const client = createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce', storageKey, storage: authStorage(storageKey, () => cleanupToken) },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        // 远端撤销已确认后，仅让 SDK 清理本地状态，不重复发送 logout。
        if (cleanupToken && url.pathname.endsWith('/auth/v1/logout')) {
          if (new Headers(init?.headers).get('Authorization') !== `Bearer ${cleanupToken}`) throw new AuthSessionChangedError()
          return new Response(null, { status: 204 })
        }
        const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
        const response = await fetch(input, { ...init, signal })
        return response
      } },
    })
    client.auth.onAuthStateChange((event, session) => {
      const id = session ? sessionIdentifier(session) : undefined
      const confirmed = confirmedRevocations.get(client)
      if (session && confirmed && confirmed.token !== session.access_token) confirmedRevocations.delete(client)
      if (event === 'PASSWORD_RECOVERY') { recoverySession = id; saveAuthMarker(recoveryKey, id) }
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !isRecoveryFlow(id))) { recoverySession = undefined; saveAuthMarker(recoveryKey) }
    })
    cleanupHandlers.set(client, async token => {
      cleanupToken = token
      try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error }
      finally { cleanupToken = undefined }
    })
    return client
  })().catch(error => { clientPromise = undefined; throw error })
  return clientPromise
}

export class LogoutFailure extends Error {
  constructor(readonly phase: 'session' | 'remote' | 'cleanup' | 'changed', cause: unknown) {
    super(phase === 'changed' ? '登录会话已变化，请重新操作' : phase === 'cleanup' ? '服务端已退出，但浏览器清理失败，请重试' : phase === 'session' ? '本地会话不可用，请刷新后重试' : '退出请求未获确认，请重试')
    const names = new Set(['SecurityError', 'QuotaExceededError', 'TimeoutError', 'TypeError', 'AuthApiError', 'AuthRetryableFetchError', 'AuthSessionMissingError'])
    const name = cause instanceof Error || cause instanceof DOMException ? cause.name : undefined
    // Log only a bounded failure classification, never raw errors, headers or tokens.
    console.warn(JSON.stringify({ event: 'auth_logout_failed', phase,
      kind: name && names.has(name) ? name : 'unknown',
      status: isAuthApiError(cause) || isAuthRetryableFetchError(cause) ? cause.status : undefined,
    }))
  }
}

export async function revokeSession(scope: 'local' | 'global') {
  const client = await authClient()
  let session: Session | null
  try {
    const result = await client.auth.getSession()
    if (result.error) throw result.error
    session = result.data.session
  } catch (error) { throw new LogoutFailure(confirmedRevocations.has(client) ? 'cleanup' : 'session', error) }
  const confirmed = confirmedRevocations.get(client)
  const cleanupPending = confirmed && (!session || confirmed.token === session.access_token)
  if (!cleanupPending) {
    if (!session) throw new LogoutFailure('session', new Error('No current session'))
    try {
      // Use the user's JWT. Do not clear local state before remote revocation is confirmed.
      const result = await client.auth.admin.signOut(session.access_token, scope)
      if (result.error) throw result.error
      confirmedRevocations.set(client, { token: session.access_token, scope })
    } catch (error) { throw new LogoutFailure('remote', error) }
  } else if (confirmed.scope !== scope && confirmed.scope !== 'global') {
    // A confirmed local sign-out does not prove all other sessions were revoked.
    throw new LogoutFailure('remote', new Error('Revocation scope differs'))
  }
  try {
    const pending = confirmedRevocations.get(client)
    if (!pending) throw new AuthSessionChangedError()
    await cleanupHandlers.get(client)?.(pending.token)
    confirmedRevocations.delete(client)
  } catch (error) {
    if (error instanceof AuthSessionChangedError) { confirmedRevocations.delete(client); throw new LogoutFailure('changed', error) }
    throw new LogoutFailure('cleanup', error)
  }
}
