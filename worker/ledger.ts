import { z } from 'zod'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from './auth'
import { ApiError } from './upstream'
import { readBoundedBody } from './read-body'
import { ledgerTransferSchema, ledgerTransferReceiptSchema, ledgerAccountCreateSchema, ledgerAccountUpdateSchema, ledgerAccountReceiptSchema, ledgerAccountsSchema, ledgerCreateSchema, ledgerDeletePreviewSchema, ledgerDeleteSchema, ledgerDetailQuerySchema, ledgerDetailSchema, ledgerErrors, ledgerPageSchema, ledgerQuerySchema, ledgerReceiptSchema, ledgerRefundSchema } from '../src/shared/ledger'

type LedgerContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
function failure(code: keyof typeof ledgerErrors, message?: string) {
  const [status, text] = ledgerErrors[code]
  return new ApiError(code, message ?? text, status)
}
export async function listLedgerAccounts(c: LedgerContext) {
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await readLedgerAccounts(c))
}
export async function readLedgerAccounts(c: LedgerContext) {
  return rpc(c, 'ledger_accounts_list', {}, ledgerAccountsSchema, false, '暂时无法读取账户，请稍后重试')
}
export async function createLedgerAccount(c: LedgerContext) {
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerAccountCreateSchema.safeParse(await readInput(c, 4096, 'INVALID_ACCOUNT'))
  if (!value.success) throw failure('INVALID_ACCOUNT', value.error.issues[0]?.message)
  return c.json(await rpc(c, 'ledger_account_create', { p_input: value.data }, ledgerAccountReceiptSchema, true, '保存结果未确认，请沿用原请求重试或刷新查看账户'))
}
export async function updateLedgerAccount(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('ACCOUNT_NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerAccountUpdateSchema.safeParse(await readInput(c, 4096, 'INVALID_ACCOUNT'))
  if (!value.success) throw failure('INVALID_ACCOUNT', value.error.issues[0]?.message)
  return c.json(await rpc(c, 'ledger_account_update', { p_id: id.data, p_input: value.data }, ledgerAccountReceiptSchema, true, '保存结果未确认，请沿用原请求重试或刷新查看账户'))
}
async function readInput(c: LedgerContext, maxBytes: number, invalid: 'INVALID_ENTRY' | 'INVALID_ACCOUNT' = 'INVALID_ENTRY'): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw failure(invalid)
  try {
    if (!c.req.raw.body) throw new Error()
    return JSON.parse(await readBoundedBody(c.req.raw.body, maxBytes, 5_000))
  } catch { throw failure(invalid) }
}
async function rpc<T>(c: LedgerContext, name: string, params: Record<string, unknown>, schema: z.ZodType<T>, writing: boolean | 'delete' = false, fallbackMessage?: string): Promise<T> {
  const fallback = writing === 'delete' ? 'DELETE_UNKNOWN' : writing ? 'SAVE_UNKNOWN' : 'LEDGER_UNAVAILABLE'
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = c.env
  if (!base || !key) throw failure(fallback, fallbackMessage)
  try {
    const url = new URL(`/rest/v1/rpc/${name}`, base)
    if (url.protocol !== 'https:' || url.username || url.password) throw failure(fallback, fallbackMessage)
    const headers = new Headers({ apikey: key, 'Content-Type': 'application/json' })
    if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
    const response = await fetch(url, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000), body: JSON.stringify({ ...params, p_owner: c.get('identity').id }) })
    if (!response.body) throw failure(fallback, fallbackMessage)
    const value: unknown = JSON.parse(await readBoundedBody(response.body, 1_048_576, 10_000))
    if (!response.ok) {
      const parsed = z.object({ message: z.string() }).safeParse(value)
      if (parsed.success && Object.hasOwn(ledgerErrors, parsed.data.message)) throw failure(parsed.data.message as keyof typeof ledgerErrors)
      throw failure(fallback, fallbackMessage)
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw failure(fallback, fallbackMessage)
    return parsed.data
  } catch (error) { if (error instanceof ApiError) throw error; throw failure(fallback, fallbackMessage) }
}
export async function listLedger(c: LedgerContext) {
  if (Object.values(c.req.queries()).some(values => values.length !== 1)) throw failure('INVALID_QUERY')
  const query = ledgerQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('INVALID_QUERY')
  const params = { p_page: query.data.page, p_start_date: query.data.startDate ?? null, p_end_date: query.data.endDate ?? null, p_version: query.data.version ?? null }
  return c.json(await rpc(c, query.data.accountId ? 'ledger_list_by_account' : 'ledger_list', query.data.accountId ? { ...params, p_account_id: query.data.accountId } : params, ledgerPageSchema))
}
export async function detailLedger(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.values(c.req.queries()).some(values => values.length !== 1)) throw failure('INVALID_QUERY')
  const query = ledgerDetailQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('INVALID_QUERY')
  return c.json(await rpc(c, 'ledger_detail', { p_id: id.data, p_refund_page: query.data.refundPage, p_version: query.data.version ?? null }, ledgerDetailSchema))
}
export async function createLedger(c: LedgerContext) {
  return c.json(await createLedgerEntry(c, await readInput(c, 16_384)))
}
export async function createLedgerEntry(c: LedgerContext, input: unknown) {
  const value = ledgerCreateSchema.safeParse(input)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return rpc(c, 'ledger_create', { p_input: value.data }, ledgerReceiptSchema, true)
}
export async function createLedgerTransfer(c: LedgerContext) {
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerTransferSchema.safeParse(await readInput(c, 16_384))
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return c.json(await rpc(c, 'ledger_transfer', { p_input: value.data }, ledgerTransferReceiptSchema, true))
}
export async function refundLedger(c: LedgerContext) {
  const parent = z.uuid().safeParse(c.req.param('id'))
  if (!parent.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await createLedgerRefund(c, parent.data, await readInput(c, 16_384)))
}
export async function createLedgerRefund(c: LedgerContext, parentEntryId: string, input: unknown) {
  const value = ledgerRefundSchema.safeParse(input)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return rpc(c, 'ledger_refund', { p_parent: parentEntryId, p_input: value.data }, ledgerReceiptSchema, true)
}

export async function previewLedgerDelete(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await rpc(c, 'ledger_delete_preview', { p_id: id.data }, ledgerDeletePreviewSchema))
}
export async function deleteLedger(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  const value = ledgerDeleteSchema.safeParse(await readInput(c, 1024))
  if (!value.success) throw failure('INVALID_ENTRY')
  return c.json(await rpc(c, 'ledger_delete', { p_id: id.data, p_scope: value.data.scope }, ledgerReceiptSchema, 'delete'))
}
