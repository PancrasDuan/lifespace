import { z } from 'zod'

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 502 | 503 | 504) { super(message) }
}

// 第三方响应限制体积与读取时间；原始响应及凭据不进入用户错误信息。
export async function upstream<T>(url: URL, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ApiError('SOURCE_CONNECTION_INVALID', '数据源连接失效，请检查服务端配置', 502)
      throw new ApiError('SOURCE_UNAVAILABLE', '数据源暂时不可用，请稍后刷新', 502)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError('SOURCE_INVALID_RESPONSE', '数据源返回了无效内容', 502)
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) { await reader.cancel(); throw new ApiError('SOURCE_INVALID_RESPONSE', '数据源响应过大', 502) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const decoded = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (!decoded.success) throw new ApiError('SOURCE_INVALID_RESPONSE', '数据源返回了无效内容', 502)
    return decoded.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new ApiError('SOURCE_TIMEOUT', '数据源请求超时，请稍后刷新', 504)
    throw new ApiError('SOURCE_UNAVAILABLE', '数据源暂时不可用，请稍后刷新', 502)
  }
}
