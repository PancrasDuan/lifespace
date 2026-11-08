import type { DatabaseEnv } from './database'
import { DatabaseError, reject, transaction, type Transaction } from './database'
import {
  ledgerAccountCreateSchema,
  ledgerAccountUpdateSchema,
  ledgerCreateSchema,
  ledgerRefundSchema,
  ledgerTransferSchema,
} from '../src/shared/ledger'

type Entry = {
  id: string
  account_id: string
  transfer_id: string | null
  parent_entry_id: string | null
  request_id: string
  direction: string
  amount_cents: string
  occurred_at: Date
  note: string
  category_code: string
  deleted_at: Date | null
}
type Account = { id: string; name: string; balance_cents: string; request_hash: string; update_requests: Record<string, string> }
type Params = Record<string, unknown>

async function revision(db: Transaction, owner: string, writing: boolean, initialize = false) {
  if (initialize) await db.rows('insert into public.ledger_owner_revision(owner_id) values($1) on conflict do nothing', [owner])
  const rows = await db.rows(`select revision from public.ledger_owner_revision where owner_id=$1 for ${writing ? 'update' : 'share'}`, [
    owner,
  ])
  return rows.length ? Number(rows[0].revision) : null
}
async function advance(db: Transaction, owner: string) {
  return Number(
    (
      await db.one('update public.ledger_owner_revision set revision=revision+1, updated_at=now() where owner_id=$1 returning revision', [
        owner,
      ])
    ).revision
  )
}
async function applyBalance(db: Transaction, owner: string, account: string, delta: number | bigint) {
  const rows = await db.rows(
    `update public.ledger_accounts set balance_cents=balance_cents+$3,updated_at=now()
    where owner_id=$1 and id=$2 and balance_cents+$3 between -99999999999 and 99999999999 returning id`,
    [owner, account, String(delta)]
  )
  if (!rows.length) reject('BALANCE_LIMIT')
}
async function entry(db: Transaction, owner: string, id: unknown, includeDeleted = false) {
  const rows = await db.rows<Entry>(
    `select * from public.ledger_entries where owner_id=$1 and id=$2 and account_id is not null
    ${includeDeleted ? '' : 'and deleted_at is null'}`,
    [owner, id]
  )
  return rows[0] ?? reject('NOT_FOUND')
}
async function prior(db: Transaction, owner: string, requestId: string) {
  const rows = await db.rows<Entry>('select * from public.ledger_entries where owner_id=$1 and request_id=$2', [owner, requestId])
  if (rows[0] && !rows[0].account_id) reject('NOT_FOUND')
  return rows[0]
}
const receipt = (row: Entry, version: number) => ({ entryId: row.id, version, deleted: row.deleted_at !== null })
const sameTime = (left: Date, right: string) => left.getTime() === Date.parse(right)
async function hash(db: Transaction, value: unknown) {
  // Keep the historical PostgreSQL jsonb canonical form for settled requests.
  return (await db.one("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') hash", [JSON.stringify(value)])).hash as string
}
async function accountsExist(db: Transaction, owner: string, ids: string[]) {
  const rows = await db.rows('select id from public.ledger_accounts where owner_id=$1 and id=any($2::uuid[])', [owner, ids])
  if (rows.length !== ids.length) reject('ACCOUNT_NOT_FOUND')
}
async function insertEntry(
  db: Transaction,
  owner: string,
  values: {
    requestId: string
    direction: string
    amountCents: number
    occurredAt: string
    accountId: string
    categoryCode: string
    note: string
  },
  parent: string | null = null,
  transfer: string | null = null
) {
  return (
    await db.one(
      `insert into public.ledger_entries(owner_id,request_id,direction,amount_cents,occurred_at,account_id,category_code,note,parent_entry_id,transfer_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        owner,
        values.requestId,
        values.direction,
        values.amountCents,
        values.occurredAt,
        values.accountId,
        values.categoryCode,
        values.note,
        parent,
        transfer,
      ]
    )
  ).id as string
}
async function jsonEntry(db: Transaction, owner: string, id: string | null) {
  if (!id) return null
  return (
    (
      await db.rows(
        'select public.ledger_entry_json(e) value from public.ledger_entries e where owner_id=$1 and id=$2 and deleted_at is null and account_id is not null',
        [owner, id]
      )
    )[0]?.value ?? null
  )
}
// Keep potentially large refund sets inside PostgreSQL. Only a fixed-size
// scope/count and one amount per affected account cross the driver boundary.
const deleteTargets = `select e.id,e.account_id,e.amount_cents,e.parent_entry_id from public.ledger_entries target
  join public.ledger_entries e on e.owner_id=target.owner_id
    and (e.id=target.id or (target.transfer_id is not null and e.transfer_id=target.transfer_id)
      or (target.transfer_id is null and e.parent_entry_id=target.id))
  where target.owner_id=$1 and target.id=$2 and target.deleted_at is null and target.account_id is not null
    and e.deleted_at is null and e.account_id is not null`
async function deleteScope(db: Transaction, owner: string, id: string) {
  return db.one<{ scope: string; refund_count: string }>(
    `select encode(sha256(convert_to($1::text || ':' || string_agg(id::text,',' order by id),'UTF8')),'hex') scope,
    count(*) filter(where parent_entry_id=$2) refund_count from (${deleteTargets}) affected`,
    [owner, id]
  )
}

// HTTP and MCP both enter this boundary after validating identity and input.
// All decisions and writes below run while holding the owner's row lock.
export async function queryLedger(env: DatabaseEnv, owner: string, operation: string, params: Params): Promise<unknown> {
  owner = owner.toLowerCase()
  const writing = [
    'ledger_account_create',
    'ledger_account_update',
    'ledger_create',
    'ledger_refund',
    'ledger_transfer',
    'ledger_delete',
  ].includes(operation)
  return transaction(env, owner, async (db) => {
    const storedVersion = await revision(
      db,
      owner,
      writing,
      ['ledger_account_create', 'ledger_create', 'ledger_refund', 'ledger_transfer'].includes(operation)
    )
    const version = storedVersion ?? 0
    if (storedVersion === null) {
      if (operation === 'ledger_accounts_list') return { accounts: [], version: 0 }
      if (operation === 'ledger_list' || operation === 'ledger_list_by_account') {
        if (params.p_version != null && params.p_version !== 0) reject('LIST_CHANGED')
        return { items: [], total: 0, page: params.p_page, pageSize: 30, version: 0 }
      }
      if (operation === 'ledger_account_update') reject('ACCOUNT_NOT_FOUND')
      reject('NOT_FOUND')
    }
    if (operation === 'ledger_accounts_list') {
      const rows = await db.rows(
        'select public.ledger_account_json(a) value from public.ledger_accounts a where owner_id=$1 order by created_at,id',
        [owner]
      )
      return { accounts: rows.map((row) => row.value), version }
    }
    if (operation === 'ledger_account_create') {
      const value = ledgerAccountCreateSchema.parse(params.p_input)
      const digest = await hash(db, { name: value.name, balanceCents: value.balanceCents })
      const old = (
        await db.rows<Account>('select * from public.ledger_accounts where owner_id=$1 and request_id=$2', [owner, value.requestId])
      )[0]
      if (old) {
        if (old.request_hash !== digest) reject('REQUEST_ID_REUSED')
        return { accountId: old.id, version }
      }
      let accountId: string
      try {
        accountId = (
          await db.one(
            `insert into public.ledger_accounts(owner_id,name,balance_cents,request_id,request_hash)
          values($1,$2,$3,$4,$5) returning id`,
            [owner, value.name, value.balanceCents, value.requestId, digest]
          )
        ).id
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') reject('ACCOUNT_NAME_TAKEN')
        throw error
      }
      return { accountId, version: await advance(db, owner) }
    }
    if (operation === 'ledger_account_update') {
      const value = ledgerAccountUpdateSchema.parse(params.p_input)
      const { requestId: submittedRequestId, ...fields } = value
      const requestId = submittedRequestId.toLowerCase()
      const digest = await hash(db, { accountId: String(params.p_id).toLowerCase(), ...fields })
      const old = (
        await db.rows<Account>('select * from public.ledger_accounts where owner_id=$1 and update_requests ? $2', [owner, requestId])
      )[0]
      if (old) {
        if (old.update_requests[requestId] !== digest) reject('REQUEST_ID_REUSED')
        return { accountId: old.id, version }
      }
      const account =
        (await db.rows<Account>('select * from public.ledger_accounts where owner_id=$1 and id=$2', [owner, params.p_id]))[0] ??
        reject('ACCOUNT_NOT_FOUND')
      if (value.balanceCents !== undefined && Number(account.balance_cents) !== value.expectedBalanceCents) reject('BALANCE_CHANGED')
      await db.rows(
        'update public.ledger_accounts set update_requests=update_requests || jsonb_build_object($3::text,$4::text) where owner_id=$1 and id=$2',
        [owner, account.id, requestId, digest]
      )
      const name = value.name ?? account.name
      const balance = value.balanceCents ?? Number(account.balance_cents)
      if (name === account.name && balance === Number(account.balance_cents)) return { accountId: account.id, version }
      try {
        await db.rows('update public.ledger_accounts set name=$3,balance_cents=$4,updated_at=now() where owner_id=$1 and id=$2', [
          owner,
          account.id,
          name,
          balance,
        ])
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') reject('ACCOUNT_NAME_TAKEN')
        throw error
      }
      if (balance !== Number(account.balance_cents))
        await db.rows(
          `insert into public.ledger_balance_adjustments(owner_id,account_id,before_cents,after_cents,request_id,request_hash)
        values($1,$2,$3,$4,$5,$6)`,
          [owner, account.id, account.balance_cents, balance, requestId, digest]
        )
      return { accountId: account.id, version: await advance(db, owner) }
    }
    if (operation === 'ledger_create') {
      const value = ledgerCreateSchema.parse(params.p_input)
      const old = await prior(db, owner, value.requestId)
      if (old) {
        if (
          old.parent_entry_id ||
          old.transfer_id ||
          old.direction !== value.direction ||
          Number(old.amount_cents) !== value.amountCents ||
          !sameTime(old.occurred_at, value.occurredAt) ||
          old.account_id !== value.accountId.toLowerCase() ||
          old.category_code !== value.categoryCode ||
          old.note !== value.note
        )
          reject('REQUEST_ID_REUSED')
        return receipt(old, version)
      }
      await accountsExist(db, owner, [value.accountId])
      if (Date.parse(value.occurredAt) > Date.now()) reject('FUTURE_TIME')
      const entryId = await insertEntry(db, owner, value)
      await applyBalance(db, owner, value.accountId, value.amountCents)
      return { entryId, version: await advance(db, owner), deleted: false }
    }
    if (operation === 'ledger_refund') {
      const value = ledgerRefundSchema.parse(params.p_input)
      const old = await prior(db, owner, value.requestId)
      if (old) {
        if (
          old.direction !== 'income' ||
          old.parent_entry_id !== String(params.p_parent).toLowerCase() ||
          Number(old.amount_cents) !== value.amountCents ||
          !sameTime(old.occurred_at, value.occurredAt) ||
          old.note !== value.note
        )
          reject('REQUEST_ID_REUSED')
        return receipt(old, version)
      }
      const parent = await entry(db, owner, params.p_parent)
      if (parent.direction !== 'expense' || parent.parent_entry_id || parent.transfer_id) reject('REFUND_PARENT_INVALID')
      if (Date.parse(value.occurredAt) > Date.now()) reject('FUTURE_TIME')
      if (Date.parse(value.occurredAt) < parent.occurred_at.getTime()) reject('REFUND_TIME')
      const refunded = Number(
        (
          await db.one(
            'select coalesce(sum(amount_cents),0) amount from public.ledger_entries where owner_id=$1 and parent_entry_id=$2 and deleted_at is null and account_id is not null',
            [owner, parent.id]
          )
        ).amount
      )
      if (value.amountCents > -Number(parent.amount_cents) - refunded) reject('REFUND_LIMIT')
      const entryId = await insertEntry(
        db,
        owner,
        { ...value, direction: 'income', accountId: parent.account_id, categoryCode: parent.category_code },
        parent.id
      )
      await applyBalance(db, owner, parent.account_id, value.amountCents)
      return { entryId, version: await advance(db, owner), deleted: false }
    }
    if (operation === 'ledger_transfer') {
      const value = ledgerTransferSchema.parse(params.p_input)
      if (value.fromAccountId.toLowerCase() === value.toAccountId.toLowerCase()) reject('INVALID_ENTRY')
      const old = await prior(db, owner, value.requestId)
      if (old) {
        if (!old.transfer_id || old.category_code !== 'transfer_out') reject('REQUEST_ID_REUSED')
        const peer = await db.one<Entry>('select * from public.ledger_entries where owner_id=$1 and transfer_id=$2 and id<>$3', [
          owner,
          old.transfer_id,
          old.id,
        ])
        if (
          old.account_id !== value.fromAccountId.toLowerCase() ||
          peer.account_id !== value.toAccountId.toLowerCase() ||
          -Number(old.amount_cents) !== value.amountCents ||
          !sameTime(old.occurred_at, value.occurredAt) ||
          old.note !== value.note
        )
          reject('REQUEST_ID_REUSED')
        return { transferId: old.transfer_id, outEntryId: old.id, inEntryId: peer.id, version, deleted: old.deleted_at !== null }
      }
      await accountsExist(db, owner, [value.fromAccountId, value.toAccountId])
      if (Date.parse(value.occurredAt) > Date.now()) reject('FUTURE_TIME')
      const transferId = crypto.randomUUID()
      const outEntryId = await insertEntry(
        db,
        owner,
        { ...value, direction: 'expense', amountCents: -value.amountCents, accountId: value.fromAccountId, categoryCode: 'transfer_out' },
        null,
        transferId
      )
      const inEntryId = await insertEntry(
        db,
        owner,
        { ...value, requestId: crypto.randomUUID(), direction: 'income', accountId: value.toAccountId, categoryCode: 'transfer_in' },
        null,
        transferId
      )
      await applyBalance(db, owner, value.fromAccountId, -value.amountCents)
      await applyBalance(db, owner, value.toAccountId, value.amountCents)
      return { transferId, outEntryId, inEntryId, version: await advance(db, owner), deleted: false }
    }
    if (operation === 'ledger_list' || operation === 'ledger_list_by_account') {
      if (params.p_version != null && params.p_version !== version) reject('LIST_CHANGED')
      const filter = `owner_id=$1 and deleted_at is null and account_id is not null
        and ($2::date is null or occurred_at >= ($2::date::timestamp at time zone 'Asia/Shanghai'))
        and ($3::date is null or occurred_at < (($3::date+1)::timestamp at time zone 'Asia/Shanghai'))
        and ($4::uuid is null or account_id=$4)`
      const values = [owner, params.p_start_date, params.p_end_date, params.p_account_id ?? null]
      const total = Number((await db.one(`select count(*) total from public.ledger_entries where ${filter}`, values)).total)
      const rows = await db.rows(
        `select public.ledger_entry_json(e) value from (select * from public.ledger_entries where ${filter}
        order by occurred_at desc,id desc limit 30 offset $5) e order by occurred_at desc,id desc`,
        [...values, (Number(params.p_page) - 1) * 30]
      )
      return { items: rows.map((row) => row.value), total, page: params.p_page, pageSize: 30, version }
    }
    if (operation === 'ledger_detail' || operation === 'ledger_delete_preview') {
      const current = await entry(db, owner, params.p_id)
      const peer = current.transfer_id
        ? (
            await db.rows<Entry>(
              'select * from public.ledger_entries where owner_id=$1 and transfer_id=$2 and id<>$3 and deleted_at is null',
              [owner, current.transfer_id, current.id]
            )
          )[0]
        : null
      const common = { entry: await jsonEntry(db, owner, current.id), transferEntry: await jsonEntry(db, owner, peer?.id ?? null), version }
      if (operation === 'ledger_delete_preview') {
        const affected = await deleteScope(db, owner, current.id)
        return { ...common, scope: affected.scope, refundCount: Number(affected.refund_count) }
      }
      if (params.p_version != null && params.p_version !== version) reject('LIST_CHANGED')
      const totals = await db.one(
        'select count(*) count,coalesce(sum(amount_cents),0) amount from public.ledger_entries where owner_id=$1 and parent_entry_id=$2 and deleted_at is null and account_id is not null',
        [owner, current.id]
      )
      const refunds = await db.rows(
        `select id,amount_cents,occurred_at from public.ledger_entries where owner_id=$1 and parent_entry_id=$2 and deleted_at is null and account_id is not null
        order by occurred_at desc,id desc limit 30 offset $3`,
        [owner, current.id, (Number(params.p_refund_page) - 1) * 30]
      )
      return {
        ...common,
        parentEntry: await jsonEntry(db, owner, current.parent_entry_id),
        refunds: refunds.map((row) => ({ id: row.id, amountCents: Number(row.amount_cents), occurredAt: row.occurred_at.toISOString() })),
        refundCount: Number(totals.count),
        refundedCents: Number(totals.amount),
        refundPage: params.p_refund_page,
        refundPageSize: 30,
      }
    }
    if (operation === 'ledger_delete') {
      const current = await entry(db, owner, params.p_id, true)
      if (current.deleted_at) return receipt(current, version)
      const affected = await deleteScope(db, owner, current.id)
      if (affected.scope !== params.p_scope) reject('DELETE_SCOPE_CHANGED')
      const amounts = await db.rows<{ account_id: string; amount: string }>(
        `select account_id,sum(amount_cents)::bigint amount
        from (${deleteTargets}) affected group by account_id`,
        [owner, current.id]
      )
      for (const row of amounts) await applyBalance(db, owner, row.account_id, -BigInt(row.amount))
      await db.rows(
        `update public.ledger_entries set deleted_at=now() where owner_id=$1 and id in (select id from (${deleteTargets}) affected)`,
        [owner, current.id]
      )
      return { entryId: current.id, version: await advance(db, owner), deleted: true }
    }
    throw new DatabaseError('DATABASE_OPERATION_INVALID')
  })
}
