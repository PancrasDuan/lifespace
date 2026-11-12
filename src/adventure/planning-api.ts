import { z } from 'zod'
import { growthPageSchema, rewardSourceSchema } from '../shared/adventure-growth'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { adventureClientVersion, adventureClientVersionHeader } from '../shared/adventure-client-version'
import type { StoredPlanningEnvelope } from '../shared/adventure-recovery'
import { taskListSchema, type TaskListInput, taskHistorySchema, migrationOptionsSchema, planningPageSchema, planningReceiptSchema, planningPreviewSchema, type PlanningEnvelope, type PlanningCommand, type PlanningQuery } from '../shared/adventure-planning'

export class PlanningError extends Error {
  constructor(message: string, readonly status: number, readonly uncertain = false) { super(message) }
}
// A first response with one of these codes proves the new command did not commit.
// Authentication, reused IDs, malformed responses and unknown errors remain pending.
const definitiveErrors: Record<string, number> = {
  PENDING_TASKS: 400, VERSION_CONFLICT: 409, SAME_DESTINATION: 400, NOT_FOUND: 404,
  READ_ONLY: 400, RESCHEDULE_PAST: 400, SAME_DATE: 400, DATE_LOCKED: 400,
  TASK_NOT_PENDING: 400, HISTORY_LOCKED: 400, DATE_STARTED: 400, COMPLETION_CHANGED: 409,
  INVALID_COMMAND: 400, COMMAND_TOO_LARGE: 400, CAPACITY_REACHED: 400,
}
// Require a complete directive list: a malformed extension can make the
// semantics of an otherwise present no-store ambiguous to intermediaries.
function noStore(response: Response) {
  const value = response.headers.get('Cache-Control') ?? ''
  const directive = /[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:[ \t]*=[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t !\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t \x21-\x7e\x80-\xff])*"))?[ \t]*/y
  let position = 0, found = false
  while (position < value.length) {
    directive.lastIndex = position
    const match = directive.exec(value)
    if (!match) return false
    if (match[1].toLowerCase() === 'no-store') {
      if (match[2] !== undefined) return false
      found = true
    }
    position = directive.lastIndex
    if (position === value.length) return found
    if (value[position++] !== ',' || position === value.length) return false
  }
  return false
}
async function read<T>(response: Response, schema: z.ZodType<T>, mutation = false): Promise<T> {
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string(), code: z.string().optional() }) }).safeParse(value)
    const code = parsed.success ? parsed.data.error.code : undefined
    const definitive = code !== undefined && Object.hasOwn(definitiveErrors, code) && definitiveErrors[code] === response.status
    throw new PlanningError(parsed.success ? parsed.data.error.message : '连接暂时不可用，请重试', response.status, mutation && !definitive)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new PlanningError('返回数据不完整，请重新读取', 502, mutation)
  return parsed.data
}
export const planningApi = {
  async lookupReceipt(owner: string, envelope: StoredPlanningEnvelope, signal: AbortSignal) {
    const uncertain = () => new PlanningError('操作结果尚未确认，请稍后再次确认；如仍无法确认，请联系管理员核对，暂勿重复操作。', 0, true)
    try {
      const compatibility = await authorizedFetch('/api/adventure/compatibility', signal, owner)
      const model: unknown = await compatibility.json().catch(() => null)
      const supported = z.strictObject({ model: z.literal('goal-categories'), version: z.literal(1), receiptLookup: z.literal(true), legacyRetry: z.literal(false) }).safeParse(model).success
      if (!compatibility.ok || !noStore(compatibility) || !supported) throw uncertain()
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const response = await authorizedMutation('/api/adventure/receipts/lookup', JSON.stringify({ ...envelope, nonce }), signal, owner)
      if (!response.ok || response.headers.get('X-Lifespace-Adventure-Model') !== adventureClientVersion || !noStore(response)) throw uncertain()
      const result = await read(response, z.strictObject({ requestId: z.string(), nonce: z.string(), receipt: planningReceiptSchema }), true)
      if (result.requestId !== envelope.requestId || result.nonce !== nonce) throw uncertain()
      return result.receipt
    } catch { throw uncertain() }
  },
  async taskList(owner: string, filters: TaskListInput, signal: AbortSignal) {
    return read(await authorizedMutation('/api/adventure/tasks/list', JSON.stringify(filters), signal, owner), taskListSchema)
  },
  async growth(owner: string, signal: AbortSignal, version?: number, cursor?: string) {
    const query = new URLSearchParams()
    if (version !== undefined) query.set('version', String(version))
    if (cursor) query.set('cursor', cursor)
    return read(await authorizedFetch(`/api/adventure/growth?${query}`, signal, owner), growthPageSchema)
  },
  async rewardSource(owner: string, id: string, page: number, signal: AbortSignal, version?: number) {
    const query = new URLSearchParams({ id, page: String(page) })
    if (version !== undefined) query.set('version', String(version))
    return read(await authorizedFetch(`/api/adventure/reward-source?${query}`, signal, owner), rewardSourceSchema)
  },
  async taskHistory(owner: string, id: string, page: number, signal: AbortSignal) {
    return read(await authorizedFetch(`/api/adventure/task-history?${new URLSearchParams({ id, page: String(page) })}`, signal, owner), taskHistorySchema)
  },
  async migrationOptions(owner: string, kind: 'task', id: string, page: number, signal: AbortSignal) {
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
      return await read(await authorizedMutation('/api/adventure/commands', JSON.stringify(envelope), signal, owner, 'POST', { [adventureClientVersionHeader]: adventureClientVersion }), planningReceiptSchema, true)
    } catch (error) {
      if (error instanceof PlanningError) throw error
      throw new PlanningError('连接中断，尚不能确认是否保存。请安全重试同一次操作。', 0, true)
    }
  },
}
