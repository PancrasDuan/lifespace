import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { planningPageSchema, planningReceiptSchema, type PlanningEnvelope } from '../shared/adventure-planning'

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
  async load(owner: string, page: number, signal: AbortSignal) {
    return read(await authorizedFetch(`/api/adventure?page=${page}`, signal, owner), planningPageSchema)
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
