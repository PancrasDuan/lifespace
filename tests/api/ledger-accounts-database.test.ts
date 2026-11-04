import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import app from '../../worker/index'
import { ledgerAccountReceiptSchema, ledgerAccountsSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerEnv, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

const read = async (owner: string) => {
  const response = await ledgerRequest(owner, '/api/ledger/accounts')
  expect(response.status).toBe(200)
  return ledgerAccountsSchema.parse(await response.json())
}
const create = async (owner: string, overrides: Record<string, unknown> = {}) => {
  const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '零钱', balanceCents: 0, ...overrides })
  expect(response.status).toBe(200)
  return ledgerAccountReceiptSchema.parse(await response.json())
}
const patch = (owner: string, id: string, fields: Record<string, unknown>) => ledgerRequest(owner, `/api/ledger/accounts/${id}`, { requestId: crypto.randomUUID(), ...fields }, 'PATCH')

describe.skipIf(!ledgerRpc)('本人交易账户：正式 HTTP → 隔离 PostgreSQL/PostgREST', () => {
  let restore: () => void
  beforeEach(() => { restore = installLedgerDatabase() })
  afterEach(() => restore())

  it('旧改名请求重试保留后续名称与收支余额，回执仍指向原账户且不推进版本', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner, { balanceCents: 100000 })
    const rename = { requestId: crypto.randomUUID(), name: '工资卡' }
    expect((await patch(owner, accountId, rename)).status).toBe(200)
    expect((await patch(owner, accountId, { name: '现用卡' })).status).toBe(200)
    expect((await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId, amountCents: -10000 }))).status).toBe(200)
    const before = await read(owner)
    expect(before).toMatchObject({ version: 4, accounts: [{ id: accountId, name: '现用卡', balanceCents: 90000 }] })
    const retry = await patch(owner, accountId, rename)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ accountId, version: 4 })
    expect(await read(owner)).toEqual(before)
  })

  it('改名请求核对规范化名称、账户及完整修改字段，同号不同输入返回 REQUEST_ID_REUSED', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner)
    const rename = { requestId: crypto.randomUUID(), name: '工资卡' }
    expect((await patch(owner, accountId, rename)).status).toBe(200)
    expect((await patch(owner, accountId, { ...rename, name: ' \u3000工资卡\t' })).status).toBe(200)
    const other = await create(owner, { name: '饭卡' }), before = await read(owner)
    for (const fields of [{ name: '别名' }, {}, { name: '工资卡', balanceCents: 0, expectedBalanceCents: 0 }]) {
      const response = await patch(owner, accountId, { requestId: rename.requestId, ...fields })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    const reused = await patch(owner, other.accountId, rename)
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    expect(await read(owner)).toEqual(before)
    // The same request number belongs to a different namespace for another owner.
    const otherOwner = crypto.randomUUID(), otherAccount = await create(otherOwner)
    expect((await patch(otherOwner, otherAccount.accountId, rename)).status).toBe(200)
  })

  for (const [label, fields] of [
    ['混合修改', { name: '工资卡', balanceCents: 90000, expectedBalanceCents: 100000 }],
    ['余额修正', { balanceCents: 90000, expectedBalanceCents: 100000 }],
    ['改名并提交未变余额', { name: '工资卡', balanceCents: 100000, expectedBalanceCents: 100000 }],
  ] as const) it(`${label}的旧请求先识别成功重试，不覆盖后续名称和余额`, async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner, { balanceCents: 100000 })
    const original = { requestId: crypto.randomUUID(), ...fields }
    expect((await patch(owner, accountId, original)).status).toBe(200)
    expect((await patch(owner, accountId, { name: '现用卡' })).status).toBe(200)
    expect((await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId, amountCents: -10000 }))).status).toBe(200)
    const before = await read(owner)
    expect(before).toMatchObject({ version: 4, accounts: [{ name: '现用卡', balanceCents: label === '改名并提交未变余额' ? 90000 : 80000 }] })
    const retry = await patch(owner, accountId, original)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ accountId, version: 4 })
    expect(await read(owner)).toEqual(before)
  })

  for (const [label, fields] of [
    ['空修改', {}], ['同名', { name: '零钱' }],
    ['同余额', { balanceCents: 100, expectedBalanceCents: 100 }],
    ['同名同余额', { name: '零钱', balanceCents: 100, expectedBalanceCents: 100 }],
  ] as const) it(`当初${label}的成功请求在后续改名和收支后重试，保留当前状态与版本`, async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner, { balanceCents: 100 })
    const before = await read(owner), noop = { requestId: crypto.randomUUID(), ...fields }
    const response = await patch(owner, accountId, noop)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accountId, version: 1 })
    expect(await read(owner)).toEqual(before)
    expect((await patch(owner, accountId, { name: '现用卡', balanceCents: 200, expectedBalanceCents: 100 })).status).toBe(200)
    expect((await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId, amountCents: -10 }))).status).toBe(200)
    const latest = await read(owner)
    expect(latest).toMatchObject({ version: 3, accounts: [{ name: '现用卡', balanceCents: 190 }] })
    const retry = await patch(owner, accountId, noop)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ accountId, version: 3 })
    const reused = await patch(owner, accountId, { ...noop, name: '别名' })
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    expect(await read(owner)).toEqual(latest)
  })

  it('并发改名同号只推进一次版本，跨账户竞争同一修改号只接受一方', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner)
    const rename = { requestId: crypto.randomUUID(), name: '工资卡' }
    const retries = await Promise.all(Array.from({ length: 8 }, () => patch(owner, accountId, rename)))
    for (const response of retries) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ accountId, version: 2 })
    }
    const other = await create(owner, { name: '饭卡' }), requestId = crypto.randomUUID()
    const competing = await Promise.all([patch(owner, accountId, { requestId }), patch(owner, other.accountId, { requestId })])
    expect(competing.map(response => response.status).sort()).toEqual([200, 409])
    const rejected = competing.find(response => response.status === 409)!
    expect(await rejected.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    expect(await read(owner)).toMatchObject({ version: 3, accounts: [{ name: '工资卡', balanceCents: 0 }, { name: '饭卡', balanceCents: 0 }] })
  })

  it('改名在版本提交故障后不占用请求号，名称冲突与余额冲突也不占用失败请求号', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner), requestId = crypto.randomUUID()
    expect((await patch(owner, accountId, { requestId, name: 'ledger119-rollback' })).status).toBe(503)
    expect(await read(owner)).toMatchObject({ version: 1, accounts: [{ name: '零钱' }] })
    expect((await patch(owner, accountId, { requestId, name: '现金' })).status).toBe(200)
    await create(owner, { name: '饭卡' })
    const duplicate = crypto.randomUUID(), stale = crypto.randomUUID()
    expect((await patch(owner, accountId, { requestId: duplicate, name: '饭卡' })).status).toBe(409)
    expect((await patch(owner, accountId, { requestId: duplicate, name: '工资卡' })).status).toBe(200)
    expect((await patch(owner, accountId, { requestId: stale, balanceCents: 100, expectedBalanceCents: 1 })).status).toBe(409)
    expect((await patch(owner, accountId, { requestId: stale, balanceCents: 100, expectedBalanceCents: 0 })).status).toBe(200)
    expect(await read(owner)).toMatchObject({ version: 5, accounts: [{ name: '工资卡', balanceCents: 100 }, { name: '饭卡', balanceCents: 0 }] })
  })

  it('新增账户可重新读取，稳定身份与初始余额持久化', async () => {
    const owner = crypto.randomUUID()
    const created = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '  零钱  ', balanceCents: -1234 })
    expect(created.status).toBe(200)
    const receipt = ledgerAccountReceiptSchema.parse(await created.json())
    expect(receipt).toMatchObject({ version: 1 })
    const response = await ledgerRequest(owner, '/api/ledger/accounts')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ version: 1, accounts: [{ id: receipt.accountId, name: '零钱', balanceCents: -1234 }] })
  })

  it('改名不回写余额；过时修正拒绝，原修正重试不覆盖后续余额', async () => {
    const owner = crypto.randomUUID()
    const created = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '银行卡', balanceCents: 100000 })
    const { accountId } = ledgerAccountReceiptSchema.parse(await created.json())
    const path = `/api/ledger/accounts/${accountId}`
    const correction = { requestId: crypto.randomUUID(), balanceCents: 90000, expectedBalanceCents: 100000 }
    expect((await ledgerRequest(owner, path, correction, 'PATCH')).status).toBe(200)
    expect((await ledgerRequest(owner, path, { requestId: crypto.randomUUID(), name: '工资卡' }, 'PATCH')).status).toBe(200)
    const stale = await ledgerRequest(owner, path, { requestId: crypto.randomUUID(), name: '不应保存', balanceCents: 80000, expectedBalanceCents: 100000 }, 'PATCH')
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'BALANCE_CHANGED' } })
    expect((await ledgerRequest(owner, path, { requestId: crypto.randomUUID(), balanceCents: 70000, expectedBalanceCents: 90000 }, 'PATCH')).status).toBe(200)
    expect((await ledgerRequest(owner, path, correction, 'PATCH')).status).toBe(200)
    expect(await (await ledgerRequest(owner, '/api/ledger/accounts')).json()).toMatchObject({ version: 4, accounts: [{ id: accountId, name: '工资卡', balanceCents: 70000 }] })
  })

  it('开户请求核对原输入而非现名现余额；修正摘要包含账户、名称、目标和原余额', async () => {
    const owner = crypto.randomUUID(), requestId = crypto.randomUUID()
    const initial = { requestId, name: '  零钱  ', balanceCents: 100 }
    const { accountId } = await create(owner, initial)
    const correction = { requestId: crypto.randomUUID(), name: '现金', balanceCents: 200, expectedBalanceCents: 100 }
    expect((await patch(owner, accountId, correction)).status).toBe(200)
    expect(await create(owner, initial)).toEqual({ accountId, version: 2 })
    for (const changed of [{ name: '现金' }, { balanceCents: 200 }]) {
      const response = await ledgerRequest(owner, '/api/ledger/accounts', { ...initial, ...changed })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    expect((await patch(owner, accountId, { ...correction, name: '  现金\u3000' })).status).toBe(200)
    for (const changed of [{ name: '别名' }, { balanceCents: 201 }, { expectedBalanceCents: 99 }]) {
      const response = await patch(owner, accountId, { ...correction, ...changed })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
    }
    const other = await create(owner, { name: '饭卡' })
    expect((await patch(owner, other.accountId, correction)).status).toBe(409)
    expect(await read(owner)).toMatchObject({ version: 3, accounts: [{ id: accountId, name: '现金', balanceCents: 200 }, { name: '饭卡', balanceCents: 0 }] })
  })

  it('相同名称及余额的修改保持版本和更新时间，也不产生流水', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner)
    const before = await read(owner)
    for (const fields of [{}, { name: ' \u3000零钱\t' }, { balanceCents: 0, expectedBalanceCents: 0 }, { name: '零钱', balanceCents: 0, expectedBalanceCents: 0 }]) {
      const response = await patch(owner, accountId, fields)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ accountId, version: 1 })
    }
    expect(await read(owner)).toEqual(before)
    expect(await (await ledgerRequest(owner)).json()).toMatchObject({ total: 0, version: 1 })
  })

  it('并发开户同号去重、本人同名竞争、余额校验竞争都只提交一次', async () => {
    const owner = crypto.randomUUID(), requestId = crypto.randomUUID()
    const receipts = await Promise.all(Array.from({ length: 8 }, () => create(owner, { requestId })))
    expect(new Set(receipts.map(value => value.accountId)).size).toBe(1)
    expect(await read(owner)).toMatchObject({ version: 1 })
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '饭卡', balanceCents: 0 })))
    expect(duplicates.map(response => response.status).sort()).toEqual([200, 409, 409, 409])
    const id = receipts[0].accountId
    const competing = await Promise.all([patch(owner, id, { balanceCents: 100, expectedBalanceCents: 0 }), patch(owner, id, { balanceCents: 200, expectedBalanceCents: 0 })])
    expect(competing.map(response => response.status).sort()).toEqual([200, 409])
    const latest = (await read(owner)).accounts.find(account => account.id === id)!
    const correction = { requestId: crypto.randomUUID(), balanceCents: 300, expectedBalanceCents: latest.balanceCents }
    const retries = await Promise.all(Array.from({ length: 6 }, () => patch(owner, id, correction)))
    expect(retries.every(response => response.status === 200)).toBe(true)
    expect(await read(owner)).toMatchObject({ version: 4, accounts: [{ id, balanceCents: 300 }, { name: '饭卡' }] })
  })

  it('名称 trim、50 个 Unicode 码点、正负金额边界与零均持久化，无效输入整次拒绝', async () => {
    const owner = crypto.randomUUID()
    for (const fields of [{ name: '' }, { name: '\u3000\t' }, { name: '😀'.repeat(51) }, { balanceCents: 100000000000 }, { balanceCents: -100000000000 }, { balanceCents: 0.5 }, { balanceCents: '100' }, { name: null }, { ownerId: crypto.randomUUID() }, { balanceCents: null }]) {
      expect((await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: '零钱', balanceCents: 0, ...fields })).status).toBe(400)
    }
    expect(await read(owner)).toEqual({ version: 0, accounts: [] })
    const { accountId } = await create(owner, { name: '\u00a0' + '😀'.repeat(50) + '\u3000', balanceCents: -99999999999 })
    expect(await read(owner)).toMatchObject({ version: 1, accounts: [{ name: '😀'.repeat(50), balanceCents: -99999999999 }] })
    for (const fields of [{ balanceCents: 1 }, { expectedBalanceCents: 0 }, { balanceCents: null, expectedBalanceCents: 0 }, { balanceCents: 1.1, expectedBalanceCents: -99999999999 }, { balanceCents: 100000000000, expectedBalanceCents: -99999999999 }, { name: '😀'.repeat(51) }, { owner_id: crypto.randomUUID() }, { requestId: null }, { update_requests: {} }]) {
      expect((await patch(owner, accountId, fields)).status).toBe(400)
    }
    expect((await patch(owner, accountId, { balanceCents: 99999999999, expectedBalanceCents: -99999999999 })).status).toBe(200)
    expect((await patch(owner, accountId, { balanceCents: 0, expectedBalanceCents: 99999999999 })).status).toBe(200)
    expect(await read(owner)).toMatchObject({ version: 3, accounts: [{ balanceCents: 0 }] })
  })

  it('本人名称唯一、其他所有者可同名；跨所有者账户和未授权接口不可访问', async () => {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), { accountId } = await create(owner)
    expect(await read(other)).toEqual({ version: 0, accounts: [] })
    expect((await patch(other, accountId, { name: '篡改' })).status).toBe(404)
    const otherAccount = await create(other)
    expect((await patch(other, accountId, { balanceCents: 1, expectedBalanceCents: 0 })).status).toBe(404)
    expect((await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: ' 零钱 ', balanceCents: 0 })).status).toBe(409)
    const second = await create(owner, { name: '饭卡' })
    expect((await patch(owner, second.accountId, { name: '零钱', balanceCents: 50, expectedBalanceCents: 0 })).status).toBe(409)
    expect(await read(owner)).toMatchObject({ version: 2, accounts: [{ name: '零钱', balanceCents: 0 }, { name: '饭卡', balanceCents: 0 }] })
    expect(await read(other)).toMatchObject({ version: 1, accounts: [{ id: otherAccount.accountId, name: '零钱', balanceCents: 0 }] })
    expect((await app.request('/api/ledger/accounts', {}, ledgerEnv)).status).toBe(401)
    const original = ledgerEnv.AUTH_ALLOWED_EMAILS
    try {
      ledgerEnv.AUTH_ALLOWED_EMAILS = 'removed@example.invalid'
      expect((await ledgerRequest(owner, '/api/ledger/accounts')).status).toBe(403)
      expect((await patch(owner, accountId, { name: '拒绝' })).status).toBe(403)
    } finally { ledgerEnv.AUTH_ALLOWED_EMAILS = original }
    for (const query of ['?ownerId=' + other, '?accountId=' + accountId, '?page=1']) expect((await ledgerRequest(owner, '/api/ledger/accounts' + query)).status).toBe(400)
    expect((await ledgerRequest(owner, `/api/ledger/accounts/${accountId}`, undefined, 'DELETE')).status).toBe(404)
    expect((await ledgerRequest(owner, '/api/ledger/balance-adjustments')).status).toBe(404)
  })

  it('版本提交故障回滚账户、修正和请求，重试可继续而不泄漏内部错误', async () => {
    const owner = crypto.randomUUID()
    const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name: 'ledger119-rollback', balanceCents: 10 })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'SAVE_UNKNOWN', message: '保存结果未确认，请沿用原请求重试或刷新查看账户' } })
    expect(await read(owner)).toEqual({ version: 0, accounts: [] })
    const { accountId } = await create(owner, { balanceCents: 100 })
    const requestId = crypto.randomUUID()
    expect((await patch(owner, accountId, { requestId, name: 'ledger119-rollback', balanceCents: 200, expectedBalanceCents: 100 })).status).toBe(503)
    expect(await read(owner)).toMatchObject({ version: 1, accounts: [{ name: '零钱', balanceCents: 100 }] })
    expect((await patch(owner, accountId, { requestId, name: '现金', balanceCents: 200, expectedBalanceCents: 100 })).status).toBe(200)
    expect(await read(owner)).toMatchObject({ version: 2, accounts: [{ name: '现金', balanceCents: 200 }] })
  })

  it('真实 PostgREST 拒绝浏览器角色直访新表和业务 RPC，服务角色也只有受控 RPC 权限', async () => {
    const owner = crypto.randomUUID(), { accountId } = await create(owner)
    const direct = (role: string, path: string, body?: unknown) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 300 })}`
      const signature = createHmac('sha256', process.env.LEDGER_LOCAL_JWT_SECRET!).update(unsigned).digest('base64url')
      return fetch(new URL(path, ledgerRpc), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${unsigned}.${signature}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    }
    expect((await direct('service_role', '/rpc/ledger_accounts_list', { p_owner: owner })).status).toBe(200)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of ['ledger_accounts', 'ledger_balance_adjustments']) expect([401, 403, 404]).toContain((await direct(role, `/${table}?select=*`)).status)
      expect([401, 403, 404]).toContain((await direct(role, '/ledger_accounts', { update_requests: {} })).status)
      if (role === 'service_role') continue
      for (const [name, params] of [
        ['ledger_accounts_list', { p_owner: owner }],
        ['ledger_account_create', { p_owner: owner, p_input: { requestId: crypto.randomUUID(), name: '非法', balanceCents: 0 } }],
        ['ledger_account_update', { p_owner: owner, p_id: accountId, p_input: { requestId: crypto.randomUUID(), name: '非法' } }],
      ] as const) expect([401, 403, 404]).toContain((await direct(role, `/rpc/${name}`, params)).status)
    }
    expect(await read(owner)).toMatchObject({ version: 1, accounts: [{ name: '零钱' }] })
    const visible = await (await ledgerRequest(owner, '/api/ledger/accounts')).json() as { accounts: Record<string, unknown>[] }
    expect(Object.keys(visible.accounts[0]).sort()).toEqual(['balanceCents', 'createdAt', 'id', 'name', 'updatedAt'])
  })
})
