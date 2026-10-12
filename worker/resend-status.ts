import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const instant = z.iso.datetime({ offset: true })
const componentSchema = z.object({ id: z.string(), name: z.string(), status: z.string() })
const summarySchema = z.object({
  components: z.array(componentSchema).min(1),
  incidents: z.array(z.object({
    id: z.string(), name: z.string(), status: z.string(), updated_at: instant,
    components: z.array(componentSchema).optional(),
    incident_updates: z.array(z.object({ body: z.string().nullable(), created_at: instant })),
  })).default([]),
})
const sendingNames = ['SMTP', 'General API', 'Single Email']
const labels: Record<string, string> = {
  operational: '正常', degraded_performance: '性能下降', partial_outage: '部分故障',
  major_outage: '严重故障', under_maintenance: '维护中',
}
function state(status: string): AiProvider['status'] {
  return status === 'operational' ? 'normal' : Object.hasOwn(labels, status) ? 'abnormal' : 'unknown'
}

export async function readResend(): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  const summary = await upstream(new URL('https://resend-status.com/api/v2/summary.json'), summarySchema)
  const sending = sendingNames.map(name => summary.components.find(component => component.name === name))
  // 仅按已确认的三个组件汇总，其他组件与无组件归属事件保留在详情。
  const status = sending.some(component => component && state(component.status) === 'abnormal') ? 'abnormal'
    : sending.some(component => !component || state(component.status) === 'unknown') ? 'unknown' : 'normal'
  const incidents = summary.incidents.filter(event => !['resolved', 'postmortem', 'completed'].includes(event.status)).map(event => {
    const updates = event.incident_updates.map(update => ({ body: update.body ?? '', createdAt: update.created_at }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { id: event.id, title: event.name, status: event.status,
      description: updates.find(update => update.body.trim())?.body ?? '原因待公布',
      updatedAt: event.updated_at, affectedServices: event.components?.map(component => component.name) ?? [], updates }
  })
  return {
    statusBasis: 'official-components', checkedAt: new Date().toISOString(), status,
    description: status === 'abnormal' ? '发信相关组件存在异常' : status === 'unknown' ? '发信相关组件状态未完整确认' : '发信相关组件正常',
    affectedServices: sending.filter(component => component && state(component.status) === 'abnormal').map(component => component!.name),
    incidents, error: status === 'unknown' ? '发信相关组件缺失或状态无法识别，请查看官方状态页' : null,
    subStatuses: summary.components.map(component => ({ id: component.id, name: component.name,
      status: state(component.status), statusLabel: Object.hasOwn(labels, component.status) ? labels[component.status] : '未知', components: [] })),
    subStatusError: null,
  }
}
