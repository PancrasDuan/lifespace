import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const impactSchema = z.object({ component_id: z.string(), status: z.enum(['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance']) })
const pageSchema = z.object({ summary: z.object({
  components: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  affected_components: z.array(impactSchema),
  structure: z.object({ items: z.array(z.object({
    group: z.object({ id: z.string(), name: z.string(), hidden: z.boolean().optional(), components: z.array(z.object({ component_id: z.string(), name: z.string() })) }).nullish(),
  })).min(1) }),
  ongoing_incidents: z.array(z.object({
    id: z.string(), name: z.string(), status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'postmortem', 'in_progress', 'verifying', 'completed']),
    published_at: z.iso.datetime({ offset: true }), affected_components: z.array(impactSchema),
    updates: z.array(z.object({ published_at: z.iso.datetime({ offset: true }), message_string: z.string() })),
  })),
}) })

export async function readOpenAI(): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  // 与官网同源同快照，保留产品分组及每个事件的组件归属。
  const { summary } = await upstream(new URL('https://status.openai.com/proxy/status.openai.com'), pageSchema)
  const names = new Map(summary.components.map(component => [component.id, component.name]))
  const groups = new Map<string, string>()
  for (const item of summary.structure.items) for (const component of item.group?.components ?? []) groups.set(component.component_id, item.group!.name)
  const componentLabel = (id: string) => {
    const name = names.get(id)
    const group = groups.get(id)
    return group && name ? `${group} / ${name}` : name ?? '官方未列出'
  }
  const affectedServices = [...new Set(summary.affected_components.filter(component => component.status !== 'operational').map(component => groups.get(component.component_id) ?? componentLabel(component.component_id)))]
  const incidents = summary.ongoing_incidents.filter(event => !['resolved', 'postmortem', 'completed'].includes(event.status)).map(event => {
    const updates = event.updates.map(update => ({ body: update.message_string, createdAt: update.published_at })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { id: event.id, title: event.name, status: event.status, description: updates.find(update => update.body.trim())?.body ?? '原因待公布', updatedAt: updates[0]?.createdAt ?? event.published_at, affectedServices: [...new Set(event.affected_components.map(component => componentLabel(component.component_id)))], updates }
  })
  const abnormal = incidents.length > 0 || affectedServices.length > 0
  const impacted = new Set(summary.affected_components.filter(component => component.status !== 'operational').map(component => component.component_id))
  const subStatuses: AiProvider['subStatuses'] = summary.structure.items.flatMap(item => {
    if (!item.group || item.group.hidden) return []
    const abnormal = item.group.components.some(component => impacted.has(component.component_id))
    return [{ id: item.group.id, name: item.group.name, status: abnormal ? 'abnormal' : 'normal', statusLabel: abnormal ? '存在异常' : '可用', components: [] }]
  })
  return { checkedAt: new Date().toISOString(), status: abnormal ? 'abnormal' : 'normal', description: abnormal ? '官方报告存在服务异常' : '官方未报告服务异常', incidents, affectedServices, error: null, subStatuses, subStatusError: null }
}
