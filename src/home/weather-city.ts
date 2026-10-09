import { z } from 'zod'
import type { City } from '../shared/contracts'
import { beijing } from './settings'
import { validZone } from './time'
const key = 'lifespace.weather-settings.v1'
const oldKey = 'lifespace.weather-city.v1'
const citySchema = z.object({ id: z.string(), name: z.string(), region: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timeZone: z.string().refine(validZone) })
const settingsSchema = z.discriminatedUnion('mode', [z.object({ mode: z.literal('auto'), city: z.null() }), z.object({ mode: z.literal('manual'), city: citySchema })])
export type WeatherSettings = z.infer<typeof settingsSchema>
export function loadWeatherSettings(): WeatherSettings {
  try {
    const stored = localStorage.getItem(key)
    if (stored) { const result = settingsSchema.safeParse(JSON.parse(stored)); if (result.success) return result.data }
    const old = localStorage.getItem(oldKey)
    if (old) { const result = citySchema.safeParse(JSON.parse(old)); if (result.success) return { mode: 'manual', city: result.data } }
  } catch { /* 配置损坏或存储受限时使用北京，不读取首页地区设置。 */ }
  return { mode: 'manual', city: beijing }
}
export function saveWeatherSettings(city: City | null): WeatherSettings {
  const settings = settingsSchema.parse(city ? { mode: 'manual', city } : { mode: 'auto', city: null })
  localStorage.setItem(key, JSON.stringify(settings))
  try { localStorage.removeItem(oldKey) } catch { /* 新配置已保存，旧手动城市不再读取。 */ }
  return settings
}
