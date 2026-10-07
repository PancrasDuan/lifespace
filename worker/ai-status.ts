import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider, AiStatusResult } from '../src/shared/ai-status-contracts'

const componentSchema = z.object({ id: z.string(), name: z.string(), status: z.enum(['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance']) })
const incidentSchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'postmortem', 'scheduled', 'in_progress', 'verifying', 'completed']),
  updated_at: z.iso.datetime({ offset: true }),
  components: z.array(z.object({ name: z.string() })).optional(),
  incident_updates: z.array(z.object({ body: z.string(), created_at: z.iso.datetime({ offset: true }) })),
})
const summarySchema = z.object({
  status: z.object({ indicator: z.enum(['none', 'minor', 'major', 'critical', 'maintenance']), description: z.string() }),
  components: z.array(componentSchema).min(1), incidents: z.array(incidentSchema),
})

async function readOpenAI(): Promise<AiProvider> {
  const data = await upstream(new URL('https://status.openai.com/api/v2/summary.json'), summarySchema)
  const incidents = data.incidents.filter(event => !['resolved', 'postmortem', 'completed', 'scheduled'].includes(event.status)).map(event => {
    const updates = event.incident_updates.map(update => ({ body: update.body, createdAt: update.created_at })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { id: event.id, title: event.name, status: event.status, updatedAt: event.updated_at, description: updates.find(update => update.body.trim())?.body ?? '原因待公布', affectedServices: event.components?.map(component => component.name) ?? [], updates }
  })
  const affectedServices = data.components.filter(component => component.status !== 'operational').map(component => component.name)
  return { id: 'openai', name: 'OpenAI', statusUrl: 'https://status.openai.com/', checkedAt: new Date().toISOString(), status: data.status.indicator !== 'none' || incidents.length || affectedServices.length ? 'abnormal' : 'normal', description: data.status.description, incidents, affectedServices, error: null }
}

export async function readAiStatus(): Promise<AiStatusResult> {
  let provider: AiProvider
  try { provider = await readOpenAI() }
  catch { provider = { id: 'openai', name: 'OpenAI', statusUrl: 'https://status.openai.com/', checkedAt: new Date().toISOString(), status: 'unknown', description: '状态未知', incidents: [], affectedServices: [], error: '官方状态获取失败，请刷新重试或查看官方状态页' } }
  return { status: provider.status, checkedAt: new Date().toISOString(), providers: [provider] }
}
