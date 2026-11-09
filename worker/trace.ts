import { AsyncLocalStorage } from 'node:async_hooks'
import { BodyLimitError } from './read-body'

type AttributeValue = string | number | boolean
type TraceSpan = {
  setAttribute(key: string, value: AttributeValue): unknown
  setAttributes?(attributes: Record<string, AttributeValue | undefined>): unknown
}
type UpstreamFailure = 'network' | 'timeout' | 'invalid-response'
type WorkersTracing = { getActiveSpan(): TraceSpan | undefined }

const roots = new AsyncLocalStorage<TraceSpan | undefined>()
const remembered = new WeakMap<object, TraceSpan>()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const testSpanKey = Symbol.for('lifespace.trace.test-span')
type GlobalWithSpan = typeof globalThis & { [testSpanKey]?: TraceSpan }

// 真实 Worker 在运行时加载 cloudflare:workers。Vitest 和 Vite 的 Node 加载器没有这个协议，失败时保持无操作。
const workersModule = 'cloudflare:' + 'workers'
let workersTracing: WorkersTracing | undefined
try {
  const loaded = await import(/* @vite-ignore */ workersModule) as { tracing?: WorkersTracing }
  if (typeof loaded.tracing?.getActiveSpan === 'function') workersTracing = loaded.tracing
} catch { /* 测试环境没有该模块。 */ }

function activeSpan(): TraceSpan | undefined {
  try {
    const span = workersTracing?.getActiveSpan()
    if (span) return span
  } catch { /* 采样或运行时不可用时继续走测试桩。 */ }
  return (globalThis as GlobalWithSpan)[testSpanKey]
}

// 在任何上游 fetch 之前记下本次调用的根 span。onError 发生在中间件异步上下文之外，因此同时按请求对象记住它。
export function beginTrace(request: object): TraceSpan | undefined {
  const span = activeSpan()
  if (span) remembered.set(request, span)
  return span
}

export function withRootSpan<T>(span: TraceSpan | undefined, run: () => T): T {
  return roots.run(span, run)
}

function targetSpan(request?: object): TraceSpan | undefined {
  if (request) {
    const saved = remembered.get(request)
    if (saved) return saved
  }
  return roots.getStore() ?? activeSpan()
}

function annotate(attributes: Record<string, AttributeValue | undefined>, request?: object) {
  let span: TraceSpan | undefined
  try { span = targetSpan(request) } catch { return }
  if (!span) return
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue
    try { span.setAttribute(key, value) } catch { return }
  }
}

export function routePath(route: string | undefined): string | undefined {
  if (!route) return undefined
  const path = route.split(/[?#]/, 1)[0]
  if (!path?.startsWith('/') || path.includes('://') || path.includes('@') || path.includes('\\')) return undefined
  return path
}

export function traceIdentity(userId: string, sessionId: string, route?: string) {
  if (!uuid.test(userId) || !uuid.test(sessionId)) return
  annotate({ 'user.id': userId, 'session.id': sessionId, 'http.route': routePath(route) })
}

export function traceErrorCode(code: string, route?: string, request?: object) {
  if (!/^[A-Z0-9_]+$/.test(code)) return
  annotate({ 'error.code': code, 'http.route': routePath(route) }, request)
}

export function traceUpstreamStatus(status: number) {
  if (!Number.isInteger(status) || status < 100 || status > 599) return
  annotate({ 'upstream.http.status_code': status })
}

export function traceUpstreamFailure(type: UpstreamFailure) {
  annotate({ 'upstream.failure': type })
}

export function upstreamFailureType(error: unknown): UpstreamFailure {
  if (error instanceof SyntaxError || error instanceof BodyLimitError) return 'invalid-response'
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout'
  return 'network'
}
