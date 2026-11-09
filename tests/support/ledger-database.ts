import { ledgerAccountReceiptSchema } from '../../src/shared/ledger'
import app from '../../worker/index'

export const ledgerRpc = process.env.LEDGER_LOCAL_RPC_URL
const nativeFetch = globalThis.fetch
export const ledgerEnv = {
  SUPABASE_URL: 'https://ledger-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'ledger@example.invalid',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
export function ledgerRequest(owner: string, path = '/api/ledger/entries', body?: unknown, method?: string) {
  return app.request(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, ledgerEnv)
}
// Control only identity and the database address; all business code and RPCs are real.
export function installLedgerDatabase() {
  const target = new URL(ledgerRpc!)
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('仅允许本机隔离数据库')
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== ledgerEnv.SUPABASE_URL) return nativeFetch(input, init)
    if (url.pathname === '/auth/v1/user') {
      const token = new Headers(init?.headers).get('Authorization')!.split('.')[1]
      const { sub } = JSON.parse(atob(token)) as { sub: string }
      return Response.json({ id: sub, email: 'ledger@example.invalid', email_confirmed_at: '2026-10-01', is_anonymous: false })
    }
    if (!url.pathname.startsWith('/rest/v1/rpc/ledger_')) throw new Error('禁止非账单 RPC 请求')
    return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
  }
  return () => { globalThis.fetch = nativeFetch }
}
// Fixture preparation uses the same real account command as the page.
const testAccounts = new Map<string, Promise<string>>()
export function ledgerTestAccount(owner: string, name = '招商储蓄卡') {
  const key = owner + ':' + name
  let account = testAccounts.get(key)
  if (!account) {
    account = (async () => {
      const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents: 0 })
      if (response.status !== 200) throw new Error('隔离账户 fixture 创建失败')
      return ledgerAccountReceiptSchema.parse(await response.json()).accountId
    })()
    testAccounts.set(key, account)
  }
  return account
}
export const ordinaryEntry = async (owner: string, overrides: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(), direction: 'expense', amountCents: -100000,
  occurredAt: '2026-01-02T03:04:05.000Z', accountId: overrides.accountId ?? await ledgerTestAccount(owner), categoryCode: 'investment', note: '买入', ...overrides,
})
