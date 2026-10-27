import { z } from 'zod'
import type { LocationsResult } from '../src/shared/contracts'
import { ApiError, upstream } from './upstream'

const timeZoneSchema = z.string().refine(zone => {
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: zone }).format(); return !/^[+-]/.test(zone) }
  catch { return false }
})
const locationsSchema = z.object({ results: z.array(z.object({
  id: z.number().int().safe(), name: z.string(), admin1: z.string().optional(), country: z.string().optional(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: timeZoneSchema,
})).optional() })

export async function searchLocations(query: string | undefined): Promise<LocationsResult> {
  const name = query?.trim()
  if (!name || name.length < 2 || name.length > 80) throw new ApiError('INVALID_CITY_QUERY', '请输入 2 至 80 个字符的城市名称', 400)
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', name); url.searchParams.set('count', '10'); url.searchParams.set('language', 'zh'); url.searchParams.set('format', 'json')
  const data = await upstream(url, locationsSchema)
  return { locations: (data.results ?? []).map(city => ({ id: String(city.id), name: city.name, region: [city.admin1, city.country].filter(Boolean).join(' · '), latitude: city.latitude, longitude: city.longitude, timeZone: city.timezone })) }
}
