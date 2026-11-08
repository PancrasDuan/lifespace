import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import type { TasksResult } from '../src/shared/contracts'
import { ApiError } from './upstream'
import { transaction, type DatabaseEnv } from './database'

const rowsSchema = z.array(z.object({
  id: z.union([z.string().regex(/^\d+$/), z.number().int().safe()]), title: z.string(), area: z.string(),
  planned_at: z.number().int().safe(), due_at: z.number().int().safe().nullable(),
}))

export async function readTasks(env: DatabaseEnv, timeZone: string | undefined): Promise<TasksResult> {
  if (!timeZone || /^[+-]/.test(timeZone)) throw new ApiError('INVALID_TIME_ZONE', '请选择有效的地区时区', 400)
  let start: Temporal.ZonedDateTime
  try { start = Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(timeZone).startOfDay() }
  catch { throw new ApiError('INVALID_TIME_ZONE', '请选择有效的地区时区', 400) }
  if (!env.HYPERDRIVE?.connectionString) throw new ApiError('TASKS_NOT_CONFIGURED', '任务来源尚未配置', 503)
  const end = start.add({ days: 1 }).startOfDay()
  const tasks = new Map<string, TasksResult['tasks'][number]>()
  try {
    const raw = await transaction(env, null, db => db.rows(`select id::text id,title,area,planned_at,due_at from public.tasks
      where status='todo' and not is_deleted and planned_at >= $1 and planned_at < $2
      order by planned_at,id limit 50001`, [start.epochMilliseconds / 1000, end.epochMilliseconds / 1000]))
    // Keep one SQL snapshot for the entire day's shared read-only source.
    if (raw.length >= 50_000) throw new ApiError('SOURCE_INVALID_RESPONSE', '任务来源返回的数据过多', 502)
    const parsed = rowsSchema.safeParse(raw.map(row => ({ ...row, planned_at: Number(row.planned_at), due_at: row.due_at === null ? null : Number(row.due_at) })))
    if (!parsed.success) throw new ApiError('SOURCE_INVALID_RESPONSE', '数据源返回了无效内容', 502)
    const rows = parsed.data
    for (const row of rows) tasks.set(String(row.id), { id: String(row.id), title: row.title, area: row.area, plannedAt: row.planned_at, dueAt: row.due_at })
  } catch (error) {
    if (error instanceof ApiError) throw error
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code === '42501' || code === '28P01' || code === '28000') throw new ApiError('SOURCE_CONNECTION_INVALID', '数据源连接失效，请检查服务端配置', 502)
    if (code === '57014' || error instanceof Error && /timeout|timed out/i.test(error.message)) throw new ApiError('SOURCE_TIMEOUT', '数据源请求超时，请稍后刷新', 504)
    throw new ApiError('SOURCE_UNAVAILABLE', '数据源暂时不可用，请稍后刷新', 502)
  }
  return { date: start.toPlainDate().toString(), timeZone, fetchedAt: new Date().toISOString(), tasks: [...tasks.values()].sort((a, b) => a.plannedAt - b.plannedAt || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)) }
}
