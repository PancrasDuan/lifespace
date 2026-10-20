import type { NewsSource } from '../shared/news-sources'

export const sourceOrderKey = 'lifespace.news-order.v1'

export function loadSourceOrder(): string[] | null {
  try {
    const stored = localStorage.getItem(sourceOrderKey)
    if (stored === null) return null
    const decoded: unknown = JSON.parse(stored)
    return Array.isArray(decoded) && decoded.every(id => typeof id === 'string') ? [...new Set(decoded)] : null
  } catch { return null }
}

export function saveSourceOrder(ids: readonly string[]): boolean {
  try { localStorage.setItem(sourceOrderKey, JSON.stringify(ids)); return true }
  catch { return false }
}

export function resolveSourceOrder(sources: readonly NewsSource[], saved: readonly string[] | null): string[] {
  const defaults = sources.slice().sort((a, b) => a.order - b.order).map(source => source.id)
  const known = new Set(defaults)
  return [...new Set([...(saved ?? []).filter(id => known.has(id)), ...defaults])]
}

// 只移动可见卡片，隐藏来源继续占据其原有的顺序位置。
export function mergeVisibleOrder(order: readonly string[], visible: readonly string[]): string[] {
  const moving = new Set(visible)
  let index = 0
  return order.map(id => moving.has(id) ? visible[index++] : id)
}
