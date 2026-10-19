import { z } from 'zod'
import { initialState, type AdventureState, type CommandResult } from '../../src/shared/adventure'
import { readBoundedBody } from '../read-body'
import { ApiError } from '../upstream'

const resultSchema = z.object({ entityId: z.string().optional(), reward: z.number(), ledgerIds: z.array(z.string()), achievementIds: z.array(z.string()), levelBefore: z.number(), levelAfter: z.number() })
const stateSchema = z.object({ schemaVersion: z.literal(1), timeZone: z.literal('Asia/Shanghai'), containers: z.array(z.unknown()), goals: z.array(z.unknown()), tasks: z.array(z.unknown()), cycles: z.array(z.unknown()), ledger: z.array(z.unknown()), achievements: z.array(z.unknown()) })
const rowSchema = z.object({ owner_id: z.uuid(), version: z.number().int().nonnegative().safe(), state: stateSchema, journal: z.record(z.string(), z.object({ hash: z.string(), result: resultSchema })) })
export type StoredState = { owner_id: string; state: AdventureState; version: number; journal: Record<string, { hash: string; result: CommandResult }> }
// The compact full-row write budget is deliberately one quarter of the bounded read.
// PostgREST/JSONB formatting and Worker serialization/cloning need headroom.
export const MAX_ADVENTURE_ROW_BYTES = 8_000_000
export const MAX_ADVENTURE_RESPONSE_BYTES = 32_000_000
const unavailable = () => new ApiError('ADVENTURE_UNAVAILABLE', '冒险数据暂时不可用，请稍后重试', 503)

// 每个实例只保存本次已验证 owner；不得将凭据、状态或响应缓存到模块变量。
export class AdventureStore {
  private readonly endpoint: URL
  private readonly headers: Headers
  private readonly maxRowBytes: number
  constructor(env: Partial<CloudflareEnv>, private readonly owner: string, limits?: { maxRowBytes: number }) {
    const requested = limits?.maxRowBytes ?? MAX_ADVENTURE_ROW_BYTES
    if (!Number.isSafeInteger(requested) || requested < 1) throw new RangeError('Invalid storage budget')
    // Tests may lower the budget, but no caller may exceed the production safety limit.
    this.maxRowBytes = Math.min(requested, MAX_ADVENTURE_ROW_BYTES)
    if (!z.uuid().safeParse(owner).success || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw unavailable()
    try { this.endpoint = new URL('/rest/v1/adventure_states', env.SUPABASE_URL) } catch { throw unavailable() }
    if (this.endpoint.protocol !== 'https:') throw unavailable()
    this.headers = new Headers({ apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' })
    if (env.SUPABASE_SECRET_KEY.startsWith('eyJ')) this.headers.set('Authorization', `Bearer ${env.SUPABASE_SECRET_KEY}`)
  }
  private async request(method: string, params: Record<string, string>, body?: unknown, prefer?: string): Promise<StoredState[]> {
    const url = new URL(this.endpoint)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const headers = new Headers(this.headers)
    if (prefer) headers.set('Prefer', prefer)
    try {
      const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw unavailable()
      if (!response.body) { if (method === 'POST') return []; throw unavailable() }
      const text = await readBoundedBody(response.body, MAX_ADVENTURE_RESPONSE_BYTES, 10_000)
      if (!text && method === 'POST') return []
      const parsed = z.array(rowSchema).max(1).safeParse(JSON.parse(text))
      if (!parsed.success || parsed.data.some(row => row.owner_id !== this.owner)) throw unavailable()
      return parsed.data as StoredState[]
    } catch { throw unavailable() }
  }
  private assertFits(candidate: unknown): void {
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > this.maxRowBytes) {
      throw new ApiError('ADVENTURE_CAPACITY_REACHED', '冒险记录已达到当前容量上限，本次操作未保存，原有记录保留', 400)
    }
  }
  async read(): Promise<StoredState | undefined> {
    return (await this.request('GET', { owner_id: `eq.${this.owner}`, select: 'owner_id,state,journal,version', limit: '1' }))[0]
  }
  async load(): Promise<StoredState> {
    const existing = await this.read()
    if (existing) return existing
    // PostgreSQL unique owner_id + ignore-duplicates prevents an initialization race overwriting data.
    const candidate = { owner_id: this.owner, state: initialState(), journal: {}, version: 0, updated_at: new Date().toISOString() }
    this.assertFits(candidate)
    await this.request('POST', { on_conflict: 'owner_id' }, candidate, 'resolution=ignore-duplicates,return=minimal')
    const created = await this.read()
    if (!created) throw unavailable()
    return created
  }
  async compareAndSwap(previous: StoredState, state: AdventureState, journal: StoredState['journal'], now: string): Promise<StoredState | undefined> {
    if (previous.owner_id !== this.owner || !Number.isSafeInteger(previous.version + 1)) throw unavailable()
    // Validate the full future row before any mutation can reach PostgreSQL.
    const candidate = { owner_id: this.owner, state, journal, version: previous.version + 1, updated_at: now }
    this.assertFits(candidate)
    return (await this.request('PATCH', { owner_id: `eq.${this.owner}`, version: `eq.${previous.version}`, select: 'owner_id,state,journal,version' }, { state, journal, version: previous.version + 1, updated_at: now }, 'return=representation'))[0]
  }
}
