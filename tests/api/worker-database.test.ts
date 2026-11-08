import { testDatabaseUrl } from '../support/isolated-database'
import { describe, expect, it } from 'vitest'
import { queryLedger } from '../../worker/ledger-data'
import { transaction } from '../../worker/database'
import { Client } from 'pg'
import { createServer, connect } from 'node:net'
import { once } from 'node:events'
import { ledgerAccountReceiptSchema, ledgerReceiptSchema } from '../../src/shared/ledger'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { queryPlanning } from '../../worker/adventure/data'

const connectionString = testDatabaseUrl('WORKER_TEST_DATABASE_URL')
describe.skipIf(!connectionString)('Worker pg 与隔离数据库', () => {
  const env = { HYPERDRIVE: { connectionString: connectionString! } }
  it('专用登录角色可执行完整开户事务与实时回读', async () => {
    const owner = crypto.randomUUID()
    const value = { requestId: crypto.randomUUID(), name: 'pg 验收', balanceCents: 100 }
    const receipt = await queryLedger(env, owner, 'ledger_account_create', { p_input: value })
    expect(receipt).toMatchObject({ version: 1 })
    expect(await queryLedger(env, owner, 'ledger_accounts_list', {})).toMatchObject({
      version: 1,
      accounts: [{ name: value.name, balanceCents: 100 }],
    })
    expect(await queryLedger(env, owner, 'ledger_account_create', { p_input: value })).toEqual(receipt)
  })
  it('无 owner 上下文不能读取其他所有者数据', async () => {
    expect(await transaction(env, null, (db) => db.rows('select owner_id from public.ledger_accounts'))).toEqual([])
  })
  it('同 owner 的共享读取锁覆盖快照并阻止写入，其他 owner 独立提交', async () => {
    const owner = crypto.randomUUID(),
      other = crypto.randomUUID()
    await queryLedger(env, owner, 'ledger_account_create', {
      p_input: { requestId: crypto.randomUUID(), name: '读锁初始', balanceCents: 0 },
    })
    const admin = new Client({ connectionString: testDatabaseUrl('WORKER_TEST_ADMIN_URL') })
    await admin.connect()
    let release = () => {},
      held = () => {}
    const hold = new Promise<void>((resolve) => {
        release = resolve
      }),
      ready = new Promise<void>((resolve) => {
        held = resolve
      })
    let writing: Promise<unknown> | undefined
    const reading = transaction(env, owner, async (db) => {
      const row = await db.one('select revision,pg_backend_pid() pid from public.ledger_owner_revision where owner_id=$1 for share', [
        owner,
      ])
      held()
      await hold
      expect(await db.one('select revision from public.ledger_owner_revision where owner_id=$1', [owner])).toMatchObject({
        revision: row.revision,
      })
      return row.pid
    })
    try {
      await ready
      writing = queryLedger(env, owner, 'ledger_account_create', {
        p_input: { requestId: crypto.randomUUID(), name: '等待读锁', balanceCents: 0 },
      })
      let blocked = false
      for (let i = 0; i < 100; i++) {
        const result = await admin.query(
          "select count(*) from pg_stat_activity where application_name='lifespace-worker' and cardinality(pg_blocking_pids(pid))>0"
        )
        if (Number(result.rows[0].count) > 0) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toBe(true)
      expect(
        await queryLedger(env, other, 'ledger_account_create', {
          p_input: { requestId: crypto.randomUUID(), name: '独立所有者', balanceCents: 0 },
        })
      ).toMatchObject({ version: 1 })
      release()
      const pid = await reading
      await expect(writing).resolves.toMatchObject({ version: 2 })
      expect((await admin.query('select pid from pg_stat_activity where pid=$1', [pid])).rows).toEqual([])
    } finally {
      release()
      await reading
      await writing?.catch(() => {})
      await admin.end()
    }
  })
  it('UUID 大小写按数据库身份比较，保留成功幂等与同账户转账拒绝', async () => {
    const owner = crypto.randomUUID().toUpperCase()
    const account = ledgerAccountReceiptSchema.parse(
      await queryLedger(env, owner, 'ledger_account_create', {
        p_input: { requestId: crypto.randomUUID(), name: 'UUID 账户', balanceCents: 0 },
      })
    )
    const input = {
      requestId: crypto.randomUUID().toUpperCase(),
      direction: 'expense',
      amountCents: -100,
      occurredAt: '2026-01-01T00:00:00Z',
      accountId: account.accountId.toUpperCase(),
      categoryCode: 'dining',
      note: '',
    }
    const first = ledgerReceiptSchema.parse(await queryLedger(env, owner, 'ledger_create', { p_input: input }))
    expect(await queryLedger(env, owner, 'ledger_create', { p_input: input })).toEqual(first)
    const patch = { requestId: crypto.randomUUID().toUpperCase(), name: 'UUID 更名' }
    const renamed = await queryLedger(env, owner, 'ledger_account_update', { p_id: account.accountId.toUpperCase(), p_input: patch })
    expect(await queryLedger(env, owner, 'ledger_account_update', { p_id: account.accountId, p_input: patch })).toEqual(renamed)
    await expect(
      queryLedger(env, owner, 'ledger_transfer', {
        p_input: {
          requestId: crypto.randomUUID(),
          fromAccountId: account.accountId,
          toAccountId: account.accountId.toUpperCase(),
          amountCents: 1,
          occurredAt: '2026-01-01T00:00:00Z',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ENTRY' })
  })
  it('独立目标接受原有主线 UUID 的编辑，终态回执使用规范身份', async () => {
    const owner = crypto.randomUUID(),
      admin = new Client({ connectionString: testDatabaseUrl('WORKER_TEST_ADMIN_URL') })
    await admin.connect()
    try {
      const goal = planningReceiptSchema.parse(
        await queryPlanning(env, owner, 'adventure_planning_command', {
          p_request_id: crypto.randomUUID(),
          p_expected_version: 0,
          p_command: { type: 'createGoal', title: '独立目标', standards: ['标准'], destination: '' },
        })
      )
      const main = (
        await admin.query('select mainline_id from public.adventure_goals where owner_id=$1 and id=$2', [owner, goal.result.entityId])
      ).rows[0].mainline_id
      const updated = planningReceiptSchema.parse(
        await queryPlanning(env, owner, 'adventure_planning_command', {
          p_request_id: crypto.randomUUID(),
          p_expected_version: 1,
          p_command: {
            type: 'editGoal',
            id: goal.result.entityId.toUpperCase(),
            title: '编辑独立目标',
            standards: ['标准'],
            destination: main,
          },
        })
      )
      expect(updated.version).toBe(2)
      const ended = planningReceiptSchema.parse(
        await queryPlanning(env, owner, 'adventure_planning_command', {
          p_request_id: crypto.randomUUID(),
          p_expected_version: 2,
          p_command: { type: 'endGoal', id: goal.result.entityId.toUpperCase() },
        })
      )
      expect(ended.result.entityId).toBe(goal.result.entityId)
    } finally {
      await admin.end()
    }
  })
  it('失败事务完整回滚并关闭后端连接，不能删除历史或调用旧写函数', async () => {
    const owner = crypto.randomUUID()
    const admin = new Client({ connectionString: testDatabaseUrl('WORKER_TEST_ADMIN_URL') })
    await admin.connect()
    let pid = 0
    try {
      await expect(
        transaction(env, owner, async (db) => {
          pid = Number((await db.one('select pg_backend_pid() pid')).pid)
          await db.rows('insert into public.ledger_owner_revision(owner_id) values($1)', [owner])
          throw new Error('synthetic failure after write')
        })
      ).rejects.toThrow('synthetic failure')
      expect((await admin.query('select * from public.ledger_owner_revision where owner_id=$1', [owner])).rows).toEqual([])
      expect((await admin.query('select pid from pg_stat_activity where pid=$1', [pid])).rows).toEqual([])
      for (const sql of [
        'delete from public.ledger_entries',
        'select * from auth.users',
        "select public.ledger_account_create($1,'{}'::jsonb)",
        'update public.ledger_accounts set owner_id=$1',
      ]) {
        await expect(transaction(env, owner, (db) => db.rows(sql, sql.includes('$1') ? [owner] : []))).rejects.toMatchObject({
          code: '42501',
        })
      }
    } finally {
      await admin.end()
    }
  })
  it('数据库已提交但响应丢失时，原请求重试只产生一个账户', async () => {
    const target = new URL(connectionString!),
      owner = crypto.randomUUID()
    let dropped = false
    const proxy = createServer((socket) => {
      const upstream = connect(Number(target.port), target.hostname)
      let committing = false
      socket.on('data', (data) => {
        if (data[0] === 81 && data.includes(Buffer.from('commit\0'))) committing = true
        upstream.write(data)
      })
      upstream.on('data', (data) => {
        if (committing && data.includes(Buffer.from('COMMIT\0'))) {
          dropped = true
          socket.destroy()
          upstream.destroy()
          return
        }
        socket.write(data)
      })
      socket.on('error', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.on('close', () => socket.destroy())
    })
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const address = proxy.address()
    if (!address || typeof address === 'string') throw new Error('代理端口未就绪')
    const proxied = new URL(target)
    proxied.port = String(address.port)
    const value = { requestId: crypto.randomUUID(), name: '提交回执丢失', balanceCents: 99 }
    try {
      await expect(
        queryLedger({ HYPERDRIVE: { connectionString: proxied.href } }, owner, 'ledger_account_create', { p_input: value })
      ).rejects.toThrow()
      expect(dropped).toBe(true)
      const receipt = await queryLedger(env, owner, 'ledger_account_create', { p_input: value })
      expect(receipt).toMatchObject({ version: 1 })
      expect(await queryLedger(env, owner, 'ledger_accounts_list', {})).toMatchObject({ version: 1, accounts: [{ balanceCents: 99 }] })
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })
})
