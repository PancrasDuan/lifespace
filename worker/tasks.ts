import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import type { TasksResult } from '../src/shared/contracts'
import { ApiError, upstream } from './upstream'

const rowsSchema = z.array(z.object({
  id: z.union([z.string().regex(/^\d+$/), z.number().int().safe()]), title: z.string(), area: z.string(),
  planned_at: z.number().int().safe(), due_at: z.number().int().safe().nullable(),
}))

export async function readTasks(env: Partial<CloudflareEnv>, timeZone: string | undefined): Promise<TasksResult> {
  if (!timeZone || /^[+-]/.test(timeZone)) throw new ApiError('INVALID_TIME_ZONE', '请选择有效的地区时区', 400)
  let start: Temporal.ZonedDateTime
  try { start = Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(timeZone).startOfDay() }
  catch { throw new ApiError('INVALID_TIME_ZONE', '请选择有效的地区时区', 400) }
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new ApiError('TASKS_NOT_CONFIGURED', '任务来源尚未配置', 503)
  const end = start.add({ days: 1 }).startOfDay()
  const url = new URL('/rest/v1/tasks', env.SUPABASE_URL)
  url.searchParams.set('select', 'id,title,area,planned_at,due_at')
  url.searchParams.set('status', 'eq.todo'); url.searchParams.set('is_deleted', 'eq.false')
  url.searchParams.append('planned_at', `gte.${start.epochMilliseconds / 1000}`)
  url.searchParams.append('planned_at', `lt.${end.epochMilliseconds / 1000}`)
  url.searchParams.set('order', 'planned_at.asc,id.asc'); url.searchParams.set('limit', '500')
  const headers: Record<string, string> = { apikey: env.SUPABASE_SECRET_KEY }
  // Legacy JWT 与新 secret key 均可使用；仅 JWT 放入 Bearer。
  if (env.SUPABASE_SECRET_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`
  const tasks = new Map<string, TasksResult['tasks'][number]>()
  for (let page = 0; ; page++) {
    if (page >= 100) throw new ApiError('SOURCE_INVALID_RESPONSE', '任务来源返回的数据过多', 502)
    url.searchParams.set('offset', String(page * 500))
    const rows = await upstream(url, rowsSchema, { headers })
    for (const row of rows) tasks.set(String(row.id), { id: String(row.id), title: row.title, area: row.area, plannedAt: row.planned_at, dueAt: row.due_at })
    if (rows.length < 500) break
  }
  return { date: start.toPlainDate().toString(), timeZone, fetchedAt: new Date().toISOString(), tasks: [...tasks.values()].sort((a, b) => a.plannedAt - b.plannedAt || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)) }
}
