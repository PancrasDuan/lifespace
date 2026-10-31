export class AuthSessionChangedError extends Error {
  constructor() { super('Auth session changed during logout') }
}

const observedSessionKeys = new Set<string>()

// Use the SDK's supported storage interface; preserve the existing storage key.
export function authStorage(storageKey: string, cleanupToken: () => string | undefined) {
  const memory = new Map<string, string>()
  let persistent: Storage | undefined
  try {
    const storage = localStorage
    const probe = `lifespace.auth.probe.${crypto.randomUUID()}`
    storage.setItem(probe, probe); storage.removeItem(probe); persistent = storage
  } catch { /* Match SDK behavior when browser storage is unavailable. */ }
  // authClient retains one SDK client for the window lifetime. Observe each key
  // once even if construction is retried; denied storage keeps the memory path.
  if (persistent && !observedSessionKeys.has(storageKey)) {
    observedSessionKeys.add(storageKey)
    window.addEventListener('storage', event => {
      if (event.storageArea === persistent && event.key === storageKey)
        window.dispatchEvent(new Event('lifespace-auth-session-changed'))
    })
  }
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
