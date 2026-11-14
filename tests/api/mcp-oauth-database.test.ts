import { afterEach, describe, expect, test, vi } from 'vitest'
import { oauthFixture, oauthOther, oauthOwner, oauthIssuer } from '../support/mcp-oauth'
import { mcpScopes } from '../../worker/mcp-oauth-config'

const rpcUrl = process.env.LEDGER_LOCAL_RPC_URL
afterEach(() => vi.unstubAllGlobals())
describe.skipIf(!rpcUrl)('OAuth 使用真实隔离 PostgreSQL/PostgREST', () => {
  test('同意、code、owner、账单幂等、退款与撤销覆盖真实数据库', async () => {
    const f = oauthFixture(rpcUrl)
    const client = await f.client()
    const owner = await f.issue(client.clientId)
    const other = await f.issue(client.clientId, [mcpScopes[0]], oauthOther)
    const accountResponse = await f.browser('/api/ledger/accounts', { requestId: crypto.randomUUID(), name: 'OAuth 合成账户', balanceCents: 0 })
    expect(accountResponse.status).toBe(200)
    const { accountId } = await accountResponse.json() as { accountId: string }
    const args = { requestId: crypto.randomUUID(), direction: 'expense', amountCents: -1500, occurredAt: '2026-01-02T03:04:05Z', accountId, categoryCode: 'dining', note: 'OAuth 合成测试' }
    const first = await f.mcp(owner.access_token, 'create_ledger_entry', args)
    const created = await first.json() as { result: { structuredContent: { entryId: string; version: number } } }
    expect(created.result.structuredContent.entryId).toBeTruthy()
    const retry = await f.mcp(owner.access_token, 'create_ledger_entry', args)
    expect(await retry.json()).toEqual(created)
    const refund = await f.mcp(owner.access_token, 'create_ledger_refund', { id: created.result.structuredContent.entryId, requestId: crypto.randomUUID(), amountCents: 500, occurredAt: '2026-01-02T03:04:05Z', note: '合成退款' })
    expect(await refund.json()).toMatchObject({ result: { structuredContent: { entryId: expect.any(String) } } })
    const accounts = await f.mcp(owner.access_token, 'list_ledger_accounts')
    expect(await accounts.json()).toMatchObject({ result: { structuredContent: { accounts: expect.arrayContaining([expect.objectContaining({ id: accountId, balanceCents: -1000 })]) } } })
    const foreign = await f.mcp(other.access_token, 'list_ledger_accounts')
    expect(JSON.stringify(await foreign.json())).not.toContain(accountId)
    const list = await f.browser('/api/oauth/grants')
    const { grants } = await list.json() as { grants: { id: string; clientId: string }[] }
    const grant = grants.find(grant => grant.clientId === client.clientId)!
    expect(grant).toBeTruthy()
    expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id }, oauthOther)).status).toBe(404)
    f.kv.ignoreDeletes = true
    expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id })).status).toBe(200)
    expect((await f.mcp(owner.access_token)).status).toBe(401)
    expect((await f.tokenRequest({ grant_type: 'refresh_token', refresh_token: owner.refresh_token, client_id: client.clientId })).status).toBe(400)
    expect((await f.mcp(other.access_token)).status).toBe(200)
  })

  test('数据库原子阻止跨边缘 code 重放，并以撤销提交为新的解析边界', async () => {
    const f = oauthFixture(rpcUrl)
    const client = await f.client()
    const consent = await f.approve(client.clientId)
    const snapshot = new Map(f.kv.records)
    const params = { grant_type: 'authorization_code', code: consent.code, code_verifier: consent.verifier, client_id: client.clientId, redirect_uri: 'http://127.0.0.1:19234/callback', resource: oauthIssuer + '/api/agent/mcp' }
    expect((await f.tokenRequest(params)).status).toBe(200)
    f.kv.records = snapshot
    expect((await f.tokenRequest(params)).status).toBe(400)
    const [grant] = (await (await f.browser('/api/oauth/grants')).json() as { grants: { id: string }[] }).grants
    expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id }, oauthOwner)).status).toBe(200)
    f.kv.records = new Map(snapshot)
    expect((await f.tokenRequest(params)).status).toBe(400)
  })

  test('撤销与在途调用并发：已通过检查的调用可完成，之后的新解析被主库拒绝', async () => {
    const f = oauthFixture(rpcUrl)
    const client = await f.client()
    const token = await f.issue(client.clientId, [mcpScopes[0]])
    const { grants } = await (await f.browser('/api/oauth/grants')).json() as { grants: { id: string; clientId: string }[] }
    const grant = grants.find(grant => grant.clientId === client.clientId)!
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const hold = new Promise<void>(resolve => { release = resolve })
    f.setRpcGate(async name => { if (name === 'ledger_accounts_list') { started(); await hold } })
    const pending = f.mcp(token.access_token, 'list_ledger_accounts')
    await entered
    try {
      f.kv.ignoreDeletes = true
      expect((await f.browser('/api/oauth/grants/revoke', { id: grant.id })).status).toBe(200)
      expect((await f.mcp(token.access_token)).status).toBe(401)
    } finally { release() }
    expect((await pending).status).toBe(200)
  })
})
