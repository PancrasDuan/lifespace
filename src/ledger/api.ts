import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import { ledgerDetailSchema, ledgerPageSchema, ledgerReceiptSchema, type LedgerCreate, type LedgerRefund } from '../shared/ledger'
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
export const readLedger = async (owner: string, page: number, signal: AbortSignal) => parse(await authorizedFetch(`/api/ledger/entries?page=${page}`, signal, owner), ledgerPageSchema)
export const readLedgerDetail = async (owner: string, id: string, signal: AbortSignal) => parse(await authorizedFetch(`/api/ledger/entries/${id}`, signal, owner), ledgerDetailSchema)
export async function saveLedger(owner: string, input: LedgerCreate, signal: AbortSignal) {
  try { return await parse(await authorizedMutation('/api/ledger/entries', JSON.stringify(input), signal, owner), ledgerReceiptSchema, true) }
  catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('SAVE_UNKNOWN', '保存结果未确认，请沿用原请求重试或刷新查看流水')
  }
}
export async function saveRefund(owner: string, parentId: string, input: LedgerRefund, signal: AbortSignal) {
  try { return await parse(await authorizedMutation(`/api/ledger/entries/${parentId}/refunds`, JSON.stringify(input), signal, owner), ledgerReceiptSchema, true) }
  catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('SAVE_UNKNOWN', '保存结果未确认，请沿用原请求重试或刷新查看流水')
  }
}
