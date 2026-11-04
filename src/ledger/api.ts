import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { ledgerAccountsSchema, ledgerAccountReceiptSchema, ledgerDeletePreviewSchema, ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema, ledgerTransferReceiptSchema, type LedgerTransfer, type LedgerAccountCreate, type LedgerAccountUpdate, type LedgerCreate, type LedgerRefund } from '../shared/ledger'
import type { DateRange } from './dates'
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export class LedgerError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
async function parse<T>(response: Response, schema: z.ZodType<T>, writing = false): Promise<T> {
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = errorSchema.safeParse(value)
    if (failure.success) throw new LedgerError(failure.data.error.code, failure.data.error.message)
  }
  const parsed = response.ok && schema.safeParse(value)
  if (!parsed || !parsed.success) throw new LedgerError(writing ? 'SAVE_UNKNOWN' : 'LEDGER_UNAVAILABLE', writing ? '保存结果未确认' : '暂时无法读取账单')
  return parsed.data
}
export const readLedger = async (owner: string, page: number, signal: AbortSignal, range: DateRange | null = null, version?: number) => {
  const query = new URLSearchParams({ page: String(page) })
  if (range) { query.set('startDate', range.start); query.set('endDate', range.end) }
  if (version !== undefined) query.set('version', String(version))
  return parse(await authorizedFetch(`/api/ledger/entries?${query}`, signal, owner), ledgerPageSchema)
}
export const readLedgerDetail = async (owner: string, id: string, signal: AbortSignal, refundPage = 1, version?: number) => {
  const query = new URLSearchParams({ refundPage: String(refundPage) })
  if (version !== undefined) query.set('version', String(version))
  return parse(await authorizedFetch(`/api/ledger/entries/${id}?${query}`, signal, owner), ledgerDetailSchema)
}
async function saveEntry(path: string, owner: string, input: LedgerCreate | LedgerRefund, signal: AbortSignal) {
  try { return await parse(await authorizedMutation(path, JSON.stringify(input), signal, owner), ledgerReceiptSchema, true) }
  catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('SAVE_UNKNOWN', '保存结果未确认，请沿用原请求重试或刷新查看流水')
  }
}
export const saveLedger = (owner: string, input: LedgerCreate, signal: AbortSignal) => saveEntry('/api/ledger/entries', owner, input, signal)
export async function saveTransfer(owner: string, input: LedgerTransfer, signal: AbortSignal) {
  try { return await parse(await authorizedMutation('/api/ledger/transfers', JSON.stringify(input), signal, owner), ledgerTransferReceiptSchema, true) }
  catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('SAVE_UNKNOWN', '保存结果未确认，请沿用原请求重试或刷新查看流水')
  }
}
export const readLedgerAccounts = async (owner: string, signal: AbortSignal) => parse(await authorizedFetch('/api/ledger/accounts', signal, owner), ledgerAccountsSchema)
export async function saveLedgerAccount(owner: string, input: LedgerAccountCreate | LedgerAccountUpdate, signal: AbortSignal, id?: string) {
  try {
    return await parse(await authorizedMutation(id ? `/api/ledger/accounts/${id}` : '/api/ledger/accounts', JSON.stringify(input), signal, owner, id ? 'PATCH' : 'POST'), ledgerAccountReceiptSchema, true)
  } catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('SAVE_UNKNOWN', '保存结果未确认，请重试原请求或刷新查看账户')
  }
}
export async function saveRefund(owner: string, parentId: string, input: LedgerRefund, signal: AbortSignal) {
  return saveEntry(`/api/ledger/entries/${parentId}/refunds`, owner, input, signal)
}

export const readDeletePreview = async (owner: string, id: string, signal: AbortSignal) => parse(await authorizedFetch(`/api/ledger/entries/${id}/delete-preview`, signal, owner), ledgerDeletePreviewSchema)
export async function deleteLedger(owner: string, id: string, scope: string, signal: AbortSignal) {
  try { return await parse(await authorizedMutation(`/api/ledger/entries/${id}/delete`, JSON.stringify({ scope }), signal, owner), ledgerReceiptSchema, true) }
  catch (error) {
    if (error instanceof LedgerError && error.code !== 'SAVE_UNKNOWN') throw error
    throw new LedgerError('DELETE_UNKNOWN', '删除结果未确认，请重试删除或查看最新流水')
  }
}
