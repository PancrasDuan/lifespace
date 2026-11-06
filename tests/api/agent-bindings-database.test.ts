import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const rpcUrl = process.env.LEDGER_LOCAL_RPC_URL
const signingKey = process.env.LEDGER_LOCAL_JWT_SECRET

function roleToken(role: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 300 })}`
  return `${payload}.${createHmac('sha256', signingKey!).update(payload).digest('base64url')}`
}

async function resolveOwner(role: string, clientId: string) {
  return fetch(new URL('/rpc/agent_resolve_owner', rpcUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${roleToken(role)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_client_id: clientId }),
  })
}

describe.skipIf(!rpcUrl || !signingKey)('Agent 绑定的真实 PostgREST RPC 边界', () => {
  it('服务端凭据能解析已启用的合成绑定，未知凭据返回 null', async () => {
    const active = await resolveOwner('service_role', 'synthetic-http-active.access')
    expect(active.status).toBe(200)
    expect(await active.json()).toEqual({ ownerId: '00000000-0000-4000-8000-000000000007' })
    const missing = await resolveOwner('service_role', 'synthetic-http-missing.access')
    expect(missing.status).toBe(200)
    expect(await missing.json()).toBeNull()
  })
  it('匿名与普通登录角色不能调用绑定解析 RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      const response = await resolveOwner(role, 'synthetic-http-active.access')
      expect([401, 403, 404]).toContain(response.status)
    }
  })
})
