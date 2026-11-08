import { Client } from 'pg'
import { createServer, connect } from 'node:net'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { queryLedger } from '../../worker/ledger-data'
import { queryPlanning } from '../../worker/adventure/data'
import { goalReward } from '../../worker/adventure/commands'
import { transaction } from '../../worker/database'
import { ledgerAccountReceiptSchema, ledgerReceiptSchema, ledgerDeletePreviewSchema } from '../../src/shared/ledger'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { testDatabaseUrl } from '../support/isolated-database'

const connectionString = testDatabaseUrl('WORKER_TEST_DATABASE_URL'),
  adminUrl = testDatabaseUrl('WORKER_TEST_ADMIN_URL')
describe.skipIf(!connectionString || !adminUrl)('首次写入与大集合的真实 PostgreSQL 边界', () => {
  const env = { HYPERDRIVE: { connectionString: connectionString! } },
    admin = new Client({ connectionString: adminUrl })
  beforeAll(() => admin.connect())
  afterAll(() => admin.end())
  it.each(['ledger_accounts_list', 'ledger_list'])('%s 首写竞争返回版本 0 的完整空快照', async (operation) => {
    const owner = crypto.randomUUID(),
      target = new URL(connectionString!)
    let release = () => {},
      ready = () => {}
    const observed = new Promise<void>((resolve) => {
      ready = resolve
    })
    const proxy = createServer((socket) => {
      const upstream = connect(Number(target.port), target.hostname)
      let paused = false,
        parts: Buffer[] = [],
        protocol = Buffer.alloc(0)
      release = () => {
        paused = false
        for (const part of parts) socket.write(part)
        parts = []
      }
      socket.on('data', (data) => {
        if (data.includes(Buffer.from('select revision from public.ledger_owner_revision'))) paused = true
        upstream.write(data)
      })
      upstream.on('data', (data) => {
        if (!paused) {
          socket.write(data)
          return
        }
        const bytes = typeof data === 'string' ? Buffer.from(data) : data
        parts.push(bytes)
        protocol = Buffer.concat([protocol, bytes])
        // Signal only after PostgreSQL completed this SELECT, not after Parse.
        while (protocol.length >= 5) {
          const length = protocol.readInt32BE(1) + 1
          if (protocol.length < length) break
          if (protocol[0] === 90) ready() // ReadyForQuery
          protocol = protocol.subarray(length)
        }
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
    const url = new URL(target)
    url.port = String(address.port)
    const reading = queryLedger({ HYPERDRIVE: { connectionString: url.href } }, owner, operation, {
      p_page: 1,
      p_start_date: null,
      p_end_date: null,
      p_version: 0,
    })
    try {
      await observed
      const account = ledgerAccountReceiptSchema.parse(
        await queryLedger(env, owner, 'ledger_account_create', {
          p_input: { requestId: crypto.randomUUID(), name: '首写竞争', balanceCents: 0 },
        })
      )
      if (operation === 'ledger_list')
        await queryLedger(env, owner, 'ledger_create', {
          p_input: {
            requestId: crypto.randomUUID(),
            direction: 'expense',
            amountCents: -1,
            occurredAt: '2026-01-01T00:00:00Z',
            accountId: account.accountId,
            categoryCode: 'dining',
            note: '',
          },
        })
      release()
      expect(await reading).toMatchObject(
        operation === 'ledger_accounts_list' ? { version: 0, accounts: [] } : { version: 0, total: 0, items: [] }
      )
      expect(await queryLedger(env, owner, 'ledger_accounts_list', {})).toMatchObject({ accounts: [{ id: account.accountId }] })
    } finally {
      release()
      await reading.catch(() => {})
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })
  it('大回执在数据库投影中去除，冻结来源超限时事务拒绝且版本不变', async () => {
    const owner = crypto.randomUUID()
    const goal = planningReceiptSchema.parse(
      await queryPlanning(env, owner, 'adventure_planning_command', {
        p_request_id: crypto.randomUUID(),
        p_expected_version: 0,
        p_command: { type: 'createGoal', destination: '', title: '集合容量', standards: ['标准'] },
      })
    )
    await admin.query(
      `with tasks as (
      insert into public.adventure_tasks(owner_id,goal_id,title,planned_on,status,completed_at,completed_on)
      select $1,$2,'历史任务',current_date,'completed',now(),current_date from generate_series(1,75) returning *
    ) insert into public.adventure_events(owner_id,event_group_id,kind,entity_type,entity_id,task_id,mainline_id,goal_id,occurred_at,occurred_on,actor_owner_id,amount,calculation,snapshot)
      select $1,gen_random_uuid(),'task_completed','task',t.id,t.id,g.mainline_id,g.id,t.completed_at,t.completed_on,$1,1,
        jsonb_build_object('type','fixed_task','completionId',gen_random_uuid(),'count',1,'coefficient',1),
        jsonb_build_object('title',t.title,'description','说明','plannedOn',t.planned_on,'result',repeat('x',100000))
      from tasks t join public.adventure_goals g on g.owner_id=t.owner_id and g.id=t.goal_id`,
      [owner, goal.result.entityId]
    )
    await admin.query('update public.adventure_accounts set total_xp=75 where owner_id=$1', [owner])
    const plan = await transaction(env, owner, async (db) => {
      await db.rows('select revision from public.adventure_accounts where owner_id=$1 for share', [owner])
      return goalReward(db, owner, goal.result.entityId, 2)
    })
    expect(plan.reward.amount).toBe(150)
    expect(JSON.stringify(plan).length).toBeLessThan(50_000)
    await admin.query(
      "update public.adventure_events set snapshot=jsonb_set(snapshot,'{description}',to_jsonb(repeat('界',4000))) where owner_id=$1 and kind='task_completed'",
      [owner]
    )
    await expect(
      queryPlanning(env, owner, 'adventure_planning_command', {
        p_request_id: crypto.randomUUID(),
        p_expected_version: 1,
        p_command: { type: 'achieveGoal', id: goal.result.entityId, coefficient: 2, reflection: '' },
      })
    ).rejects.toMatchObject({ code: 'CAPACITY_REACHED' })
    expect((await admin.query('select revision,total_xp from public.adventure_accounts where owner_id=$1', [owner])).rows[0]).toEqual({
      revision: '1',
      total_xp: '75',
    })
  })
  it('一万条退款的删除范围和净余额在数据库聚合，整组删除不改变零净额', async () => {
    const owner = crypto.randomUUID()
    const account = ledgerAccountReceiptSchema.parse(
      await queryLedger(env, owner, 'ledger_account_create', {
        p_input: { requestId: crypto.randomUUID(), name: '大量退款', balanceCents: 0 },
      })
    )
    const parent = ledgerReceiptSchema.parse(
      await queryLedger(env, owner, 'ledger_create', {
        p_input: {
          requestId: crypto.randomUUID(),
          direction: 'expense',
          amountCents: -10000,
          occurredAt: '2026-01-01T00:00:00Z',
          accountId: account.accountId,
          categoryCode: 'dining',
          note: '',
        },
      })
    )
    await admin.query(
      `insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,parent_entry_id)
      select $1,gen_random_uuid(),'income',1,'2026-01-02T00:00:00Z',$2,'dining',repeat('界',500),$3 from generate_series(1,10000)`,
      [owner, account.accountId, parent.entryId]
    )
    await admin.query('update public.ledger_accounts set balance_cents=0 where owner_id=$1', [owner])
    const preview = ledgerDeletePreviewSchema.parse(await queryLedger(env, owner, 'ledger_delete_preview', { p_id: parent.entryId }))
    expect(preview).toMatchObject({ refundCount: 10000 })
    const scope = preview.scope
    await queryLedger(env, owner, 'ledger_delete', { p_id: parent.entryId, p_scope: scope })
    expect(await queryLedger(env, owner, 'ledger_accounts_list', {})).toMatchObject({ accounts: [{ balanceCents: 0 }] })
    expect(
      (await admin.query('select count(*) from public.ledger_entries where owner_id=$1 and deleted_at is not null', [owner])).rows[0].count
    ).toBe('10001')
  }, 20_000)
})
