import { z } from 'zod'
import { growthPageSchema, rewardSourceSchema } from '../shared/adventure-growth'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { adventureClientVersion, adventureClientVersionHeader, adventureReceiptModel, planningCompatibilitySchema, recurringAdventureClientVersion } from '../shared/adventure-client-version'
import {
  dateTaskListInputSchema, dateTaskListSchema, recurringChildrenInputSchema, recurringChildrenSchema,
  recurringChildDetailSchema, recurringDefinitiveErrors, recurringDetailInputSchema, recurringListInputSchema,
  recurringListSchema, recurringParentDetailSchema,
  type DateTaskListInput, type RecurringChildrenInput, type RecurringDetailInput, type RecurringListInput,
} from '../shared/adventure-recurring'
import { canRetryPlanningEnvelope, planningRecoveryHeader, planningRecoverySchema, planningRecoveryVersion, type StoredPlanningEnvelope } from '../shared/adventure-recovery'
import { recurringCommandSchema, taskListSchema, type TaskListInput, taskHistorySchema, migrationOptionsSchema, planningPageSchema, planningReceiptSchema, planningPreviewSchema, type PlanningEnvelope, type PlanningCommand, type PlanningQuery } from '../shared/adventure-planning'

export class PlanningError extends Error {
  constructor(message: string, readonly status: number, readonly uncertain = false, readonly code?: string) { super(message) }
  get requiresRefresh() { return !this.uncertain && (this.code === 'PLANNING_DATE_CHANGED' || this.code === 'VERSION_CONFLICT' || this.code === 'COMPLETION_CHANGED') }
}
// A first response with one of these codes proves the new command did not commit.
// Authentication, reused IDs, malformed responses and unknown errors remain pending.
const definitiveErrors: Record<string, number> = {
  ...recurringDefinitiveErrors,
  PENDING_TASKS: 400, VERSION_CONFLICT: 409, SAME_DESTINATION: 400, NOT_FOUND: 404,
  READ_ONLY: 400, RESCHEDULE_PAST: 400, SAME_DATE: 400, DATE_LOCKED: 400,
  TASK_NOT_PENDING: 400, DATE_STARTED: 400, COMPLETION_CHANGED: 409,
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
    throw new PlanningError(parsed.success ? parsed.data.error.message : '连接暂时不可用，请重试', response.status, mutation && !definitive, code)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new PlanningError('返回数据不完整，请重新读取', 502, mutation)
  return parsed.data
}
async function readPinned<T extends { version: number; today: string }>(response: Response, schema: z.ZodType<T>, basis: { expectedVersion: number; today: string }) {
  const result = await read(response, schema)
  if (result.today !== basis.today) throw new PlanningError('规划日期已变化，请重新读取后主动操作', 409, false, 'PLANNING_DATE_CHANGED')
  if (result.version !== basis.expectedVersion) throw new PlanningError('数据已更新，请重新读取', 409, false, 'VERSION_CONFLICT')
  return result
}
export const planningApi = {
  async recover(owner: string, envelope: StoredPlanningEnvelope, signal: AbortSignal) {
    const uncertain = () => new PlanningError('操作结果尚未确认，请稍后再次确认；如仍无法确认，请联系管理员核对，暂勿重复操作。', 0, true)
    try {
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const response = await authorizedMutation('/api/adventure/recovery', JSON.stringify({ ...envelope, nonce }), signal, owner, 'POST', { [adventureClientVersionHeader]: adventureClientVersion })
      if (!response.ok || response.headers.get(planningRecoveryHeader) !== planningRecoveryVersion || !noStore(response)) throw uncertain()
      const result = await read(response, planningRecoverySchema, true)
      if (result.requestId !== envelope.requestId || result.nonce !== nonce) throw uncertain()
      // A current envelope can never be classified as a missing legacy receipt.
      if (result.outcome === 'review' && (result.code === 'LEGACY_RECEIPT_MISSING') === canRetryPlanningEnvelope(envelope)) throw uncertain()
      return result
    } catch { throw uncertain() }
  },
  async lookupReceipt(owner: string, envelope: StoredPlanningEnvelope, signal: AbortSignal) {
    const uncertain = () => new PlanningError('操作结果尚未确认，请稍后再次确认；如仍无法确认，请联系管理员核对，暂勿重复操作。', 0, true)
    try {
      const compatibility = await authorizedFetch('/api/adventure/compatibility', signal, owner)
      const model: unknown = await compatibility.json().catch(() => null)
      const supported = planningCompatibilitySchema.safeParse(model)
      if (!compatibility.ok || !noStore(compatibility) || !supported.success) throw uncertain()
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const response = await authorizedMutation('/api/adventure/receipts/lookup', JSON.stringify({ ...envelope, nonce }), signal, owner)
      if (!response.ok || response.headers.get('X-Lifespace-Adventure-Model') !== adventureReceiptModel || !noStore(response)) throw uncertain()
      const result = await read(response, z.strictObject({ requestId: z.string(), nonce: z.string(), receipt: planningReceiptSchema }), true)
      if (result.requestId !== envelope.requestId || result.nonce !== nonce) throw uncertain()
      return result.receipt
    } catch { throw uncertain() }
  },
  async taskList(owner: string, filters: TaskListInput, signal: AbortSignal) {
    return read(await authorizedMutation('/api/adventure/tasks/list', JSON.stringify(filters), signal, owner), taskListSchema)
  },
  async dateTaskList(owner: string, filters: DateTaskListInput, signal: AbortSignal) {
    const value = dateTaskListInputSchema.parse(filters)
    return readPinned(await authorizedMutation('/api/adventure/date-tasks/list', JSON.stringify(value), signal, owner), dateTaskListSchema, value)
  },
  async recurringList(owner: string, filters: RecurringListInput, signal: AbortSignal) {
    const value = recurringListInputSchema.parse(filters)
    return readPinned(await authorizedMutation('/api/adventure/recurring/list', JSON.stringify(value), signal, owner), recurringListSchema, value)
  },
  async recurringParent(owner: string, filters: RecurringDetailInput, signal: AbortSignal) {
    const value = recurringDetailInputSchema.parse(filters)
    return readPinned(await authorizedMutation('/api/adventure/recurring/detail', JSON.stringify(value), signal, owner), recurringParentDetailSchema, value)
  },
  async recurringChildren(owner: string, filters: RecurringChildrenInput, signal: AbortSignal) {
    const value = recurringChildrenInputSchema.parse(filters)
    return readPinned(await authorizedMutation('/api/adventure/recurring/children', JSON.stringify(value), signal, owner), recurringChildrenSchema, value)
  },
  async recurringChild(owner: string, filters: RecurringDetailInput, signal: AbortSignal) {
    const value = recurringDetailInputSchema.parse(filters)
    return readPinned(await authorizedMutation('/api/adventure/recurring/child', JSON.stringify(value), signal, owner), recurringChildDetailSchema, value)
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
      const clientVersion = recurringCommandSchema.safeParse(envelope.command).success ? recurringAdventureClientVersion : adventureClientVersion
      return await read(await authorizedMutation('/api/adventure/commands', JSON.stringify(envelope), signal, owner, 'POST', { [adventureClientVersionHeader]: clientVersion }), planningReceiptSchema, true)
    } catch (error) {
      if (error instanceof PlanningError) throw error
      throw new PlanningError('连接中断，尚不能确认是否保存。请安全重试同一次操作。', 0, true)
    }
  },
}
