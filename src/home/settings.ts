import { z } from 'zod'
import type { City } from '../shared/contracts'
import { validZone } from './time'

export type Settings = { mode: 'auto' | 'manual'; city: City | null; overseas: string[] }
const storageKey = 'lifespace.settings.v2'
export const beijing: City = { id: 'beijing', name: '北京', region: '北京市 · 中国', latitude: 39.9, longitude: 116.4, timeZone: 'Asia/Shanghai' }
export const defaultSettings: Settings = { mode: 'auto', city: null, overseas: ['America/New_York', 'Europe/London'] }
const schema = z.object({
  mode: z.enum(['auto', 'manual']),
  city: z.object({ id: z.string(), name: z.string(), region: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timeZone: z.string().refine(validZone) }).nullable(),
  overseas: z.array(z.string().refine(validZone)).max(32),
}).refine(value => value.mode === 'auto' || value.city !== null)
export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      try { const decoded = schema.safeParse(JSON.parse(stored)); if (decoded.success) return decoded.data }
      catch { /* 损坏配置重置为新版默认设置。 */ }
    }
    persistSettings(defaultSettings)
    localStorage.removeItem('lifespace.settings.v1')
  } catch { /* 存储不可用时，当前页面仍可使用默认地区。 */ }
  return defaultSettings
}
export function persistSettings(settings: Settings): void {
  const value = schema.parse(settings)
  localStorage.setItem(storageKey, JSON.stringify({ ...value, city: value.mode === 'manual' ? value.city : null }))
}
