export class BodyLimitError extends Error {}

// 限制流的总体积与读取时间；调用方负责映射各接口的错误语义。
export async function readBoundedBody(body: ReadableStream<Uint8Array>, limit: number, timeoutMs: number): Promise<string> {
  const reader = body.getReader()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined) }, timeoutMs)
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (timedOut) throw new DOMException('Body read timed out', 'TimeoutError')
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new BodyLimitError('Body exceeds limit') }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(bytes)
  } finally { clearTimeout(timer); reader.releaseLock() }
}
