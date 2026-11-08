import { z } from 'zod'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from './auth'
import { ApiError } from './upstream'
import { readBoundedBody } from './read-body'
import { DatabaseError } from './database'
import { queryLedger } from './ledger-data'
import { ledgerTransferSchema, ledgerTransferReceiptSchema, ledgerAccountCreateSchema, ledgerAccountUpdateSchema, ledgerAccountReceiptSchema, ledgerAccountsSchema, ledgerCreateSchema, ledgerDeletePreviewSchema, ledgerDeleteSchema, ledgerDetailQuerySchema, ledgerDetailSchema, ledgerErrors, ledgerPageSchema, ledgerQuerySchema, ledgerReceiptSchema, ledgerRefundSchema } from '../src/shared/ledger'

type LedgerContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
function failure(code: keyof typeof ledgerErrors, message?: string) {
  const [status, text] = ledgerErrors[code]
  return new ApiError(code, message ?? text, status)
}
export async function listLedgerAccounts(c: LedgerContext) {
  return c.json(await readLedgerAccounts(c, c.req.query()))
}
export async function readLedgerAccounts(c: LedgerContext, input: unknown = {}) {
  if (!z.strictObject({}).safeParse(input).success) throw failure('INVALID_QUERY')
  return execute(c, 'ledger_accounts_list', {}, ledgerAccountsSchema, false, '暂时无法读取账户，请稍后重试')
}
export async function createLedgerAccount(c: LedgerContext) {
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerAccountCreateSchema.safeParse(await readInput(c, 4096, 'INVALID_ACCOUNT'))
  if (!value.success) throw failure('INVALID_ACCOUNT', value.error.issues[0]?.message)
  return c.json(await execute(c, 'ledger_account_create', { p_input: value.data }, ledgerAccountReceiptSchema, true, '保存结果未确认，请沿用原请求重试或刷新查看账户'))
}
export async function updateLedgerAccount(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('ACCOUNT_NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerAccountUpdateSchema.safeParse(await readInput(c, 4096, 'INVALID_ACCOUNT'))
  if (!value.success) throw failure('INVALID_ACCOUNT', value.error.issues[0]?.message)
  return c.json(await execute(c, 'ledger_account_update', { p_id: id.data, p_input: value.data }, ledgerAccountReceiptSchema, true, '保存结果未确认，请沿用原请求重试或刷新查看账户'))
}
async function readInput(c: LedgerContext, maxBytes: number, invalid: 'INVALID_ENTRY' | 'INVALID_ACCOUNT' = 'INVALID_ENTRY'): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw failure(invalid)
  try {
    if (!c.req.raw.body) throw new Error()
    return JSON.parse(await readBoundedBody(c.req.raw.body, maxBytes, 5_000))
  } catch { throw failure(invalid) }
}
async function execute<T>(c: LedgerContext, name: string, params: Record<string, unknown>, schema: z.ZodType<T>, writing: boolean | 'delete' = false, fallbackMessage?: string): Promise<T> {
  const fallback = writing === 'delete' ? 'DELETE_UNKNOWN' : writing ? 'SAVE_UNKNOWN' : 'LEDGER_UNAVAILABLE'
  try {
    const value = await queryLedger(c.env, c.get('identity').id, name, params)
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw failure(fallback, fallbackMessage)
    return parsed.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DatabaseError && Object.hasOwn(ledgerErrors, error.code)) throw failure(error.code as keyof typeof ledgerErrors)
    throw failure(fallback, fallbackMessage)
  }
}
export async function listLedger(c: LedgerContext) {
  if (Object.values(c.req.queries()).some(values => values.length !== 1)) throw failure('INVALID_QUERY')
  const query = ledgerQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('INVALID_QUERY')
  const params = { p_page: query.data.page, p_start_date: query.data.startDate ?? null, p_end_date: query.data.endDate ?? null, p_version: query.data.version ?? null }
  return c.json(await execute(c, query.data.accountId ? 'ledger_list_by_account' : 'ledger_list', query.data.accountId ? { ...params, p_account_id: query.data.accountId } : params, ledgerPageSchema))
}
export async function detailLedger(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.values(c.req.queries()).some(values => values.length !== 1)) throw failure('INVALID_QUERY')
  const query = ledgerDetailQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('INVALID_QUERY')
  return c.json(await execute(c, 'ledger_detail', { p_id: id.data, p_refund_page: query.data.refundPage, p_version: query.data.version ?? null }, ledgerDetailSchema))
}
export async function createLedger(c: LedgerContext) {
  return c.json(await createLedgerEntry(c, await readInput(c, 16_384)))
}
export async function createLedgerEntry(c: LedgerContext, input: unknown) {
  const value = ledgerCreateSchema.safeParse(input)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return execute(c, 'ledger_create', { p_input: value.data }, ledgerReceiptSchema, true)
}
export async function createLedgerTransfer(c: LedgerContext) {
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerTransferSchema.safeParse(await readInput(c, 16_384))
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return c.json(await execute(c, 'ledger_transfer', { p_input: value.data }, ledgerTransferReceiptSchema, true))
}
export async function refundLedger(c: LedgerContext) {
  const parent = refundParentId(c.req.param('id'))
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await createLedgerRefund(c, parent, await readInput(c, 16_384)))
}
function refundParentId(input: unknown) {
  const parent = z.uuid().safeParse(input)
  if (!parent.success) throw failure('NOT_FOUND')
  return parent.data
}
export async function createLedgerRefund(c: LedgerContext, id: unknown, input: unknown) {
  const parent = refundParentId(id)
  const value = ledgerRefundSchema.safeParse(input)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return execute(c, 'ledger_refund', { p_parent: parent, p_input: value.data }, ledgerReceiptSchema, true)
}

export async function previewLedgerDelete(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await execute(c, 'ledger_delete_preview', { p_id: id.data }, ledgerDeletePreviewSchema))
}
export async function deleteLedger(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerDeleteSchema.safeParse(await readInput(c, 1024))
  if (!value.success) throw failure('INVALID_ENTRY')
  return c.json(await execute(c, 'ledger_delete', { p_id: id.data, p_scope: value.data.scope }, ledgerReceiptSchema, 'delete'))
}
