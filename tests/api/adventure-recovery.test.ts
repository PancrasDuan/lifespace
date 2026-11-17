import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import { planningApi, PlanningError } from '../../src/adventure/planning-api'
import { authorizedFetch, authorizedMutation } from '../../src/auth/request'
import { adventureClientVersion, adventureClientVersionHeader } from '../../src/shared/adventure-client-version'
import { canRetryPlanningEnvelope, storedPlanningEnvelopeSchema } from '../../src/shared/adventure-recovery'
import { authEnv } from '../support/auth-kv'

vi.mock('../../src/auth/request', () => ({ authorizedFetch: vi.fn(), authorizedMutation: vi.fn() }))
const owner = '00000000-0000-4000-8000-000000000224'
const env = authEnv('planning@example.com', { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only' })
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json', [adventureClientVersionHeader]: adventureClientVersion }
const envelope = { requestId: 'original-recovery-224', expectedVersion: 2, command: { type: 'createGoal' as const, title: '原目标', standards: ['标准'] } }
const legacy = { ...envelope, command: { ...envelope.command, destination: '' } }
const receipt = { version: 3, result: { entityId: owner, message: '已保存' } }
const calls: { path: string; body: unknown }[] = []
let rpcResult: unknown, rpcError: string | undefined, authDenied: boolean
const request = (path: string, body?: unknown) => app.request(path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }, env)
const retry = () => planningApi.send(owner, envelope, new AbortController().signal)
const lookup = () => planningApi.lookupReceipt(owner, legacy, new AbortController().signal)
beforeEach(() => {
  calls.length = 0; rpcResult = receipt; rpcError = undefined; authDenied = false
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/auth/v1/user') return authDenied ? Response.json({}, { status: 401 }) : Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ path, body: JSON.parse(String(init.body)) })
    return rpcError ? Response.json({ message: rpcError }, { status: 400 }) : Response.json(rpcResult)
  })
  vi.mocked(authorizedFetch).mockImplementation(async path => request(path))
  vi.mocked(authorizedMutation).mockImplementation(async (path, body, _signal, expectedOwner) => {
    expect(expectedOwner).toBe(owner)
    return request(path, JSON.parse(body))
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

it('原封套直接复用 commands 与锁内幂等 RPC，不改 ID、版本或命令', async () => {
  const original = structuredClone(envelope)
  expect(await retry()).toEqual(receipt)
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_planning_command', body: {
    p_owner: owner, p_request_id: envelope.requestId, p_expected_version: 2, p_command: envelope.command,
  } }])
  expect(authorizedMutation).toHaveBeenCalledTimes(1)
  expect(envelope).toEqual(original)
})
it.each(['VERSION_CONFLICT', 'PLANNING_DATE_CHANGED', 'COMPLETION_CHANGED', 'RESCHEDULE_PAST', 'DATE_LOCKED', 'NOT_FOUND', 'READ_ONLY', 'PERIOD_FULL'])('%s 复用严格 code/status 判断，允许人工核对', async code => {
  rpcError = code
  const failure = await retry().catch(error => error)
  expect(failure).toBeInstanceOf(PlanningError)
  expect(failure.allowsPendingReview).toBe(true)
})
it('原入口合法的大封套恢复不增加传输元数据', async () => {
  const large = { ...envelope, command: { ...envelope.command, standards: [...Array<string>(8).fill('x'.repeat(4000)), ''] } }
  large.command.standards[8] = 'y'.repeat(32_720 - new TextEncoder().encode(JSON.stringify(large)).byteLength)
  expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBe(32_720)
  expect(await planningApi.send(owner, large, new AbortController().signal)).toEqual(receipt)
  expect(JSON.parse(vi.mocked(authorizedMutation).mock.calls[0][1])).toEqual(large)
})
it('旧封套缺失回执保留原关联字段，不发送写入', async () => {
  rpcError = 'RECEIPT_UNKNOWN'
  await expect(lookup()).rejects.toMatchObject({ code: 'RECEIPT_UNKNOWN', status: 404 })
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_receipt_lookup', body: {
    p_owner: owner, p_request_id: legacy.requestId, p_command: legacy.command,
  } }])
})
it.each([
  { type: 'createMainline', name: '旧方向' }, { type: 'renameMainline', id: owner, name: '旧方向' },
  { type: 'endMainline', id: owner }, { type: 'focusGoal', id: owner, focused: true },
  { type: 'migrateGoal', id: owner, destination: '' }, { type: 'migrateTask', id: owner, destination: '' },
  { type: 'rescheduleTask', id: owner, plannedOn: '2026-11-16' }, { type: 'endTask', id: owner },
  { type: 'editTask', id: owner, title: '历史编辑', description: '' }, legacy.command,
])('可解析的历史 $type 不被误判为当前可执行封套', command => {
  expect(canRetryPlanningEnvelope(storedPlanningEnvelopeSchema.parse({ ...envelope, command }))).toBe(false)
})
it.each(['REQUEST_ID_REUSED', 'REPLAY_UNAVAILABLE', 'INVALID_COMMAND', 'COMMAND_TOO_LARGE', 'RECEIPT_UNKNOWN', 'private failure'])('当前封套 %s 不允许人工解除', async code => {
  rpcError = code
  const failure = await retry().catch(error => error)
  expect(failure.allowsPendingReview).toBe(false)
})
it.each(['REQUEST_ID_REUSED', 'REPLAY_UNAVAILABLE', 'VERSION_CONFLICT', 'private failure'])('旧封套 %s 保持未知', async code => {
  rpcError = code
  await expect(lookup()).rejects.toMatchObject({ uncertain: true })
})
it('损坏回执及认证失败不允许人工解除', async () => {
  rpcResult = { version: 3, result: {} }
  expect((await retry().catch(error => error)).allowsPendingReview).toBe(false)
  calls.length = 0; authDenied = true
  expect((await retry().catch(error => error)).allowsPendingReview).toBe(false)
  expect(calls).toEqual([])
})
it.each(['network', 'nonce', 'requestId', 'cache', 'unbound', 'wrong-status'])('旧封套缺失回执的 %s 异常仍保持未知', async scenario => {
  vi.mocked(authorizedMutation).mockImplementation(async (_path, body) => {
    if (scenario === 'network') throw new TypeError('offline')
    const { requestId, nonce } = JSON.parse(body)
    return Response.json({ ...(scenario === 'unbound' ? {} : { requestId: scenario === 'requestId' ? 'other' : requestId, nonce: scenario === 'nonce' ? '0'.repeat(64) : nonce }), error: { code: 'RECEIPT_UNKNOWN', message: '缺失' } }, {
      status: scenario === 'wrong-status' ? 409 : 404, headers: { 'Cache-Control': scenario === 'cache' ? 'no-store, broken=' : 'no-store' },
    })
  })
  await expect(lookup()).rejects.toMatchObject({ uncertain: true })
  expect(authorizedMutation).toHaveBeenCalledTimes(1)
})
it('错误码与 HTTP 状态不一致不允许人工解除', () => {
  expect(new PlanningError('冲突', 400, false, 'VERSION_CONFLICT').allowsPendingReview).toBe(false)
})
