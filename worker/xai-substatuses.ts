import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const healthSchema = z.enum(['available', 'info', 'disruption', 'outage', 'no_data'])
const summarySchema = z.object({ components: z.array(z.object({ id: z.string(), name: z.string(), status: healthSchema })) })
const uptimeSchema = z.object({ groups: z.array(z.object({ name: z.string(), components: z.array(z.string()) })), components: z.array(z.object({ id: z.string() })).default([]) })
const order = ['available', 'info', 'disruption', 'outage'] as const
const labels = { available: '可用', info: '信息通知', disruption: '服务受影响', outage: '服务中断', no_data: '状态未知' }

export async function readXaiSubStatuses(): Promise<AiProvider['subStatuses']> {
  const [summary, uptime] = await Promise.all([
    upstream(new URL('https://data.x.ai/status/summary.json'), summarySchema),
    upstream(new URL('https://data.x.ai/status/uptime.json'), uptimeSchema),
  ])
  const entries = new Map(summary.components.map(component => [component.id, component]))
  const ids = [...new Set([...entries.keys(), ...uptime.components.map(component => component.id)])]
  const thirdParty = new Set(['openai', 'anthropic'])
  const used = new Set<string>()
  const component = (id: string) => {
    const data = entries.get(id)
    const health = data?.status ?? 'no_data'
    return { id, name: data?.name ?? id, status: health === 'available' ? 'normal' as const : health === 'no_data' ? 'unknown' as const : 'abnormal' as const, statusLabel: labels[health] }
  }
  const group = (name: string, members: string[]): AiProvider['subStatuses'][number] => {
    let worst = -1
    for (const id of members) {
      const value = entries.get(id)?.status
      const rank = order.findIndex(health => health === value)
      worst = Math.max(worst, rank)
    }
    const health = worst < 0 ? 'no_data' : order[worst]
    return { id: name, name, status: health === 'available' ? 'normal' : health === 'no_data' ? 'unknown' : 'abnormal', statusLabel: labels[health], components: members.map(component) }
  }
  const results: AiProvider['subStatuses'] = []
  for (const item of uptime.groups) {
    const members = [...new Set(item.components.filter(id => ids.includes(id) && !thirdParty.has(id)))]
    if (!members.length) continue
    for (const id of members) used.add(id)
    results.push(group(item.name, members))
  }
  const other = ids.filter(id => !used.has(id) && !thirdParty.has(id))
  if (other.length) results.push(group('Other', other))
  const external = ids.filter(id => thirdParty.has(id))
  if (external.length) results.push(group('Third-party Services', external))
  return results
}
