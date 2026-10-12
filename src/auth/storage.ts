export class AuthSessionChangedError extends Error {
  constructor() { super('Auth session changed during logout') }
}

// Use the SDK's supported storage interface; preserve the existing storage key.
export function authStorage(storageKey: string, cleanupToken: () => string | undefined) {
  const memory = new Map<string, string>()
  let persistent = false
  try {
    const probe = `lifespace.auth.probe.${crypto.randomUUID()}`
    localStorage.setItem(probe, probe); localStorage.removeItem(probe); persistent = true
  } catch { /* Match SDK behavior when browser storage is unavailable. */ }
  const getItem = (key: string) => persistent ? localStorage.getItem(key) : memory.get(key) ?? null
  return {
    getItem,
    setItem(key: string, value: string) { if (persistent) localStorage.setItem(key, value); else memory.set(key, value) },
    removeItem(key: string) {
      const expected = cleanupToken()
      if (expected) {
        const current = getItem(storageKey)
        if (current && JSON.parse(current).access_token !== expected) throw new AuthSessionChangedError()
      }
      if (persistent) localStorage.removeItem(key); else memory.delete(key)
    },
  }
}
