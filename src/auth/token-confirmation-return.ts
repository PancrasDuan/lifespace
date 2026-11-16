const key = 'lifespace.token.confirmation'
const validCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z2-9]{8}$/.test(value)

function pendingCode(): string | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (value && typeof value === 'object' && 'code' in value && 'expiresAt' in value
      && validCode(value.code) && typeof value.expiresAt === 'number' && value.expiresAt > Date.now()) return value.code
  } catch { /* Storage can be unavailable; the original URL still accepts manual entry. */ }
}
export function rememberTokenConfirmation(code?: string) {
  const value = code ?? (location.pathname === '/token/devices/confirm' ? new URLSearchParams(location.search).get('code') : undefined)
  if (!validCode(value)) return
  try { sessionStorage.setItem(key, JSON.stringify({ code: value, expiresAt: Date.now() + 600_000 })) } catch { /* Best effort, never an auth prerequisite. */ }
}
export function clearTokenConfirmation() {
  try { sessionStorage.removeItem(key) } catch { /* No credential or arbitrary URL is stored. */ }
}
export function authCallbackUrl() {
  const url = new URL('/auth/callback', location.origin)
  const code = pendingCode()
  if (code) url.searchParams.set('deviceCode', code)
  return url.href
}
export function takeTokenConfirmationReturn() {
  const query = new URLSearchParams(location.search).get('deviceCode')
  const code = validCode(query) ? query : pendingCode()
  clearTokenConfirmation()
  return code ? `/token/devices/confirm?${new URLSearchParams({ code })}` : '/'
}
