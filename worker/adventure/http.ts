import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import type { Context } from 'hono'
import { commandSchema, executeCommand, DomainError } from '../../src/shared/adventure'
import type { AuthEnv, Identity } from '../auth'
import { readBoundedBody, BodyLimitError } from '../read-body'
import { ApiError } from '../upstream'
import { AdventureStore, type StoredState } from './store'

type AdventureContext = Context<{ Bindings: AuthEnv; Variables: { identity: Identity } }>
const envelope = z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), expectedVersion: z.number().int().nonnegative().safe(), command: commandSchema })
const publicState = (row: StoredState, today: string) => ({ state: row.state, version: row.version, today })
function clock() { const now = Temporal.Now.instant(); return { now: now.toString(), today: now.toZonedDateTimeISO('Asia/Shanghai').toPlainDate().toString() } }
// Canonicalize object property order, while preserving array order, for stable retry payload identity.
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`; return JSON.stringify(value) }
async function digest(value: unknown) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('') }

export async function getAdventure(c: AdventureContext) {
  const ctx = clock(), store = new AdventureStore(c.env, c.get('identity').id)
  return c.json(publicState(await store.load(), ctx.today))
}
export async function adventureCommand(c: AdventureContext) {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json({ error: { code: 'INVALID_COMMAND', message: '请发送 JSON 命令' } }, 400)
  let input: z.infer<typeof envelope>
  try {
    if (!c.req.raw.body) throw new Error('empty')
    const parsed = envelope.safeParse(JSON.parse(await readBoundedBody(c.req.raw.body, 131_072, 5_000)))
    if (!parsed.success) throw new Error('invalid')
    input = parsed.data
  } catch (error) {
    return c.json({ error: { code: error instanceof BodyLimitError ? 'COMMAND_TOO_LARGE' : 'INVALID_COMMAND', message: '命令字段或内容无效' } }, 400)
  }
  const ctx = clock(), store = new AdventureStore(c.env, c.get('identity').id)
  // expectedVersion is intentionally excluded: a retried stable command may follow a read of newer state.
  const hash = await digest(input.command)
  const journalKey = `request:${input.requestId}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.load()
    const prior = Object.hasOwn(row.journal, journalKey) ? row.journal[journalKey] : undefined
    if (prior) {
      if (prior.hash !== hash) return c.json({ error: { code: 'REQUEST_ID_REUSED', message: '此请求编号已用于其他操作，请重新确认' } }, 409)
      return c.json({ ...publicState(row, ctx.today), result: prior.result })
    }
    if (input.command.type !== 'refresh' && row.version !== input.expectedVersion) return c.json({ error: { code: 'VERSION_CONFLICT', message: '其他页面已更新数据，请刷新后重新确认' } }, 409)
    let execution
    try { execution = executeCommand(row.state, input.command, ctx) }
    catch (error) {
      if (error instanceof DomainError) return c.json({ error: { code: error.code, message: error.message } }, error.code === 'NOT_FOUND' ? 404 : 400)
      throw new ApiError('ADVENTURE_UNAVAILABLE', '冒险数据暂时不可用，请稍后重试', 503)
    }
    const journal = { ...row.journal, [journalKey]: { hash, result: execution.result } }
    const saved = await store.compareAndSwap(row, execution.state, journal, ctx.now)
    if (saved) return c.json({ ...publicState(saved, ctx.today), result: execution.result })
    if (input.command.type !== 'refresh') {
      // One final read resolves an identical simultaneous retry without replaying another user's intent.
      const latest = await store.load(), replay = Object.hasOwn(latest.journal, journalKey) ? latest.journal[journalKey] : undefined
      if (replay?.hash === hash) return c.json({ ...publicState(latest, ctx.today), result: replay.result })
      return c.json({ error: { code: replay ? 'REQUEST_ID_REUSED' : 'VERSION_CONFLICT', message: '数据已更新，请刷新后重新确认' } }, 409)
    }
  }
  return c.json({ error: { code: 'VERSION_CONFLICT', message: '数据正在更新，请稍后刷新' } }, 409)
}
