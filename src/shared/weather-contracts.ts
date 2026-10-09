import { z } from 'zod'
import { weatherResultSchema } from './contracts'

const metric = z.number().finite().nullable()
const timestamp = z.number().int().safe()
export const weatherDetailSchema = weatherResultSchema.and(z.object({
  currentTime: timestamp.nullable().default(null), isDay: metric.default(null),
  apparentTemperature: metric.default(null), humidity: metric.default(null), pressure: metric.default(null),
  precipitation: metric.default(null), windSpeed: metric.default(null), windDirection: metric.default(null),
  hourly: z.array(z.object({ time: timestamp, temperature: metric, weatherCode: metric, precipitationProbability: metric, isDay: metric })).default([]),
  daily: z.array(z.object({ date: z.iso.date(), weatherCode: metric, temperatureMin: metric, temperatureMax: metric,
    precipitationProbability: metric, precipitation: metric, sunrise: timestamp.nullable(), sunset: timestamp.nullable() })).default([]),
}))
export type WeatherDetailResult = z.infer<typeof weatherDetailSchema>
export const airQualitySchema = z.object({ timeZone: z.string(), fetchedAt: z.string().datetime(), time: timestamp,
  usAqi: metric, pm25: metric, pm10: metric })
export type AirQualityResult = z.infer<typeof airQualitySchema>
