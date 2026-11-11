import { strict as assert } from 'node:assert'
import { z } from 'zod'
import app from '../../worker/index'
import { growthSchema, planningProgressSchema, taskRangeSchema, taskScopeSchema, planningPageSchema, planningTaskSchema, planningReceiptSchema, type PlanningCommand } from '../../src/shared/adventure-planning'

export const localPlanningRpc = process.env.ADVENTURE_LOCAL_RPC_URL
const version = z.number().int().nonnegative().safe()
const capability = z.record(z.string(), z.object({ allowed: z.boolean(), reason: z.string().optional() }))
const goalModelGoal = z.object({ id: z.uuid(), title: z.string(), standards: z.array(z.string()), categoryLabel: z.string().nullable(),
  focused: z.boolean(), sortOrder: version, status: z.enum(['active', 'achieved', 'ended']), terminatedAt: z.string().nullable(),
  achievement: z.object({ id: z.uuid(), occurredOn: z.iso.date(), reflection: z.string(), reward: z.unknown() }).nullable(),
  createdAt: z.string(), progress: planningProgressSchema, capabilities: capability })
const goalModelPage = z.object({ version, today: z.iso.date(), includeTerminal: z.boolean(), page: z.number().int().positive(), pageSize: z.number().int().positive(), totalGoals: version,
  goals: z.array(goalModelGoal),
  goalDetail: z.object({ goal: goalModelGoal, tasks: z.array(planningTaskSchema), taskPage: z.number(), totalTasks: z.number() }).nullable().default(null),
  growth: growthSchema, tasks: z.array(planningTaskSchema), totalTasks: version, taskPage: z.number(), taskRange: taskRangeSchema,
  taskScope: taskScopeSchema, search: z.string(), taskProgress: planningProgressSchema, todayTaskProgress: planningProgressSchema,
  capabilities: capability, limits: z.object({ name: z.literal(200), standard: z.literal(4000), standards: z.literal(50) }),
})
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

// Identity and the RPC address are controlled; business requests still use the real Worker and database.
export function planningDatabase(email = 'lifecycle@example.invalid') {
  const env = {
    SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: email,
  }
  let previousFetch: typeof fetch | undefined
  const request = (owner: string, path = '/api/adventure', body?: unknown) => app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  const read = async (owner: string, query = '') => {
    const response = await request(owner, `/api/adventure${query}`)
    assert.equal(response.status, 200)
    return planningPageSchema.parse(await response.json())
  }
  // Temporary direct workspace fixture until the independently developed Worker
  // goal contract is integrated. Task and growth requests remain real HTTP.
  const readFourTable = async (owner: string, query = '') => {
    const target = new URL(localPlanningRpc!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password || !previousFetch) throw new Error('仅允许独立本机 RPC 验收')
    const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
    const response = await previousFetch(new URL('/rpc/adventure_workspace_read', target), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner,
        p_page: Number(q.get('page') ?? 1), p_page_size: Number(q.get('pageSize') ?? 20), p_task_range: q.get('taskRange') ?? 'today',
        p_task_page: Number(q.get('taskPage') ?? 1), p_task_scope: q.get('taskScope') ?? 'all', p_search: q.get('search') ?? '',
        p_goal_id: q.get('goalId'), p_goal_task_page: Number(q.get('goalTaskPage') ?? 1), p_include_terminal: q.get('includeTerminal') === 'true' }),
    })
    assert.equal(response.status, 200, await response.clone().text())
    return goalModelPage.parse(await response.json())
  }
  const envelope = (version: number, command: PlanningCommand) => ({ requestId: crypto.randomUUID(), expectedVersion: version, command })
  // Send an existing envelope unchanged, including intentionally stale versions and historical requestIds.
  const send = (owner: string, value: ReturnType<typeof envelope>) => request(owner, '/api/adventure/commands', value)
  const command = async (owner: string, value: PlanningCommand) => {
    const response = await send(owner, envelope((await read(owner)).version, value))
    assert.equal(response.status, 200)
    return planningReceiptSchema.parse(await response.json())
  }
  const commandFourTable = async (owner: string, value: PlanningCommand) => {
    const response = await send(owner, envelope((await readFourTable(owner)).version, value))
    assert.equal(response.status, 200, await response.clone().text())
    return planningReceiptSchema.parse(await response.json())
  }
  // Explicit fixture path, available only on the runner's loopback database.
  // It does not add a simulated date to any production Worker request.
  const historicalCommand = async (owner: string, value: ReturnType<typeof envelope>, occurredOn: string) => {
    const target = new URL(localPlanningRpc!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('仅允许独立本机 RPC 验收')
    if (!previousFetch) throw new Error('隔离运行环境尚未安装')
    const response = await previousFetch(new URL('/rpc/adventure_test_history_seed', target), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_owner: owner, p_request_id: value.requestId, p_expected_version: value.expectedVersion, p_command: value.command, p_occurred_on: occurredOn }),
    })
    assert.equal(response.status, 200)
    return planningReceiptSchema.parse(await response.json())
  }
  // Goal setup is temporarily sent directly to the isolated four-table RPC;
  // task and growth behavior under test still traverses the production Worker.
  const fixtureGoal = async (owner: string, version: number, value: { type: 'createGoal'; title: string; standards: string[]; categoryLabel?: string | null } | { type: 'editGoal'; id: string; title: string; standards: string[]; categoryLabel?: string | null }) => {
    const target = new URL(localPlanningRpc!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password || !previousFetch) throw new Error('仅允许独立本机 RPC 验收')
    const response = await previousFetch(new URL('/rpc/adventure_planning_command', target), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_owner: owner, p_request_id: crypto.randomUUID(), p_expected_version: version, p_command: value }),
    })
    assert.equal(response.status, 200, await response.clone().text())
    return planningReceiptSchema.parse(await response.json())
  }
  const fixtureFocused = async (owner: string, goal: string) => {
    const target = new URL(localPlanningRpc!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password || !previousFetch) throw new Error('仅允许独立本机 RPC 验收')
    const response = await previousFetch(new URL('/rpc/adventure_test_focus_seed', target), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner, p_goal: goal }),
    })
    assert.equal(response.status, 204, await response.clone().text())
  }
  const createHistoricalTask = async (owner: string, value: Extract<PlanningCommand, { type: 'createTask' }>, completedOn?: string) => {
    const receipt = await historicalCommand(owner, envelope((await read(owner)).version, value), value.plannedOn)
    if (completedOn) await historicalCommand(owner, envelope(receipt.version, { type: 'completeTask', id: receipt.result.entityId }), completedOn)
    return receipt
  }
  const createHistoricalTaskFourTable = async (owner: string, value: Extract<PlanningCommand, { type: 'createTask' }>, completedOn?: string) => {
    const receipt = await historicalCommand(owner, envelope((await readFourTable(owner)).version, value), value.plannedOn)
    if (completedOn) await historicalCommand(owner, envelope(receipt.version, { type: 'completeTask', id: receipt.result.entityId }), completedOn)
    return receipt
  }
  return {
    request, read, readFourTable, envelope, send, command, commandFourTable, fixtureGoal, fixtureFocused, historicalCommand, createHistoricalTask, createHistoricalTaskFourTable,
    install(options?: { browserOwner: string }) {
      const target = new URL(localPlanningRpc!)
      if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('仅允许独立本机 RPC 验收')
      if (previousFetch) throw new Error('隔离运行环境已安装')
      const nativeFetch = globalThis.fetch
      previousFetch = nativeFetch
      globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.origin !== env.SUPABASE_URL) {
          // Browser setup also needs unrelated HTTP requests; interface suites reject them.
          if (options) return nativeFetch(input, init)
          throw new Error('禁止非验收请求')
        }
        if (url.pathname === '/auth/v1/user') {
          const token = new Headers(init.headers).get('Authorization')
          const owner = options ? options.browserOwner : (JSON.parse(atob(token!.split('.')[1])) as { sub: string }).sub
          return Response.json({ id: owner, email, email_confirmed_at: '2026-10-21', is_anonymous: false })
        }
        if (!url.pathname.startsWith('/rest/v1/rpc/adventure_')) throw new Error('禁止非 RPC 请求')
        return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
      }
    },
    restore() {
      if (previousFetch) globalThis.fetch = previousFetch
      previousFetch = undefined
    },
  }
}
