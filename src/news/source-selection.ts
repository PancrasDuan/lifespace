const storageKey = 'lifespace.news-sources.v1'

export function loadSourceSelection(): string[] | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === null) return null
    const decoded: unknown = JSON.parse(stored)
    return Array.isArray(decoded) && decoded.every(id => typeof id === 'string') ? [...new Set(decoded)] : null
  } catch { return null }
}

export function saveSourceSelection(ids: readonly string[]): boolean {
  try { localStorage.setItem(storageKey, JSON.stringify(ids)); return true }
  catch { return false }
}
