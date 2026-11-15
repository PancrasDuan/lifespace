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

describe.skipIf(!rpcUrl || !signingKey)('已退役绑定在真实 PostgREST 中不可访问', () => {
  it('所有角色都不能调用已删除的旧解析 RPC', async () => {
    for (const role of ['service_role', 'anon', 'authenticated']) {
      const response = await resolveOwner(role, 'synthetic-retired.access')
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'PGRST202' })
    }
  })
  it('服务端角色也不能查询已删除的旧绑定表', async () => {
    const response = await fetch(new URL('/agent_identity_bindings?select=client_id', rpcUrl), {
      headers: { Authorization: `Bearer ${roleToken('service_role')}` },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'PGRST205' })
  })
})
