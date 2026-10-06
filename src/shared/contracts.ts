export type City = { id: string; name: string; region: string; latitude: number; longitude: number; timeZone: string }
export type Task = { id: string; title: string; area: string; plannedAt: number; dueAt: number | null }
export type TasksResult = { date: string; timeZone: string; fetchedAt: string; tasks: Task[] }
export type WeatherResult = {
  date: string; timeZone: string; fetchedAt: string;
  temperature: number | null; weatherCode: number | null;
  temperatureMin: number | null; temperatureMax: number | null; precipitationProbability: number | null;
}
export type LocationsResult = { locations: City[] }
export type DomainInfo = { name: string; status: 'registered' | 'active' | 'suspended' | 'expired' | 'unknown'; expiresOn: string | null; neverExpires: boolean }
export type DomainsResult = { fetchedAt: string; domains: DomainInfo[] }

export const domainsResultSchema: z.ZodType<DomainsResult> = z.object({
  fetchedAt: z.string().datetime(), domains: z.array(z.object({
    name: z.string(), status: z.enum(['registered', 'active', 'suspended', 'expired', 'unknown']),
    expiresOn: z.iso.date().nullable(), neverExpires: z.boolean(),
  })),
})

const citySchema = z.object({ id: z.string(), name: z.string(), region: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timeZone: z.string() })
const metric = z.number().finite().nullable()
const metadata = { date: z.string(), timeZone: z.string(), fetchedAt: z.string().datetime() }
export const tasksResultSchema: z.ZodType<TasksResult> = z.object({ ...metadata, tasks: z.array(z.object({ id: z.string(), title: z.string(), area: z.string(), plannedAt: z.number().int().safe(), dueAt: z.number().int().safe().nullable() })) })
export const weatherResultSchema: z.ZodType<WeatherResult> = z.object({ ...metadata, temperature: metric, weatherCode: metric, temperatureMin: metric, temperatureMax: metric, precipitationProbability: metric })
export const locationsResultSchema: z.ZodType<LocationsResult> = z.object({ locations: z.array(citySchema) })
import { z } from 'zod'
