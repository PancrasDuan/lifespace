import { z } from 'zod'
import { growthPageSchema, growthQuerySchema, rewardSourceSchema, rewardSourceQuerySchema } from '../../src/shared/adventure-growth'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from '../auth'
import { readBoundedBody, BodyLimitError } from '../read-body'
import { ApiError } from '../upstream'
import { traceUpstreamFailure, traceUpstreamStatus, upstreamFailureType } from '../trace'
import { adventureClientVersion, adventureClientVersionHeader } from '../../src/shared/adventure-client-version'
import { storedPlanningEnvelopeSchema } from '../../src/shared/adventure-recovery'
import {
  taskListInputSchema, taskListSchema, taskHistorySchema, migrationOptionsSchema, planningPageSchema, planningReceiptSchema, taskRangeSchema, taskScopeSchema, planningSearchSchema,
  planningPreviewInputSchema, planningPreviewSchema,
} from '../../src/shared/adventure-planning'

type PlanningContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
const unavailable = () => new ApiError('ADVENTURE_UNAVAILABLE', '暂时无法读取人生冒险，请稍后重试', 503)
export const oldClientUnavailable = () => new ApiError('CLIENT_UPDATE_REQUIRED', '旧页面操作结果可能未知，请不要刷新或重新提交，请联系维护人员核对。', 503)
const errors = {
  PENDING_TASKS: [400, '请先删除未完成任务，或在编辑任务中移到其他在用目标／独立任务'],
  VERSION_CONFLICT: [409, '数据已更新，请重新读取后确认操作'],
  REQUEST_ID_REUSED: [409, '请求编号已用于其他操作，请重新确认'],
  RECEIPT_UNKNOWN: [404, '无法确认历史结果，请勿重新提交并联系维护人员'],
  REPLAY_UNAVAILABLE: [409, '历史结果无法安全重放，请重新读取后确认'],
  SAME_DESTINATION: [400, '当前归属无需迁移'],
  NOT_FOUND: [404, '内容不存在或不属于当前账户'],
  READ_ONLY: [400, '内容已进入终态，只能查看'],
  RESCHEDULE_PAST: [400, '只能改到服务端今天或未来，不能补写过去完成'],
  SAME_DATE: [400, '新日期与当前执行日期相同，无需改期'],
  DATE_LOCKED: [400, '不能提前完成未来安排，且仅能取消今天的完成'],
  TASK_NOT_PENDING: [400, '仅待完成任务可以执行此操作'],
  HISTORY_LOCKED: [400, '任务已有完成或历史安排，不能按误建删除'],
  DATE_STARTED: [400, '执行日已到，不能按误建删除；不再执行可选择结束'],
  COMPLETION_CHANGED: [409, '这次完成已变化，请重新读取后确认'],
  INVALID_COMMAND: [400, '输入字段或内容无效'],
  CAPACITY_REACHED: [400, '操作超出当前容量限制，未保存任何变更'],
} as const

async function rpc<T>(c: PlanningContext, name: string, parameters: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = c.env
  if (!base || !key) throw unavailable()
  let url: URL
  try { url = new URL(`/rest/v1/rpc/${name}`, base) } catch { throw unavailable() }
  if (url.protocol !== 'https:' || url.username || url.password) throw unavailable()
  const headers = new Headers({ apikey: key, 'Content-Type': 'application/json' })
  if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
  let response: Response | undefined
  let fetched = false
  try {
    fetched = true
    response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ ...parameters, p_owner: c.get('identity').id }),
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    })
    if (!response.body) {
      if (response.ok) traceUpstreamFailure('invalid-response')
      else traceUpstreamStatus(response.status)
      throw unavailable()
    }
    const value: unknown = JSON.parse(await readBoundedBody(response.body, 1_048_576, 10_000))
    if (!response.ok) {
      const failure = z.object({ message: z.string() }).safeParse(value)
      const code = failure.success ? failure.data.message : ''
      if (Object.hasOwn(errors, code)) {
        const [status, message] = errors[code as keyof typeof errors]
        throw new ApiError(code, message, status)
      }
      traceUpstreamStatus(response.status)
      throw unavailable()
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) { traceUpstreamFailure('invalid-response'); throw unavailable() }
    return parsed.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (response && !response.ok) traceUpstreamStatus(response.status)
    else if (fetched) traceUpstreamFailure(upstreamFailureType(error))
    throw unavailable()
  }
}

async function input<T>(c: PlanningContext, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
    throw new ApiError('INVALID_COMMAND', '请发送 JSON 命令', 400)
  try {
    if (!c.req.raw.body) throw new Error('empty')
    return schema.parse(JSON.parse(await readBoundedBody(c.req.raw.body, 32_768, 5_000)))
  } catch (error) {
    throw new ApiError(error instanceof BodyLimitError ? 'COMMAND_TOO_LARGE' : 'INVALID_COMMAND', '输入字段或内容无效', 400)
  }
}

export async function readPlanning(c: PlanningContext) {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    taskRange: taskRangeSchema.default('today'),
    taskPage: z.coerce.number().int().min(1).max(1_000_000).default(1),
    taskScope: taskScopeSchema.default('all'), search: planningSearchSchema.default(''), goalId: z.uuid().optional(),
    goalTaskPage: z.coerce.number().int().min(1).max(1_000_000).default(1),
    includeTerminal: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  }).strict().safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '分页参数无效', 400)
  return c.json(await rpc(c, 'adventure_workspace_read', { p_page: parsed.data.page, p_page_size: parsed.data.pageSize,
    p_task_range: parsed.data.taskRange, p_task_page: parsed.data.taskPage, p_task_scope: parsed.data.taskScope, p_search: parsed.data.search,
    p_goal_id: parsed.data.goalId ?? null, p_goal_task_page: parsed.data.goalTaskPage, p_include_terminal: parsed.data.includeTerminal }, planningPageSchema))
}

export async function previewPlanning(c: PlanningContext) {
  const value = await input(c, planningPreviewInputSchema)
  return c.json(await rpc(c, 'adventure_planning_preview', { p_expected_version: value.expectedVersion, p_command: value.command }, planningPreviewSchema))
}

export async function commandPlanning(c: PlanningContext) {
  if (c.req.header(adventureClientVersionHeader) !== adventureClientVersion)
    throw oldClientUnavailable()
  const value = await input(c, storedPlanningEnvelopeSchema)
  return c.json(await rpc(c, 'adventure_planning_command', {
    p_request_id: value.requestId, p_expected_version: value.expectedVersion, p_command: value.command,
  }, planningReceiptSchema))
}

// This is a read-only lookup: it must never fall through to a command when a receipt is absent.
export async function lookupPlanningReceipt(c: PlanningContext) {
  const value = await input(c, storedPlanningEnvelopeSchema)
  const receipt = await rpc(c, 'adventure_receipt_lookup', {
    p_request_id: value.requestId, p_command: value.command,
  }, planningReceiptSchema)
  c.header('X-Lifespace-Adventure-Model', adventureClientVersion)
  return c.json(receipt)
}

export async function readMigrationOptions(c: PlanningContext) {
  const parsed = z.strictObject({ kind: z.literal('task'), id: z.uuid(), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '迁移候选参数无效', 400)
  return c.json(await rpc(c, 'adventure_migration_options', { p_kind: parsed.data.kind, p_id: parsed.data.id, p_page: parsed.data.page }, migrationOptionsSchema))
}

export async function readTaskHistory(c: PlanningContext) {
  const parsed = z.strictObject({ id: z.uuid(), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '任务历史分页参数无效', 400)
  return c.json(await rpc(c, 'adventure_task_history', { p_task: parsed.data.id, p_page: parsed.data.page }, taskHistorySchema))
}

export async function readGrowth(c: PlanningContext) {
  const parsed = growthQuerySchema.safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '成长流水游标参数无效', 400)
  return c.json(await rpc(c, 'adventure_growth_read', { p_version: parsed.data.version ?? null, p_cursor: parsed.data.cursor ?? null }, growthPageSchema))
}

export async function readRewardSource(c: PlanningContext) {
  const parsed = rewardSourceQuerySchema.safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '奖励来源分页参数无效', 400)
  return c.json(await rpc(c, 'adventure_reward_source', { p_event: parsed.data.id, p_page: parsed.data.page, p_version: parsed.data.version ?? null }, rewardSourceSchema))
}

export async function readTaskList(c: PlanningContext) {
  if (Object.keys(c.req.query()).length) throw new ApiError('INVALID_QUERY', '任务查询条件请放入请求体', 400)
  const value = await input(c, taskListInputSchema)
  return c.json(await rpc(c, 'adventure_task_list', {
    p_date: value.date, p_scope: value.scope, p_expected_version: value.expectedVersion, p_today: value.today, p_page: value.page,
  }, taskListSchema))
}
