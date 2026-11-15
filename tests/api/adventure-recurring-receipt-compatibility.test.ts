import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import app from '../../worker/index'
import { planningApi } from '../../src/adventure/planning-api'
import { authorizedFetch, authorizedMutation } from '../../src/auth/request'
import { adventureClientVersion, recurringAdventureClientVersion } from '../../src/shared/adventure-client-version'

// Model #199's future write-gate switch through the existing module seam.
// The production read protocol must stay unchanged; no runtime test switch exists.
vi.mock('../../src/shared/adventure-client-version', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/shared/adventure-client-version')>()
  return { ...actual, adventureClientVersion: actual.recurringAdventureClientVersion }
})
vi.mock('../../src/auth/request', () => ({ authorizedFetch: vi.fn(), authorizedMutation: vi.fn() }))

const owner = '00000000-0000-4000-8000-000000000054'
const env = { SUPABASE_URL: 'https://planning-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_planning-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_planning-test-only', AUTH_ALLOWED_EMAILS: 'planning@example.com' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const headers = { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.signature`, 'Content-Type': 'application/json' }
const receipt = { version: 3, result: { entityId: owner, message: '已保存' } }
const pending = { requestId: 'legacy-receipt-upgrade-01', expectedVersion: 2, command: { type: 'createGoal' as const, title: '旧目标', standards: ['标准'], destination: '' } }
const rpcCalls: { path: string; body: unknown }[] = []
let rpcError: string | undefined

// Frozen 7730a2f client recovery checks: strict four-field probe and literal
// response-model comparison. This minimal receipt is valid under that client.
// Deliberately do not import the current protocol constants/schema here.
const legacyProbeSchema = z.strictObject({ model: z.literal('goal-categories'), version: z.literal(1), receiptLookup: z.literal(true), legacyRetry: z.literal(false) })
async function legacyLookup(envelope: typeof pending) {
  const probe = await app.request('/api/adventure/compatibility', { headers }, env)
  if (!probe.ok || probe.headers.get('Cache-Control') !== 'no-store' || !legacyProbeSchema.safeParse(await probe.json()).success) throw new Error('legacy result unknown')
  const nonce = 'a'.repeat(64)
  const response = await app.request('/api/adventure/receipts/lookup', { method: 'POST', headers, body: JSON.stringify({ ...envelope, nonce }) }, env)
  if (!response.ok || response.headers.get('X-Lifespace-Adventure-Model') !== 'goal-categories-1' || response.headers.get('Cache-Control') !== 'no-store') throw new Error('legacy result unknown')
  const value = z.strictObject({ requestId: z.string(), nonce: z.string(), receipt: z.object({ version: z.number().int().nonnegative().safe(), result: z.object({ entityId: z.uuid(), message: z.string() }) }) }).parse(await response.json())
  if (value.requestId !== envelope.requestId || value.nonce !== nonce) throw new Error('legacy result unknown')
  return value.receipt
}

beforeEach(() => {
  rpcCalls.length = 0
  rpcError = undefined
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/auth/v1/user') return Response.json({ id: owner, email: 'planning@example.com', email_confirmed_at: '2026-10-20', is_anonymous: false })
    rpcCalls.push({ path, body: JSON.parse(String(init.body)) })
    return rpcError ? Response.json({ message: rpcError }, { status: 400 }) : Response.json(receipt)
  })
  vi.mocked(authorizedFetch).mockImplementation(async (path, _signal, expectedOwner) => {
    expect(expectedOwner).toBe(owner)
    return app.request(path, { headers }, env)
  })
  vi.mocked(authorizedMutation).mockImplementation(async (path, body, _signal, expectedOwner, method = 'POST', extraHeaders = {}) => {
    expect(expectedOwner).toBe(owner)
    return app.request(path, { method, headers: { ...headers, ...extraHeaders }, body }, env)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

it('写门禁切为recurring-1后旧页面仍以原封套读取旧成功回执', async () => {
  expect(adventureClientVersion).toBe('recurring-1')
  const original = structuredClone(pending)
  expect(await legacyLookup(pending)).toEqual(receipt)
  expect(pending).toEqual(original)
  expect(rpcCalls).toEqual([{ path: '/rest/v1/rpc/adventure_receipt_lookup', body: { p_owner: owner, p_request_id: pending.requestId, p_command: pending.command } }])
})

it('切换后的新客户端通过相同探针和回执协议读取旧及周期pending，不调用command RPC', async () => {
  const recurring = { requestId: 'recurring-receipt-upgrade-01', expectedVersion: 2, command: { type: 'recordRecurringCompletion' as const, id: owner, today: '2026-11-15' } }
  for (const envelope of [pending, recurring]) {
    expect(await planningApi.lookupReceipt(owner, envelope, new AbortController().signal)).toEqual(receipt)
  }
  expect(rpcCalls.map(call => call.path)).toEqual(['/rest/v1/rpc/adventure_receipt_lookup', '/rest/v1/rpc/adventure_receipt_lookup'])
  expect(vi.mocked(authorizedMutation).mock.calls.every(call => call[5] === undefined)).toBe(true)
})

it('保留旧只读恢复不放开旧目标写或legacy-retry，新客户端写仍须recurring-1', async () => {
  for (const command of [{ type: 'endGoal', id: owner }, { type: 'achieveGoal', id: owner, coefficient: 2 }]) {
    const response = await app.request('/api/adventure/commands', { method: 'POST', headers: { ...headers, 'X-Adventure-Client-Version': 'goal-categories-1' }, body: JSON.stringify({ ...pending, command }) }, env)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' } })
  }
  expect((await app.request('/api/adventure/legacy-retry', { method: 'POST', headers, body: JSON.stringify(pending) }, env)).status).toBe(503)
  expect(rpcCalls).toEqual([])
  expect(await planningApi.send(owner, { requestId: 'recurring-gate-create-01', expectedVersion: 2, command: { type: 'createGoal', title: '新目标', standards: ['标准'] } }, new AbortController().signal)).toEqual(receipt)
  expect(vi.mocked(authorizedMutation).mock.calls[0][5]).toEqual({ 'X-Adventure-Client-Version': recurringAdventureClientVersion })
  expect(rpcCalls.map(call => call.path)).toEqual(['/rest/v1/rpc/adventure_planning_command'])
})

it.each(['RECEIPT_UNKNOWN', 'REQUEST_ID_REUSED', 'REPLAY_UNAVAILABLE', 'private failure'])('切换后回执%s仍为未知，无自动写入或改封套', async error => {
  rpcError = error
  const original = structuredClone(pending)
  await expect(legacyLookup(pending)).rejects.toThrow('legacy result unknown')
  await expect(planningApi.lookupReceipt(owner, pending, new AbortController().signal)).rejects.toMatchObject({ uncertain: true })
  expect(pending).toEqual(original)
  expect(rpcCalls).toHaveLength(2)
  expect(rpcCalls.every(call => call.path === '/rest/v1/rpc/adventure_receipt_lookup')).toBe(true)
})
