import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const componentSchema = z.object({ id: z.string(), name: z.string(), status: z.string(), group: z.boolean().optional(), group_id: z.string().nullish() })
const schema = z.object({
  components: z.array(componentSchema).min(1),
  incidents: z.array(z.object({
    id: z.string(), name: z.string(), status: z.string(), updated_at: z.iso.datetime({ offset: true }),
    components: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    incident_updates: z.array(z.object({ body: z.string().nullable(), created_at: z.iso.datetime({ offset: true }) })),
  })).default([]),
})
const labels: Record<string, string> = { operational: '正常', degraded_performance: '性能下降', partial_outage: '部分故障', major_outage: '严重故障', under_maintenance: '维护中' }
const state = (value: string): AiProvider['status'] => value === 'operational' ? 'normal' : Object.hasOwn(labels, value) ? 'abnormal' : 'unknown'
const aggregate = (values: AiProvider['status'][]): AiProvider['status'] => values.includes('abnormal') ? 'abnormal' : values.includes('unknown') || !values.length ? 'unknown' : 'normal'

export async function readStatuspage(url: string): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  const summary = await upstream(new URL(url), schema, { headers: { 'User-Agent': 'LifeSpaceStatus/1.0 (+https://lifespace.onepeace.cc.cd)' } })
  const leaves = summary.components.filter(component => !component.group)
  const leaf = (component: typeof leaves[number]) => ({ id: component.id, name: component.name, status: state(component.status), statusLabel: Object.hasOwn(labels, component.status) ? labels[component.status] : '未知' })
  const groupIds = new Set(summary.components.filter(component => component.group).map(component => component.id))
  const subStatuses = summary.components.filter(component => component.group || !component.group_id || !groupIds.has(component.group_id)).map(component => {
    const children = component.group ? leaves.filter(child => child.group_id === component.id).map(leaf) : []
    const status = children.length ? aggregate(children.map(child => child.status)) : state(component.status)
    return { ...leaf(component), status, statusLabel: status === 'normal' ? '正常' : status === 'abnormal' ? '存在异常' : '未知', components: children }
  })
  const incidents = summary.incidents.filter(event => !['resolved', 'postmortem', 'completed'].includes(event.status)).map(event => {
    const updates = event.incident_updates.map(update => ({ body: update.body ?? '', createdAt: update.created_at })).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { id: event.id, title: event.name, status: event.status, description: updates.find(update => update.body.trim())?.body ?? '原因待公布', updatedAt: event.updated_at, affectedServices: event.components?.map(component => component.name) ?? [], updates }
  })
  const status = aggregate([...leaves.map(component => state(component.status)), ...(incidents.length ? ['abnormal' as const] : [])])
  return { statusBasis: 'official-components', checkedAt: new Date().toISOString(), status,
    description: '官方全平台状态，具体影响请查看异常事件和子服务。', incidents,
    affectedServices: leaves.filter(component => state(component.status) === 'abnormal').map(component => component.name),
    error: status === 'unknown' ? '部分官网组件状态无法识别' : null, subStatuses, subStatusError: null }
}
