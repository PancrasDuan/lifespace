import { z } from 'zod'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from '../auth'
import { readBoundedBody, BodyLimitError } from '../read-body'
import { ApiError } from '../upstream'
import {
  planningEnvelopeSchema, planningPageSchema, planningReceiptSchema, taskRangeSchema, taskScopeSchema, planningSearchSchema,
  planningPreviewInputSchema, planningPreviewSchema,
} from '../../src/shared/adventure-planning'

type PlanningContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
const unavailable = () => new ApiError('ADVENTURE_UNAVAILABLE', '暂时无法读取人生冒险，请稍后重试', 503)
const errors = {
  VERSION_CONFLICT: [409, '数据已更新，请重新读取后确认操作'],
  REQUEST_ID_REUSED: [409, '请求编号已用于其他操作，请重新确认'],
  FOCUS_LIMIT: [400, '每条主线或独立目标组最多聚焦 3 个目标'],
  MAINLINE_LIMIT: [400, '最多保留 5 条在用主线'],
  NOT_FOUND: [404, '内容不存在或不属于当前账户'],
  READ_ONLY: [400, '内容已进入终态，只能查看'],
  DATE_LOCKED: [400, '仅能完成今天的安排或取消今天的完成'],
  TASK_NOT_PENDING: [400, '仅待完成任务可以执行此操作'],
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
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ ...parameters, p_owner: c.get('identity').id }),
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    })
    if (!response.body) throw unavailable()
    const value: unknown = JSON.parse(await readBoundedBody(response.body, 1_048_576, 10_000))
    if (!response.ok) {
      const failure = z.object({ message: z.string() }).safeParse(value)
      const code = failure.success ? failure.data.message : ''
      if (Object.hasOwn(errors, code)) {
        const [status, message] = errors[code as keyof typeof errors]
        throw new ApiError(code, message, status)
      }
      throw unavailable()
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw unavailable()
    return parsed.data
  } catch (error) {
    if (error instanceof ApiError) throw error
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
  }).strict().safeParse(c.req.query())
  if (!parsed.success) throw new ApiError('INVALID_QUERY', '分页参数无效', 400)
  return c.json(await rpc(c, 'adventure_workspace_read', { p_page: parsed.data.page, p_page_size: parsed.data.pageSize,
    p_task_range: parsed.data.taskRange, p_task_page: parsed.data.taskPage, p_task_scope: parsed.data.taskScope, p_search: parsed.data.search, p_goal_id: parsed.data.goalId ?? null, p_goal_task_page: parsed.data.goalTaskPage }, planningPageSchema))
}

export async function previewPlanning(c: PlanningContext) {
  const value = await input(c, planningPreviewInputSchema)
  return c.json(await rpc(c, 'adventure_planning_preview', { p_expected_version: value.expectedVersion, p_command: value.command }, planningPreviewSchema))
}

export async function commandPlanning(c: PlanningContext) {
  const value = await input(c, planningEnvelopeSchema)
  return c.json(await rpc(c, 'adventure_planning_command', {
    p_request_id: value.requestId, p_expected_version: value.expectedVersion, p_command: value.command,
  }, planningReceiptSchema))
}
