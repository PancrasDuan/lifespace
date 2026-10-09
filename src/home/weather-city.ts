import { z } from 'zod'
import type { City } from '../shared/contracts'
import { beijing } from './settings'
import { validZone } from './time'
const key = 'lifespace.weather-city.v1'
const citySchema = z.object({ id: z.string(), name: z.string(), region: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timeZone: z.string().refine(validZone) })
export function loadWeatherCity(): City {
  try {
    const stored = localStorage.getItem(key)
    if (stored) { const result = citySchema.safeParse(JSON.parse(stored)); if (result.success) return result.data }
  } catch { /* 配置损坏或存储受限时使用北京，不读取首页地区设置。 */ }
  return beijing
}
export function saveWeatherCity(city: City) { localStorage.setItem(key, JSON.stringify(citySchema.parse(city))) }
