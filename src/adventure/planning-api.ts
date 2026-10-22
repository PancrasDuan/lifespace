import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { taskHistorySchema, migrationOptionsSchema, planningPageSchema, planningReceiptSchema, planningPreviewSchema, type PlanningEnvelope, type PlanningCommand, type PlanningQuery } from '../shared/adventure-planning'

export class PlanningError extends Error {
  constructor(message: string, readonly status: number, readonly uncertain = false) { super(message) }
}
async function read<T>(response: Response, schema: z.ZodType<T>, mutation = false): Promise<T> {
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(value)
    throw new PlanningError(parsed.success ? parsed.data.error.message : '连接暂时不可用，请重试', response.status, mutation && response.status >= 500)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new PlanningError('返回数据不完整，请重新读取', 502, mutation)
  return parsed.data
}
export const planningApi = {
  async taskHistory(owner: string, id: string, page: number, signal: AbortSignal) {
    return read(await authorizedFetch(`/api/adventure/task-history?${new URLSearchParams({ id, page: String(page) })}`, signal, owner), taskHistorySchema)
  },
  async migrationOptions(owner: string, kind: 'goal' | 'task', id: string, page: number, signal: AbortSignal) {
    return read(await authorizedFetch(`/api/adventure/migration-options?${new URLSearchParams({ kind, id, page: String(page) })}`, signal, owner), migrationOptionsSchema)
  },
  async load(owner: string, filters: PlanningQuery, signal: AbortSignal) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value))
    return read(await authorizedFetch(`/api/adventure?${query}`, signal, owner), planningPageSchema)
  },
  async preview(owner: string, expectedVersion: number, command: PlanningCommand, signal: AbortSignal) {
    return read(await authorizedMutation('/api/adventure/preview', JSON.stringify({ expectedVersion, command }), signal, owner), planningPreviewSchema)
  },
  async send(owner: string, envelope: PlanningEnvelope, signal: AbortSignal) {
    try {
      return await read(await authorizedMutation('/api/adventure/commands', JSON.stringify(envelope), signal, owner), planningReceiptSchema, true)
    } catch (error) {
      if (error instanceof PlanningError) throw error
      throw new PlanningError('连接中断，尚不能确认是否保存。请安全重试同一次操作。', 0, true)
    }
  },
}
