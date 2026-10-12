// Only the public project URL and publishable key are fetched here.
// This module stays small so bootstrap can start the request before the app downloads.
let pending: Promise<unknown> | undefined

export function publicAuthConfig(): Promise<unknown> {
  if (!pending) pending = (async () => {
    const response = await fetch('/api/auth/config', { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('认证服务暂时不可用，请稍后重试')
    return response.json()
  })().catch(error => { pending = undefined; throw error })
  return pending
}
