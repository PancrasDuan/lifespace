import { readBoundedBody } from './read-body'
import { ledgerCategories, ledgerErrors, ledgerLimits } from '../src/shared/ledger'
import { ApiError } from './upstream'
import { z } from 'zod'

const version = '2025-11-25'
const supportedVersions = ['2025-03-26', '2025-06-18', version]
const labels = (categories: ReadonlyArray<readonly [string, string]>) => categories.map(([code, label]) => `${code}：${label}`).join('、')
const tools = [
  {
    name: 'list_ledger_accounts', description: '查询当前用户的全部交易账户及余额。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_ledger_entry',
    description: '创建当前用户的一笔普通收入或支出。提交前必须完整展示收支类型、金额、交易时间、交易账户、分类和备注，等待用户明确确认；修改任何字段后再次完整展示并确认。每笔生成唯一 requestId；结果未知时仅用原 requestId 和完全相同参数重试，不得生成新编号重试。',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        requestId: { type: 'string', format: 'uuid', description: '本次请求唯一 UUID，未知结果重试必须保持不变。' },
        direction: { type: 'string', enum: ['expense', 'income'], description: 'expense 为支出，income 为收入。' },
        amountCents: { type: 'integer', minimum: -ledgerLimits.amountCents, maximum: ledgerLimits.amountCents, description: '人民币整数分，支出为负、收入为正，不可为零。' },
        occurredAt: { type: 'string', format: 'date-time', description: '交易实际时间，UTC ISO 8601，精确到秒，不得晚于当前时间。' },
        accountId: { type: 'string', format: 'uuid', description: '本人的交易账户标识。' },
        categoryCode: { type: 'string', enum: [...new Set([...ledgerCategories.expense, ...ledgerCategories.income].map(([code]) => code))], description: `支出：${labels(ledgerCategories.expense)}；收入：${labels(ledgerCategories.income)}。` },
        note: { type: 'string', maxLength: ledgerLimits.note, description: '交易备注，可以为空。' },
      },
      required: ['requestId', 'direction', 'amountCents', 'occurredAt', 'accountId', 'categoryCode', 'note'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
]

export async function handleAgentMcp(request: Request, operations: { listAccounts: () => Promise<object>; createEntry: (input: unknown) => Promise<object> }): Promise<Response> {
  // This endpoint is for non-browser clients; no browser origins are authorized.
  if (request.headers.has('Origin')) return new Response(null, { status: 403 })
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const accepted = (request.headers.get('Accept') ?? '').split(',').map(part => {
    const [media, ...parameters] = part.trim().toLowerCase().split(';').map(item => item.trim())
    const quality = parameters.find(item => item.startsWith('q='))
    return !quality || (Number(quality.slice(2)) > 0 && Number(quality.slice(2)) <= 1) ? media : ''
  })
  if (!accepted.includes('application/json') || !accepted.includes('text/event-stream')) return new Response(null, { status: 406 })
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') ?? '')) return new Response(null, { status: 415 })
  const requestedVersion = request.headers.get('MCP-Protocol-Version')
  if (requestedVersion && !supportedVersions.includes(requestedVersion)) return new Response(null, { status: 400 })
  let message: { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } }
  try {
    if (!request.body) throw new Error()
    message = JSON.parse(await readBoundedBody(request.body, 16_384, 5000))
  } catch { return new Response(null, { status: 400 }) }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return new Response(null, { status: 400 })
  if (Object.hasOwn(message, 'id') && typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isSafeInteger(message.id))) return new Response(null, { status: 400 })
  if (message.jsonrpc === '2.0' && message.method === 'notifications/initialized' && message.id === undefined) return new Response(null, { status: 202 })
  if (message.jsonrpc === '2.0' && message.method === 'initialize' && message.id !== undefined) {
    const params = z.object({ protocolVersion: z.string().min(1), capabilities: z.record(z.string(), z.unknown()), clientInfo: z.object({ name: z.string().min(1), version: z.string().min(1) }) }).safeParse(message.params)
    if (!params.success) return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid initialization parameters' } })
    const negotiated = supportedVersions.includes(params.data.protocolVersion) ? params.data.protocolVersion : version
    return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: { name: 'lifespace-ledger', version: '1.0.0' } } })
  }
  if (message.jsonrpc === '2.0' && message.method === 'tools/list' && message.id !== undefined) return Response.json({ jsonrpc: '2.0', id: message.id, result: { tools } })
  if (message.jsonrpc === '2.0' && message.method === 'ping' && message.id !== undefined) return Response.json({ jsonrpc: '2.0', id: message.id, result: {} })
  if (message.jsonrpc === '2.0' && message.method === 'tools/call' && message.id !== undefined && ['list_ledger_accounts', 'create_ledger_entry'].includes(message.params?.name ?? '')) {
    const args = message.params?.arguments ?? {}
    if (typeof args !== 'object' || args === null || Array.isArray(args) || (message.params?.name === 'list_ledger_accounts' && Object.keys(args).length)) {
      return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid tool arguments' } })
    }
    try {
      const data = message.params?.name === 'list_ledger_accounts' ? await operations.listAccounts() : await operations.createEntry(args)
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } })
    } catch (error) {
      const code = error instanceof ApiError && Object.hasOwn(ledgerErrors, error.code) ? error.code as keyof typeof ledgerErrors : undefined
      const data = { code: code ?? 'INTERNAL_ERROR', message: code === 'SAVE_UNKNOWN' ? '保存结果未确认，请沿用原 requestId 和相同参数重试或查看流水。' : code ? ledgerErrors[code][1] : '服务暂时不可用，请稍后重试。' }
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } })
    }
  }
  if (message.id !== undefined && message.method === 'tools/call') return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } })
  if (message.id !== undefined) return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  return new Response(null, { status: 400 })
}
