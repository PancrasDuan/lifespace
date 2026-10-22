import { z } from 'zod'
import { beijingDate, horoscopeDeadline, horoscopeSchema, isCurrentHoroscope, signSchema, type Horoscope, type HoroscopeResult, type ZodiacSign } from '../src/shared/horoscope-contracts'
import { ApiError } from './upstream'
import { BodyLimitError, readBoundedBody } from './read-body'

// 仅包含外部 binding 的必要操作；缺失配置时保持正式服务的未配置状态。
export type HoroscopeEnv = { ALAPI_TOKEN?: string; HOROSCOPE_KV?: Pick<KVNamespace, 'get' | 'put'> }
type Flight = { until: number; result?: HoroscopeResult; error?: { code: string; message: string; status: ApiError['status'] } }
type State = { pending: Map<string, Flight>; nextRead: number; blocked?: { until: number; error: ApiError } }
// 只共享普通数据与时间标记，不跨请求保存 Promise、Response、流、账户或凭据。
const states = new WeakMap<object, State>()
const failure = (code: string, message: string, status: 429 | 502 | 503 | 504 = 502) => new ApiError(code, message, status)
const notUpdated = () => failure('HOROSCOPE_NOT_UPDATED', '今日运势暂未更新', 503)
const invalid = () => failure('HOROSCOPE_INVALID_RESPONSE', '运势数据暂时不可用，请稍后重新读取')
const rawText = z.string().max(12000).nullish().transform(value => value?.trim() || null)
const rawLuckyText = z.union([z.string(), z.number().finite()]).nullish().transform(value => value == null ? null : String(value).trim() || null)
const rawScore = z.string().regex(/^\d{1,3}%$/).transform(value => Number(value.slice(0, -1))).pipe(z.number().int().min(0).max(100)).nullish().transform(value => value ?? null)
const daySchema = z.object({
  date: z.iso.date(), all: rawScore, love: rawScore, work: rawScore, money: rawScore, health: rawScore,
  all_text: rawText, love_text: rawText, work_text: rawText, money_text: rawText, health_text: rawText,
  lucky_color: rawText, lucky_number: rawLuckyText, lucky_star: rawText, notice: rawText, yi: rawText, ji: rawText,
})
const envelopeSchema = z.object({ success: z.boolean(), code: z.number(), data: z.unknown().optional() })

async function readAlapi(token: string, sign: ZodiacSign, date: string): Promise<Horoscope> {
  try {
    const response = await fetch('https://v3.alapi.cn/api/star', {
      method: 'POST', headers: { token, 'Content-Type': 'application/json' }, body: JSON.stringify({ star: sign }),
      redirect: 'manual', signal: AbortSignal.timeout(10000),
    })
    if (response.status === 429) throw failure('HOROSCOPE_RATE_LIMITED', '运势读取过于频繁，请稍后重新读取', 429)
    if (response.status === 401 || response.status === 403) throw failure('HOROSCOPE_TOKEN_INVALID', '运势数据源授权失效，请检查服务端配置')
    if (!response.ok) throw failure('HOROSCOPE_SOURCE_UNAVAILABLE', '运势数据源暂时不可用')
    if (!response.body) throw invalid()
    const envelope = envelopeSchema.safeParse(JSON.parse(await readBoundedBody(response.body, 256000, 10000)))
    if (!envelope.success) throw invalid()
    const value = envelope.data
    if (!value.success || value.code !== 200) {
      if (value.code === 10010) throw failure('HOROSCOPE_QUOTA_EXHAUSTED', '今日运势接口额度已用完，请明日再试', 503)
      if ([10001, 10002, 10003, 10004, 10008, 10009].includes(value.code)) throw failure('HOROSCOPE_TOKEN_INVALID', '运势数据源授权失效，请检查服务端配置')
      if ([10006, 10007].includes(value.code)) throw failure('HOROSCOPE_ACCESS_DENIED', '运势数据源访问受限，请检查服务端配置')
      if (value.code === 10005) throw failure('HOROSCOPE_QUOTA_UNAVAILABLE', '运势数据源额度不足，请稍后再试', 503)
      if (value.code === 429) throw failure('HOROSCOPE_RATE_LIMITED', '运势读取过于频繁，请稍后重新读取', 429)
      throw failure('HOROSCOPE_BUSINESS_ERROR', '运势数据源请求失败，请稍后重新读取')
    }
    const data = z.object({ star: z.string().optional(), day: daySchema }).safeParse(value.data)
    if (!data.success || (data.data.star !== undefined && data.data.star !== sign)) throw invalid()
    const day = data.data.day
    if (day.date < date) throw notUpdated()
    if (day.date !== date) throw invalid()
    if (beijingDate(Date.now()) !== date) throw notUpdated()
    const normalized = horoscopeSchema.safeParse({
      version: 1, source: 'ALAPI', sign, dataDate: day.date, fetchedAt: new Date().toISOString(),
      validUntil: new Date(horoscopeDeadline(date)).toISOString(),
      scores: { all: day.all, love: day.love, work: day.work, money: day.money, health: day.health },
      texts: { all: day.all_text, love: day.love_text, work: day.work_text, money: day.money_text, health: day.health_text },
      lucky: { color: day.lucky_color, number: day.lucky_number, sign: day.lucky_star }, notice: day.notice, yi: day.yi, ji: day.ji,
    })
    if (!normalized.success) throw invalid()
    return normalized.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof SyntaxError || error instanceof BodyLimitError) throw invalid()
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw failure('HOROSCOPE_TIMEOUT', '运势读取超时，请稍后重新读取', 504)
    throw failure('HOROSCOPE_SOURCE_UNAVAILABLE', '运势数据源暂时不可用')
  }
}

export async function readHoroscope(env: HoroscopeEnv, params: URLSearchParams): Promise<HoroscopeResult> {
  const selected = signSchema.safeParse(params.get('sign'))
  if (!selected.success || [...params.keys()].some(key => key !== 'sign') || params.getAll('sign').length !== 1) throw new ApiError('HOROSCOPE_SIGN_INVALID', '请选择有效星座', 400)
  const kv = env.HOROSCOPE_KV
  const token = env.ALAPI_TOKEN
  if (!kv || !token?.trim()) throw failure('HOROSCOPE_NOT_CONFIGURED', '服务尚未配置', 503)
  const sign = selected.data
  const date = beijingDate(Date.now())
  const key = `horoscope:v1:alapi:Asia-Shanghai:${date}:${sign}`
  let state = states.get(kv)
  if (!state) { state = { pending: new Map(), nextRead: 0 }; states.set(kv, state) }
  for (const [pendingKey, flight] of state.pending) if (flight.until <= Date.now()) state.pending.delete(pendingKey)
  const existing = state.pending.get(key)
  if (existing) {
    // 等待属于当前请求；首请求取消或耗时较长时有限退出，由使用者重新读取。
    await new Promise<void>(resolve => setTimeout(resolve, 1100))
    if (beijingDate(Date.now()) !== date) throw notUpdated()
    if (existing.result && isCurrentHoroscope(existing.result, sign, Date.now())) return existing.result
    if (existing.error) throw new ApiError(existing.error.code, existing.error.message, existing.error.status)
    throw failure('HOROSCOPE_RATE_LIMITED', '运势正在读取，请稍后重新读取', 429)
  }
  const currentState = state
  const flight: Flight = { until: Date.now() + 12000 }
  currentState.pending.set(key, flight)
  const read = async (): Promise<HoroscopeResult> => {
    let cached: unknown
    try {
      const stored = await kv.get(key)
      if (stored && stored.length <= 256000) { try { cached = JSON.parse(stored) } catch { /* 损坏缓存按未命中处理。 */ } }
    } catch { throw failure('HOROSCOPE_CACHE_UNAVAILABLE', '运势缓存暂时不可用，请稍后重新读取', 503) }
    if (beijingDate(Date.now()) !== date) throw notUpdated()
    const decoded = horoscopeSchema.safeParse(cached)
    if (decoded.success && isCurrentHoroscope(decoded.data, sign, Date.now())) return { ...decoded.data, cacheHit: true }
    if (currentState.blocked && Date.now() < currentState.blocked.until) throw currentState.blocked.error
    if (Date.now() < currentState.nextRead) throw failure('HOROSCOPE_RATE_LIMITED', '运势读取过于频繁，请稍后重新读取', 429)
    currentState.nextRead = Date.now() + 1100
    let data: Horoscope
    try { data = await readAlapi(token, sign, date) }
    catch (error) {
      const safeError = error instanceof ApiError ? error : invalid()
      currentState.blocked = { until: safeError.code === 'HOROSCOPE_QUOTA_EXHAUSTED' ? horoscopeDeadline(date) : Date.now() + 10000, error: safeError }
      throw safeError
    }
    let warning: string | undefined
    if (horoscopeDeadline(date) - Date.now() >= 60000) {
      try { await kv.put(key, JSON.stringify(data), { expiration: horoscopeDeadline(date) / 1000 }) }
      catch {
        warning = '本次运势已获取，缓存暂存失败'
        currentState.blocked = { until: Date.now() + 60000, error: failure('HOROSCOPE_CACHE_UNAVAILABLE', '运势缓存暂时不可用，请稍后重新读取', 503) }
        console.warn(JSON.stringify({ event: 'horoscope_cache_write_failed' }))
      }
    }
    if (!isCurrentHoroscope(data, sign, Date.now())) throw notUpdated()
    return { ...data, cacheHit: false, ...(warning ? { warning } : {}) }
  }
  try {
    const result = await read()
    flight.result = result
    return result
  } catch (error) {
    if (error instanceof ApiError) flight.error = { code: error.code, message: error.message, status: error.status }
    throw error
  } finally { if (currentState.pending.get(key) === flight) currentState.pending.delete(key) }
}
