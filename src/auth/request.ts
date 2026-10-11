import { authClient, currentSession, temporarilyUnavailable } from './client'
import { z } from 'zod'
const failureSchema = z.object({ error: z.object({ code: z.string() }) })
const failureCode = async (response: Response) => {
  const parsed = failureSchema.safeParse(await response.clone().json().catch(() => null))
  return parsed.success ? parsed.data.error.code : undefined
}
const unavailable = () => {
  window.dispatchEvent(new CustomEvent('lifespace-auth-rejected', { detail: 503 }))
  return Response.json({ error: { code: 'AUTH_UNAVAILABLE', message: '认证服务暂时不可用，请稍后重试' } }, { status: 503 })
}

// 业务读取在这里取最新 SDK 会话。只对明确过期的 GET 重试一次。
export async function authorizedFetch(path: string, signal: AbortSignal): Promise<Response> {
  const client = await authClient()
  const { data, error } = await currentSession()
  signal.throwIfAborted()
  if (temporarilyUnavailable(error)) return unavailable()
  if (error || !data.session) {
    window.dispatchEvent(new CustomEvent('lifespace-auth-rejected', { detail: 401 }))
    return Response.json({ error: { code: 'AUTH_REQUIRED', message: '请先登录' } }, { status: 401 })
  }
  const send = (token: string) => fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal })
  let response = await send(data.session.access_token)
  if (response.status === 401) {
    if (await failureCode(response) === 'AUTH_EXPIRED') {
      const latest = await currentSession()
      const refreshed = latest.data.session?.access_token !== data.session.access_token && latest.data.session ? latest : await client.auth.refreshSession()
      // 迟到的刷新结果可能被 SDK 丢弃，重新读取已经提交的共享会话。
      const current = refreshed.data.session ? refreshed : await currentSession()
      signal.throwIfAborted()
      if (temporarilyUnavailable(current.error) || (temporarilyUnavailable(refreshed.error) && !current.data.session)) return unavailable()
      if (!current.error && current.data.session && !signal.aborted) response = await send(current.data.session.access_token)
    }
  }
  if ([401, 403, 503].includes(response.status)) {
    signal.throwIfAborted()
    if ((await failureCode(response))?.startsWith('AUTH_')) window.dispatchEvent(new CustomEvent('lifespace-auth-rejected', { detail: response.status }))
  }
  return response
}
