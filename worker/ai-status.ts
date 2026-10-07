import { z } from 'zod'
import { ApiError, upstream } from './upstream'
import type { AiProvider, AiStatusResult } from '../src/shared/ai-status-contracts'

const componentSchema = z.object({ id: z.string(), name: z.string(), status: z.enum(['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance']) })
const incidentSchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'postmortem', 'scheduled', 'in_progress', 'verifying', 'completed']),
  updated_at: z.iso.datetime({ offset: true }),
  resolved_at: z.iso.datetime({ offset: true }).nullable().optional(),
  components: z.array(z.object({ name: z.string() })).optional(),
  incident_updates: z.array(z.object({ body: z.string(), created_at: z.iso.datetime({ offset: true }) })),
})
const summarySchema = z.object({
  status: z.object({ indicator: z.enum(['none', 'minor', 'major', 'critical', 'maintenance']), description: z.string() }),
  components: z.array(componentSchema).min(1), incidents: z.array(incidentSchema),
})

const xaiSummarySchema = z.object({
  status: z.object({ indicator: z.string(), description: z.string() }),
  components: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(['available', 'info', 'disruption', 'outage', 'no_data']) })).min(1),
})
const xaiIncidentsSchema = z.object({ incidents: z.array(incidentSchema) })
const providers = [
  { id: 'openai', name: 'OpenAI', statusUrl: 'https://status.openai.com/' },
  { id: 'xai', name: 'xAI', statusUrl: 'https://status.x.ai/' },
] as const

type Summary = z.infer<typeof summarySchema> | z.infer<typeof xaiSummarySchema>

function normalize(data: Summary, events: z.infer<typeof incidentSchema>[], provider: typeof providers[number]): AiProvider {
  const incidents = events.filter(event => !event.resolved_at && !['resolved', 'postmortem', 'completed', 'scheduled'].includes(event.status)).map(event => {
    const updates = event.incident_updates.map(update => ({ body: update.body, createdAt: update.created_at })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { id: event.id, title: event.name, status: event.status, updatedAt: event.updated_at, description: updates.find(update => update.body.trim())?.body ?? '原因待公布', affectedServices: event.components?.map(component => component.name) ?? [], updates }
  })
  const affectedServices = data.components.filter(component => !['operational', 'available', 'no_data'].includes(component.status)).map(component => component.name)
  const abnormal = incidents.length > 0 || affectedServices.length > 0 || ['minor', 'major', 'critical', 'maintenance', 'info', 'disruption', 'outage'].includes(data.status.indicator)
  const unknown = data.components.some(component => component.status === 'no_data') || !['none', 'available', 'minor', 'major', 'critical', 'maintenance', 'info', 'disruption', 'outage'].includes(data.status.indicator)
  return { ...provider, checkedAt: new Date().toISOString(), status: abnormal ? 'abnormal' : unknown ? 'unknown' : 'normal', description: data.status.description, incidents, affectedServices, error: unknown ? '部分官方状态数据未知，请查看官方状态页' : null }
}

async function readProvider(provider: typeof providers[number]): Promise<AiProvider> {
  try {
    if (provider.id === 'openai') {
      const data = await upstream(new URL('https://status.openai.com/api/v2/summary.json'), summarySchema)
      return normalize(data, data.incidents, provider)
    }
    const [summary, events] = await Promise.all([
      upstream(new URL('https://data.x.ai/status/summary.json'), xaiSummarySchema),
      upstream(new URL('https://data.x.ai/status/incidents.json'), xaiIncidentsSchema),
    ])
    return normalize(summary, events.incidents, provider)
  } catch (error) {
    const message = error instanceof ApiError && error.code === 'SOURCE_CONNECTION_INVALID' ? '官方状态接口拒绝访问，请查看官方状态页' : '官方状态获取失败，请刷新重试或查看官方状态页'
    return { ...provider, checkedAt: new Date().toISOString(), status: 'unknown', description: '状态未知', incidents: [], affectedServices: [], error: message }
  }
}

export async function readAiStatus(): Promise<AiStatusResult> {
  const results = await Promise.all(providers.map(readProvider))
  const status = results.some(provider => provider.status === 'abnormal') ? 'abnormal' : results.some(provider => provider.status === 'unknown') ? 'unknown' : 'normal'
  return { status, checkedAt: new Date().toISOString(), providers: results }
}
