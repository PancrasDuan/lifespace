import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../../worker/index'
import { planningApi } from '../../src/adventure/planning-api'
import { authorizedMutation } from '../../src/auth/request'
import { adventureClientVersion, adventureClientVersionHeader } from '../../src/shared/adventure-client-version'
import { recoveryRejectionCodeSchema } from '../../src/shared/adventure-recovery'

vi.mock('../../src/auth/request', () => ({ authorizedFetch: vi.fn(), authorizedMutation: vi.fn() }))
const owner = '00000000-0000-4000-8000-000000000224'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json', [adventureClientVersionHeader]: adventureClientVersion }
const envelope = { requestId: 'original-recovery-224', expectedVersion: 2, command: { type: 'createGoal' as const, title: '原目标', standards: ['标准'] } }
const legacy = { ...envelope, command: { ...envelope.command, destination: '' } }
const receipt = { version: 3, result: { entityId: owner, message: '已保存' } }
const calls: { path: string; body: unknown }[] = []
let rpcResult: unknown, rpcError: string | undefined, authDenied: boolean
const request = (body: unknown, extraHeaders = headers) => app.request('/api/adventure/recovery', { method: 'POST', headers: extraHeaders, body: JSON.stringify(body) }, env)
const recover = (value = envelope) => planningApi.recover(owner, value, new AbortController().signal)
beforeEach(() => {
  calls.length = 0; rpcResult = receipt; rpcError = undefined; authDenied = false
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/auth/v1/user') return authDenied ? Response.json({}, { status: 401 }) : Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    calls.push({ path, body: JSON.parse(String(init.body)) })
    return rpcError ? Response.json({ message: rpcError }, { status: 400 }) : Response.json(rpcResult)
  })
  vi.mocked(authorizedMutation).mockImplementation(async (_path, body, _signal, expectedOwner, _method, extraHeaders) => {
    expect(expectedOwner).toBe(owner)
    return request(JSON.parse(body), { ...headers, ...extraHeaders })
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

it('持久化当前封套一次性进入锁内幂等 RPC，不走缺失回执轮询，不改 ID、版本或命令', async () => {
  const original = structuredClone(envelope)
  expect(await recover()).toMatchObject({ requestId: envelope.requestId, outcome: 'confirmed', receipt })
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_planning_command', body: {
    p_owner: owner, p_request_id: envelope.requestId, p_expected_version: 2, p_command: envelope.command,
  } }])
  expect(authorizedMutation).toHaveBeenCalledTimes(1)
  expect(envelope).toEqual(original)
})

it.each(recoveryRejectionCodeSchema.options)('%s 返回与 nonce 关联的人工核对结果', async code => {
  rpcError = code
  expect(await recover()).toMatchObject({ outcome: 'review', code })
  expect(calls).toHaveLength(1)
})

it('原入口合法的大封套在添加 nonce 后仍可取回回执', async () => {
  const large = { ...envelope, command: { ...envelope.command, standards: [...Array<string>(8).fill('x'.repeat(4000)), ''] } }
  large.command.standards[8] = 'y'.repeat(32_720 - new TextEncoder().encode(JSON.stringify(large)).byteLength)
  expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBe(32_720)
  const original = await app.request('/api/adventure/commands', { method: 'POST', headers, body: JSON.stringify(large) }, env)
  expect(original.status).toBe(200)
  expect(await recover(large)).toMatchObject({ outcome: 'confirmed', receipt })
  expect(calls).toHaveLength(2)
  expect(calls[1].body).toEqual(calls[0].body)
})
it('旧模型不兼容的原封套仅查询；缺失允许人工核对，不改写为新命令', async () => {
  rpcError = 'RECEIPT_UNKNOWN'
  expect(await planningApi.recover(owner, legacy, new AbortController().signal)).toMatchObject({ outcome: 'review', code: 'LEGACY_RECEIPT_MISSING' })
  expect(calls).toEqual([{ path: '/rest/v1/rpc/adventure_receipt_lookup', body: {
    p_owner: owner, p_request_id: legacy.requestId, p_command: legacy.command,
  } }])
})

it.each([
  { type: 'createMainline', name: '旧方向' }, { type: 'renameMainline', id: owner, name: '旧方向' },
  { type: 'endMainline', id: owner }, { type: 'focusGoal', id: owner, focused: true },
  { type: 'migrateGoal', id: owner, destination: '' }, { type: 'migrateTask', id: owner, destination: '' },
  { type: 'rescheduleTask', id: owner, plannedOn: '2026-11-16' }, { type: 'endTask', id: owner },
  { type: 'editTask', id: owner, title: '历史编辑', description: '' },
])('可解析的已退役 $type 封套仍只查询；缺失须人工决定', async command => {
  rpcError = 'RECEIPT_UNKNOWN'
  const response = await request({ ...envelope, command, nonce: 'a'.repeat(64) })
  expect(await response.json()).toMatchObject({ outcome: 'review', code: 'LEGACY_RECEIPT_MISSING' })
  expect(calls.map(call => call.path)).toEqual(['/rest/v1/rpc/adventure_receipt_lookup'])
})
it.each(['REQUEST_ID_REUSED', 'REPLAY_UNAVAILABLE', 'INVALID_COMMAND', 'RECEIPT_UNKNOWN', 'private failure'])('当前封套 %s 保持未知，不能人工解除', async code => {
  rpcError = code
  await expect(recover()).rejects.toMatchObject({ uncertain: true })
  expect(calls).toHaveLength(1)
})

it.each(['REQUEST_ID_REUSED', 'REPLAY_UNAVAILABLE', 'VERSION_CONFLICT', 'private failure'])('旧封套 %s 不能变成缺失回执或可解除', async code => {
  rpcError = code
  await expect(planningApi.recover(owner, legacy, new AbortController().signal)).rejects.toMatchObject({ uncertain: true })
})

it('损坏 RPC 回执及认证失败均不产生可解除结果', async () => {
  rpcResult = { version: 3, result: {} }
  await expect(recover()).rejects.toMatchObject({ uncertain: true })
  calls.length = 0; authDenied = true
  await expect(recover()).rejects.toMatchObject({ uncertain: true })
  expect(calls).toEqual([])
})

it('旧写版本、损坏封套、额外 owner 及无效 nonce 不触达 RPC', async () => {
  expect((await request({ ...envelope, nonce: 'a'.repeat(64) }, { ...headers, [adventureClientVersionHeader]: 'goal-categories-1' })).status).toBe(503)
  for (const body of [{ ...envelope, nonce: 'bad' }, { ...envelope, nonce: 'a'.repeat(64), owner }, { ...envelope, requestId: 'bad', nonce: 'a'.repeat(64) }])
    expect((await request(body)).status).toBe(400)
  expect(calls).toEqual([])
})

it.each(['network', 'nonce', 'requestId', 'cache', 'header', 'receipt', 'wrong-review'])('客户端拒绝 %s 异常且不降级发送新请求', async scenario => {
  vi.mocked(authorizedMutation).mockImplementation(async (_path, body) => {
    if (scenario === 'network') throw new TypeError('offline')
    const { requestId, nonce } = JSON.parse(body)
    const result = scenario === 'wrong-review' ? { requestId, nonce, outcome: 'review', code: 'LEGACY_RECEIPT_MISSING' }
      : { requestId: scenario === 'requestId' ? 'other-id' : requestId, nonce: scenario === 'nonce' ? '0'.repeat(64) : nonce, outcome: 'confirmed', receipt: scenario === 'receipt' ? {} : receipt }
    return Response.json(result, { headers: { 'Cache-Control': scenario === 'cache' ? 'no-store, broken=' : 'no-store', 'X-Lifespace-Adventure-Recovery': scenario === 'header' ? 'other' : '1' } })
  })
  await expect(recover()).rejects.toMatchObject({ uncertain: true })
  expect(authorizedMutation).toHaveBeenCalledTimes(1)
  expect(calls).toEqual([])
})
