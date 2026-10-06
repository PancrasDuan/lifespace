import { z } from 'zod'
import type { LocationsResult, WeatherResult } from '../src/shared/contracts'
import { ApiError, upstream } from './upstream'

const metric = z.number().finite().nullable()
const timeZoneSchema = z.string().refine(zone => {
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: zone }).format(); return !/^[+-]/.test(zone) }
  catch { return false }
})
const weatherSchema = z.object({
  timezone: timeZoneSchema, current: z.object({ temperature_2m: metric, weather_code: metric }),
  daily: z.object({ time: z.array(z.string()).min(1), temperature_2m_max: z.array(metric).min(1), temperature_2m_min: z.array(metric).min(1), precipitation_probability_max: z.array(metric).min(1) }),
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

export async function readWeather(latitude: string | undefined, longitude: string | undefined): Promise<WeatherResult> {
  const lat = latitude?.trim(); const lon = longitude?.trim()
  if (!lat || !lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) throw new ApiError('INVALID_COORDINATES', '请选择有效的天气城市', 400)
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(Number(lat))); url.searchParams.set('longitude', String(Number(lon)))
  url.searchParams.set('current', 'temperature_2m,weather_code')
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto'); url.searchParams.set('forecast_days', '1')
  const data = await upstream(url, weatherSchema)
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (data.daily.time[0] !== date) throw new ApiError('SOURCE_INVALID_RESPONSE', '数据源尚未提供当天天气，请稍后刷新', 502)
  return { date, timeZone: data.timezone, fetchedAt: new Date().toISOString(), temperature: data.current.temperature_2m, weatherCode: data.current.weather_code,
    temperatureMin: data.daily.temperature_2m_min[0], temperatureMax: data.daily.temperature_2m_max[0], precipitationProbability: data.daily.precipitation_probability_max[0] }
}
