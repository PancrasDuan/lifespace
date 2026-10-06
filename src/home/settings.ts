import { z } from 'zod'
import type { City } from '../shared/contracts'
import { validZone } from './time'

export type Settings = { city: City | null; overseas: string[] }
const storageKey = 'lifespace.settings.v1'
export const defaultSettings: Settings = { city: { id: '1796236', name: '上海', region: '上海市 · 中国', latitude: 31.2304, longitude: 121.4737, timeZone: 'Asia/Shanghai' }, overseas: ['America/New_York', 'Europe/London'] }
const schema = z.object({
  city: z.object({ id: z.string(), name: z.string(), region: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timeZone: z.string().refine(validZone) }).nullable(),
  overseas: z.array(z.string().refine(validZone)).max(32),
})
export function loadSettings(): Settings {
  try { const stored = localStorage.getItem(storageKey); if (stored) return schema.parse(JSON.parse(stored)) }
  catch { /* 浏览器禁止存储或配置损坏时，使用默认设置。 */ }
  return defaultSettings
}
export function persistSettings(settings: Settings): void { localStorage.setItem(storageKey, JSON.stringify(settings)) }
