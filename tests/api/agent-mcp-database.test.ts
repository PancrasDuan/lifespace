import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import app from '../../worker/index'
import { installLedgerDatabase, ledgerEnv, ledgerTestAccount } from '../support/ledger-database'

const rpcUrl = process.env.LEDGER_LOCAL_RPC_URL
const owner = '00000000-0000-4000-8000-000000000007'
const other = '00000000-0000-4000-8000-000000000008'
const team = 'https://agent-test.cloudflareaccess.com'
const audience = 'test-agent-audience'
const clientId = 'synthetic-http-active.access'
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const signed = () => {
  const value = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: team, aud: audience, exp: Math.floor(Date.now() / 1000) + 300, sub: '', common_name: clientId })}`
  return `${value}.${sign('RSA-SHA256', Buffer.from(value), pair.privateKey).toString('base64url')}`
}
const env = { ...ledgerEnv, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience }
const nativeFetch = globalThis.fetch
let restore: () => void

describe.skipIf(!rpcUrl)('Agent 通过真实隔离账单数据库操作', () => {
  beforeAll(() => {
    const target = new URL(rpcUrl!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('仅允许本机隔离数据库')
    restore = installLedgerDatabase()
    const ledgerFetch = globalThis.fetch
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.href === `${team}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
      if (url.origin === env.SUPABASE_URL && url.pathname === '/rest/v1/rpc/agent_resolve_owner') return nativeFetch(new URL('/rpc/agent_resolve_owner', target), init)
      if (url.origin === env.SUPABASE_URL && url.pathname === `/auth/v1/admin/users/${owner}`) return Response.json({ id: owner, email: 'ledger@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false })
      return ledgerFetch(input, init)
    }
  })
  afterAll(() => { restore?.() })

  it('创建同一流水的重试只更新一次余额，不能使用他人账户', async () => {
    const accountId = await ledgerTestAccount(owner, 'Agent 测试账户')
    const otherAccountId = await ledgerTestAccount(other, '其他测试账户')
    const entry = { requestId: '00000000-0000-4000-8000-000000000091', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId, categoryCode: 'dining', note: '午饭' }
    async function call(name: string, args: object) {
      const response = await app.request('/api/agent/mcp', {
        method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': signed(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }, env)
      expect(response.status).toBe(200)
      return await response.json() as { result: { isError?: boolean; structuredContent: Record<string, unknown> } }
    }
    const first = await call('create_ledger_entry', entry)
    const retry = await call('create_ledger_entry', entry)
    expect(retry.result.structuredContent).toEqual(first.result.structuredContent)
    const foreign = await call('create_ledger_entry', { ...entry, requestId: '00000000-0000-4000-8000-000000000092', accountId: otherAccountId })
    expect(foreign.result).toMatchObject({ isError: true, structuredContent: { code: 'ACCOUNT_NOT_FOUND' } })
    const accounts = await call('list_ledger_accounts', {})
    expect(accounts.result.structuredContent).toMatchObject({ accounts: [{ id: accountId, balanceCents: -3500 }] })
  })
})
