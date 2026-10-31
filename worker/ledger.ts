import { z } from 'zod'
import type { Context } from 'hono'
import type { AuthEnv, Identity } from './auth'
import { ApiError } from './upstream'
import { readBoundedBody } from './read-body'
import { ledgerCreateSchema, ledgerDetailSchema, ledgerErrors, ledgerPageSchema, ledgerQuerySchema, ledgerReceiptSchema, ledgerRefundSchema } from '../src/shared/ledger'

type LedgerContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
function failure(code: keyof typeof ledgerErrors, message?: string) {
  const [status, text] = ledgerErrors[code]
  return new ApiError(code, message ?? text, status)
}
async function rpc<T>(c: LedgerContext, name: string, params: Record<string, unknown>, schema: z.ZodType<T>, writing = false): Promise<T> {
  const fallback = writing ? 'SAVE_UNKNOWN' : 'LEDGER_UNAVAILABLE'
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = c.env
  if (!base || !key) throw failure(fallback)
  try {
    const url = new URL(`/rest/v1/rpc/${name}`, base)
    if (url.protocol !== 'https:' || url.username || url.password) throw failure(fallback)
    const headers = new Headers({ apikey: key, 'Content-Type': 'application/json' })
    if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
    const response = await fetch(url, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000), body: JSON.stringify({ ...params, p_owner: c.get('identity').id }) })
    if (!response.body) throw failure(fallback)
    const value: unknown = JSON.parse(await readBoundedBody(response.body, 1_048_576, 10_000))
    if (!response.ok) {
      const parsed = z.object({ message: z.string() }).safeParse(value)
      if (parsed.success && Object.hasOwn(ledgerErrors, parsed.data.message)) throw failure(parsed.data.message as keyof typeof ledgerErrors)
      throw failure(fallback)
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw failure(fallback)
    return parsed.data
  } catch (error) { if (error instanceof ApiError) throw error; throw failure(fallback) }
}
export async function listLedger(c: LedgerContext) {
  const query = ledgerQuerySchema.safeParse(c.req.query())
  if (!query.success) throw failure('INVALID_QUERY')
  return c.json(await rpc(c, 'ledger_list', { p_page: query.data.page }, ledgerPageSchema))
}
export async function detailLedger(c: LedgerContext) {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  return c.json(await rpc(c, 'ledger_detail', { p_id: id.data }, ledgerDetailSchema))
}
export async function createLedger(c: LedgerContext) {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw failure('INVALID_ENTRY')
  let raw: unknown
  try { if (!c.req.raw.body) throw new Error(); raw = JSON.parse(await readBoundedBody(c.req.raw.body, 16_384, 5_000)) }
  catch { throw failure('INVALID_ENTRY') }
  const value = ledgerCreateSchema.safeParse(raw)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return c.json(await rpc(c, 'ledger_create', { p_input: value.data }, ledgerReceiptSchema, true))
}
export async function refundLedger(c: LedgerContext) {
  const parent = z.uuid().safeParse(c.req.param('id'))
  if (!parent.success) throw failure('NOT_FOUND')
  if (Object.keys(c.req.query()).length) throw failure('INVALID_QUERY')
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw failure('INVALID_ENTRY')
  let raw: unknown
  try { if (!c.req.raw.body) throw new Error(); raw = JSON.parse(await readBoundedBody(c.req.raw.body, 16_384, 5_000)) }
  catch { throw failure('INVALID_ENTRY') }
  const value = ledgerRefundSchema.safeParse(raw)
  if (!value.success) throw failure('INVALID_ENTRY', value.error.issues[0]?.message)
  if (Date.parse(value.data.occurredAt) > Date.now()) throw failure('FUTURE_TIME')
  return c.json(await rpc(c, 'ledger_refund', { p_parent: parent.data, p_input: value.data }, ledgerReceiptSchema, true))
}
