import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const impactSchema = z.object({ component_id: z.string(), status: z.string() })
const itemComponent = z.object({ component_id: z.string(), name: z.string(), hidden: z.boolean().optional() })
const pageSchema = z.object({ summary: z.object({
  components: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  affected_components: z.array(impactSchema),
  structure: z.object({ items: z.array(z.object({
    group: z.object({ id: z.string(), name: z.string(), hidden: z.boolean().optional(), components: z.array(itemComponent) }).nullish(),
    component: itemComponent.nullish(),
  }).refine(item => Boolean(item.group) !== Boolean(item.component), '必须包含一个有效结构分支')).min(1) }),
  ongoing_incidents: z.array(z.object({
    id: z.string(), name: z.string(), status: z.string(),
    published_at: z.iso.datetime({ offset: true }), affected_components: z.array(impactSchema),
    updates: z.array(z.object({ published_at: z.iso.datetime({ offset: true }), message_string: z.string() })),
  })),
}).superRefine((summary, context) => {
  const ids = new Set(summary.components.map(component => component.id))
  for (const item of summary.structure.items) {
    const components = item.group && !item.group.hidden ? item.group.components : item.component ? [item.component] : []
    if (components.some(component => !component.hidden && !ids.has(component.component_id))) context.addIssue({ code: 'custom', message: '官网结构组件缺少元数据' })
  }
}) })

export async function readSupabase(): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  // 与官网同源同快照，保留产品分组及每个事件的组件归属。
  const { summary } = await upstream(new URL('https://status.supabase.com/proxy/status.supabase.com'), pageSchema)
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
  const impacts = new Map(summary.affected_components.map(component => [component.component_id, component.status]))
  const state = (id: string): AiProvider['status'] => {
    const value = impacts.get(id) ?? 'operational'
    return value === 'operational' ? 'normal' : ['degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'].includes(value) ? 'abnormal' : 'unknown'
  }
  const label = (status: AiProvider['status']) => status === 'normal' ? '正常' : status === 'abnormal' ? '存在异常' : '未知'
  const subStatuses: AiProvider['subStatuses'] = summary.structure.items.flatMap(item => {
    if (item.group && !item.group.hidden) {
      const children = item.group.components.filter(component => !component.hidden).map(component => ({ id: component.component_id, name: component.name, status: state(component.component_id), statusLabel: label(state(component.component_id)) }))
      const status = children.some(child => child.status === 'abnormal') ? 'abnormal' : children.some(child => child.status === 'unknown') || !children.length ? 'unknown' : 'normal'
      return [{ id: item.group.id, name: item.group.name, status, statusLabel: label(status), components: children }]
    }
    if (item.component && !item.component.hidden) {
      const status = state(item.component.component_id)
      return [{ id: item.component.component_id, name: item.component.name, status, statusLabel: label(status), components: [] }]
    }
    return []
  })
  const impactStates = summary.affected_components.map(component => state(component.component_id))
  const status = incidents.length || impactStates.includes('abnormal') || subStatuses.some(group => group.status === 'abnormal') ? 'abnormal' : impactStates.includes('unknown') || !subStatuses.length || subStatuses.some(group => group.status === 'unknown') ? 'unknown' : 'normal'
  return { statusBasis: 'official-components', checkedAt: new Date().toISOString(), status, description: '官方全平台状态，覆盖产品与区域，不代表具体项目健康。', incidents, affectedServices, error: status === 'unknown' ? '部分官网组件状态未确认' : null, subStatuses, subStatusError: null }
}
