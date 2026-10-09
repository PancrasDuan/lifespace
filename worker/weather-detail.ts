import { z } from 'zod'
import type { AirQualityResult, WeatherDetailResult } from '../src/shared/weather-contracts'
import { ApiError, upstream } from './upstream'

const metric = z.number().finite().nullable()
const stamp = z.number().int().safe()
const stamps = z.array(stamp)
const metrics = z.array(metric)
const forecastSchema = z.object({ timezone: z.string(), current: z.object({ time: stamp, temperature_2m: metric, weather_code: metric,
  apparent_temperature: metric, relative_humidity_2m: metric, pressure_msl: metric, precipitation: metric, wind_speed_10m: metric, wind_direction_10m: metric, is_day: metric }),
  hourly: z.object({ time: stamps, temperature_2m: metrics, weather_code: metrics, precipitation_probability: metrics, is_day: metrics }),
  daily: z.object({ time: stamps.min(1), temperature_2m_max: metrics, temperature_2m_min: metrics, precipitation_probability_max: metrics,
    weather_code: metrics, sunrise: z.array(stamp.nullable()), sunset: z.array(stamp.nullable()), precipitation_sum: metrics }),
}).superRefine((data, ctx) => {
  for (const group of [data.hourly, data.daily]) {
    if (Object.values(group).some(values => values.length !== group.time.length)) ctx.addIssue({ code: 'custom', message: '预报字段长度不一致' })
    if (group.time.some((time, index) => index > 0 && time <= group.time[index - 1])) ctx.addIssue({ code: 'custom', message: '预报时间顺序错误' })
  }
})
function coordinates(latitude?: string, longitude?: string, timeZone?: string) {
  const lat = latitude?.trim(); const lon = longitude?.trim()
  if (!lat || !lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) throw new ApiError('INVALID_COORDINATES', '请选择有效的天气城市', 400)
  try { if (!timeZone || /^[+-]/.test(timeZone)) throw new Error(); new Intl.DateTimeFormat('zh-CN', { timeZone }).format() }
  catch { throw new ApiError('INVALID_TIME_ZONE', '请选择有效的地区时区', 400) }
  return { latitude: String(Number(lat)), longitude: String(Number(lon)), timezone: timeZone!, timeformat: 'unixtime' }
}
const localDate = (time: number, timeZone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time * 1000))
export async function readWeatherDetail(latitude?: string, longitude?: string, timeZone?: string): Promise<WeatherDetailResult> {
  const params = coordinates(latitude, longitude, timeZone)
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({ ...params, current: 'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,pressure_msl,precipitation,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,precipitation_sum', forecast_days: '7', wind_speed_unit: 'ms' }).toString()
  const data = await upstream(url, forecastSchema)
  const now = Date.now(); const date = localDate(now / 1000, params.timezone)
  if (data.timezone !== params.timezone || localDate(data.daily.time[0], params.timezone) !== date || localDate(data.current.time, params.timezone) !== date) throw new ApiError('SOURCE_INVALID_RESPONSE', '天气来源日期或时区与所选城市不一致', 502)
  const current = data.current
  const daily = data.daily.time.map((time, index) => ({ date: localDate(time, params.timezone), weatherCode: data.daily.weather_code[index],
    temperatureMin: data.daily.temperature_2m_min[index], temperatureMax: data.daily.temperature_2m_max[index], precipitationProbability: data.daily.precipitation_probability_max[index],
    precipitation: data.daily.precipitation_sum[index], sunrise: data.daily.sunrise[index], sunset: data.daily.sunset[index] }))
  const hourly = data.hourly.time.flatMap((time, index) => time + 3600 > now / 1000 ? [{ time, temperature: data.hourly.temperature_2m[index], weatherCode: data.hourly.weather_code[index], precipitationProbability: data.hourly.precipitation_probability[index], isDay: data.hourly.is_day[index] }] : []).slice(0, 24)
  return { date, timeZone: params.timezone, fetchedAt: new Date(now).toISOString(), temperature: current.temperature_2m, weatherCode: current.weather_code,
    temperatureMin: daily[0].temperatureMin, temperatureMax: daily[0].temperatureMax, precipitationProbability: daily[0].precipitationProbability,
    currentTime: current.time, isDay: current.is_day, apparentTemperature: current.apparent_temperature, humidity: current.relative_humidity_2m, pressure: current.pressure_msl,
    precipitation: current.precipitation, windSpeed: current.wind_speed_10m, windDirection: current.wind_direction_10m, hourly, daily }
}
export async function readAirQuality(latitude?: string, longitude?: string, timeZone?: string): Promise<AirQualityResult> {
  const params = coordinates(latitude, longitude, timeZone)
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
  url.search = new URLSearchParams({ ...params, current: 'us_aqi,pm2_5,pm10' }).toString()
  const data = await upstream(url, z.object({ timezone: z.string(), current: z.object({ time: stamp, us_aqi: metric, pm2_5: metric, pm10: metric }) }))
  if (data.timezone !== params.timezone || Math.abs(Date.now() / 1000 - data.current.time) > 7200) throw new ApiError('SOURCE_INVALID_RESPONSE', '空气质量来源时间或时区无效', 502)
  return { timeZone: params.timezone, fetchedAt: new Date().toISOString(), time: data.current.time, usAqi: data.current.us_aqi, pm25: data.current.pm2_5, pm10: data.current.pm10 }
}
