import { z } from 'zod'
import { domainsResultSchema, locationsResultSchema, tasksResultSchema, weatherResultSchema, type City } from '../shared/contracts'

export class ClientError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const failureSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })

async function request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  let response: Response
  try { response = await fetch(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }) }
  catch (error) {
    if (signal.aborted) throw error
    throw new ClientError('NETWORK_UNAVAILABLE', '连接失败或请求超时，请刷新重试')
  }
  let body: unknown
  try { body = await response.json() }
  catch { throw new ClientError('INVALID_RESPONSE', '服务返回了无效内容，请刷新重试') }
  if (!response.ok) {
    const failure = failureSchema.safeParse(body)
    throw failure.success ? new ClientError(failure.data.error.code, failure.data.error.message) : new ClientError('REQUEST_FAILED', '获取失败，请刷新重试')
  }
  const decoded = schema.safeParse(body)
  if (!decoded.success) throw new ClientError('INVALID_RESPONSE', '服务返回了无效内容，请刷新重试')
  return decoded.data
}
export const api = {
  domains: (signal: AbortSignal) => request('/api/domains', domainsResultSchema, signal),
  todayTasks: (timeZone: string, signal: AbortSignal) => request(`/api/tasks/today?${new URLSearchParams({ timeZone })}`, tasksResultSchema, signal),
  weather: (city: City, signal: AbortSignal) => request(`/api/weather?${new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude) })}`, weatherResultSchema, signal),
  locations: (query: string, signal: AbortSignal) => request(`/api/weather/locations?${new URLSearchParams({ q: query })}`, locationsResultSchema, signal),
}
