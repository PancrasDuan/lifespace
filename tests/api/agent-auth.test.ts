import { afterEach, expect, test, vi } from 'vitest'
import { verifyAgentUser } from '../../worker/agent-auth'
import { AuthTestKv, failingKv } from '../support/auth-kv'

const owner = '00000000-0000-4000-8000-000000000001'
const env = {
  SUPABASE_URL: 'https://auth-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
  SUPABASE_SECRET_KEY: 'sb_secret_test-only',
  AUTH_KV: new AuthTestKv('agent@example.invalid').binding(),
}
const user = { id: owner, email: 'agent@example.invalid', email_confirmed_at: '2026-11-01T00:00:00Z', is_anonymous: false }
afterEach(() => vi.unstubAllGlobals())

test.each([
  ['账户已删除', user, 404, env, 401],
  ['账户匿名', { ...user, is_anonymous: true }, 200, env, 401],
  ['邮箱未验证', { ...user, email_confirmed_at: null }, 200, env, 401],
  ['邮箱确认时间无效', { ...user, email_confirmed_at: 'not-a-date' }, 200, env, 401],
  ['账户身份不匹配', { ...user, id: '00000000-0000-4000-8000-000000000002' }, 200, env, 401],
  ['账户被封禁', { ...user, banned_until: '2099-01-01T00:00:00Z' }, 200, env, 401],
  ['账户软删除', { ...user, deleted_at: '2026-11-01T00:00:00Z' }, 200, env, 401],
  ['删除状态格式异常', { ...user, deleted_at: '' }, 200, env, 401],
  ['移出白名单', user, 200, { ...env, AUTH_KV: new AuthTestKv('another@example.invalid').binding() }, 403],
  ['KV 缺失', user, 200, { ...env, AUTH_KV: undefined }, 503],
  ['键缺失', user, 200, { ...env, AUTH_KV: new AuthTestKv(null).binding() }, 503],
  ['空值', user, 200, { ...env, AUTH_KV: new AuthTestKv('').binding() }, 503],
  ['格式错误', user, 200, { ...env, AUTH_KV: new AuthTestKv('agent@example.invalid,invalid').binding() }, 503],
  ['KV 读取失败', user, 200, { ...env, AUTH_KV: failingKv('agent@example.invalid') }, 503],
  ['用户服务故障', user, 503, env, 503],
] as const)('%s 时拒绝 OAuth grant 的用户准入', async (_label, currentUser, userStatus, bindings, expected) => {
  const upstream = vi.fn(async () => Response.json(currentUser, { status: userStatus }))
  vi.stubGlobal('fetch', upstream)
  await expect(verifyAgentUser(bindings, owner)).rejects.toMatchObject({ status: expected })
  expect(upstream).toHaveBeenCalledOnce()
})

test('每次重新在线核验用户，移出白名单后不能复用先前身份', async () => {
  const upstream = vi.fn(async () => Response.json(user))
  vi.stubGlobal('fetch', upstream)
  const kv = new AuthTestKv('agent@example.invalid')
  expect(await verifyAgentUser({ ...env, AUTH_KV: kv.binding() }, owner)).toEqual({ id: owner, email: user.email })
  kv.value = 'removed@example.invalid'
  await expect(verifyAgentUser({ ...env, AUTH_KV: kv.binding() }, owner)).rejects.toMatchObject({ status: 403 })
  expect(upstream).toHaveBeenCalledTimes(2)
  expect(kv.reads).toBe(2)
})

test.each([
  ['新格式密钥', 'sb_secret_test-only', null],
  ['旧 JWT 格式密钥', 'eyJ-test-only', 'Bearer eyJ-test-only'],
] as const)('%s 只发给在线用户核验接口，兼容 URL 尾斜杠', async (_label, secret, bearer) => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(`${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`)
    const headers = new Headers(init?.headers)
    expect(headers.get('apikey')).toBe(secret)
    expect(headers.get('Authorization')).toBe(bearer)
    return Response.json(user)
  }))
  expect(await verifyAgentUser({ ...env, SUPABASE_URL: env.SUPABASE_URL + '/', SUPABASE_SECRET_KEY: secret }, owner)).toEqual({ id: owner, email: user.email })
})

test('缺少服务端密钥时拒绝核验且不请求上游', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  await expect(verifyAgentUser({ ...env, SUPABASE_SECRET_KEY: undefined }, owner)).rejects.toMatchObject({ status: 503 })
  expect(upstream).not.toHaveBeenCalled()
})
