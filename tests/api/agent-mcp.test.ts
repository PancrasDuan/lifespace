import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { oauthFixture, oauthOwner } from '../support/mcp-oauth'

const owner = oauthOwner
const entryId = '00000000-0000-4000-8000-000000000011'
const accountId = '00000000-0000-4000-8000-000000000004'
const entry = {
  id: entryId, direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05.000Z',
  accountId, transferId: null, accountName: '支付宝', categoryCode: 'dining', note: '午饭',
  parentEntryId: null, createdAt: '2026-01-02T03:04:05.000Z', status: 'completed',
}
const page = { items: [entry], total: 1, page: 1, pageSize: 30, version: 4 }
const detail = { entry, parentEntry: null, transferEntry: null, refunds: [], refundCount: 0, refundedCents: 0, refundPage: 1, refundPageSize: 30, version: 4 }
let fixture: ReturnType<typeof oauthFixture>
let accessToken: string
let oauthFetch: typeof fetch
beforeEach(async () => {
  fixture = oauthFixture()
  accessToken = (await fixture.issue((await fixture.client()).clientId)).access_token
  oauthFetch = globalThis.fetch
})
function upstream(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/rpc/ledger_')) {
      const value = extra?.(url, init)
      if (value) return value
      throw new Error('unexpected synthetic ledger RPC')
    }
    return oauthFetch(input, init)
  }))
}
function request(body: unknown, headers: HeadersInit = {}) {
  return fixture.request('/api/agent/mcp', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
}
function restRequest(path: string, body?: unknown) {
  return fixture.browser(path, body)
}
function restRefund(args: Record<string, unknown>) {
  const { id, ...body } = args
  return restRequest('/api/ledger/entries/' + String(id) + '/refunds', body)
}
afterEach(() => vi.unstubAllGlobals())

test('Agent 通过真实入口初始化 MCP 并获得协商的协议版本', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'lifespace-ledger', version: '2.1.0' } } })
})

test('工具发现提供账户、流水读取、普通流水与 REST 一致的独立退款契约', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 'discovery', method: 'tools/list', params: {} }, { 'MCP-Protocol-Version': '2025-11-25' })
  expect(response.status).toBe(200)
  const result = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[]; properties?: Record<string, { description?: string }> }; annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }> } }
  expect(result.result.tools.map(tool => tool.name)).toEqual(['list_ledger_accounts', 'list_ledger_entries', 'get_ledger_entry', 'create_ledger_entry', 'create_ledger_refund'])
  const list = result.result.tools[1]
  expect(list.inputSchema).toMatchObject({ additionalProperties: false, properties: { page: { type: 'integer', minimum: 1 }, accountId: { format: 'uuid' }, version: { type: 'integer', minimum: 0 } } })
  expect(list.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
  const get = result.result.tools[2]
  expect(get.inputSchema).toMatchObject({ additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' }, refundPage: { type: 'integer', minimum: 1 }, version: { type: 'integer', minimum: 0 } } })
  expect(get.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
  const create = result.result.tools[3]
  expect(create.inputSchema.required).toEqual(expect.arrayContaining(['requestId', 'direction', 'amountCents', 'occurredAt', 'accountId', 'categoryCode', 'note']))
  expect(create.inputSchema.properties?.categoryCode.description).toContain('dining：餐饮')
  expect(create.description).toContain('完整展示')
  expect(create.description).toContain('明确确认')
  const refund = result.result.tools[4]
  expect(refund.inputSchema).toMatchObject({ additionalProperties: false, required: ['id', 'requestId', 'amountCents', 'occurredAt', 'note'], properties: { id: { format: 'uuid' }, amountCents: { type: 'integer', minimum: 1, maximum: 99_999_999_999 }, note: { type: 'string', description: expect.stringContaining('trim 后最多 500 个 Unicode 码点') } } })
  expect(refund.inputSchema.properties?.note).not.toHaveProperty('maxLength')
  expect(Object.keys(refund.inputSchema.properties!)).toEqual(refund.inputSchema.required)
  for (const instruction of ['父流水关联', '继承的交易账户和分类', '明确确认', '再次完整展示并确认', '原 requestId', '无法独立证明']) expect(refund.description).toContain(instruction)
  expect(refund.description).toContain('get_ledger_entry')
})

test('账户查询返回本人完整账户数据，包括余额', async () => {
  upstream(url => url.endsWith('/rpc/ledger_accounts_list') ? Response.json({ accounts: [{ id: '00000000-0000-4000-8000-000000000004', name: '支付宝', balanceCents: 12345, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }], version: 3 }) : undefined)
  const response = await request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_ledger_accounts', arguments: {} } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: 2, result: { structuredContent: { accounts: [{ name: '支付宝', balanceCents: 12345 }], version: 3 } } })
})

test('普通流水创建沿用现有用户、请求编号和账单校验', async () => {
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_create')) return undefined
    const body = JSON.parse(String(init?.body))
    return body.p_owner === owner && JSON.stringify(body.p_input) === JSON.stringify(entry)
      ? Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false })
      : Response.json({ message: 'ACCOUNT_NOT_FOUND' }, { status: 403 })
  })
  const response = await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: 3, result: { structuredContent: { entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false } } })
})

test('初始化完成通知返回 202 空响应', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', method: 'notifications/initialized' })
  expect(response.status).toBe(202)
  expect(await response.text()).toBe('')
})

test('协议版本协商支持兼容版本并拒绝不支持的后续版本', async () => {
  upstream()
  const older = await request({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client', version: '1' } } })
  expect(await older.json()).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
  const future = await request({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'client', version: '1' } } })
  expect(await future.json()).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  const invalid = await request({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { 'MCP-Protocol-Version': 'not-supported' })
  expect(invalid.status).toBe(400)
})

test('带浏览器 Origin 的外部请求拒绝访问 Agent 工具', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { Origin: 'https://attacker.example' })
  expect(response.status).toBe(403)
})

test('不接受不支持 MCP JSON 与事件流的 Accept 请求', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, { Accept: 'text/plain' })
  expect(response.status).toBe(406)
})

test('非 JSON 请求内容不会进入 MCP 工具', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { 'Content-Type': 'text/plain' })
  expect(response.status).toBe(415)
})

test('无效的 JSON-RPC id 不能触发流水写入', async () => {
  let writes = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_create')) { writes++; return Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false }) }
    return undefined
  })
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', id: null, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(400)
  expect(writes).toBe(0)
})

test('没有 id 的工具调用不能触发流水写入', async () => {
  let writes = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_create')) { writes++; return Response.json({ entryId: '00000000-0000-4000-8000-000000000008', version: 4, deleted: false }) }
    return undefined
  })
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(400)
  expect(writes).toBe(0)
})

test('tools/call 的 arguments 显式为 null 时返回协议参数错误', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 'null-args', method: 'tools/call', params: { name: 'list_ledger_entries', arguments: null } })
  expect(await response.json()).toMatchObject({ id: 'null-args', error: { code: -32602, message: 'Invalid tool arguments' } })
})

test('创建结果未知时通过 MCP 提示沿用原编号和参数重试', async () => {
  upstream(url => url.endsWith('/rpc/ledger_create') ? new Response(null, { status: 503 }) : undefined)
  const entry = { requestId: '00000000-0000-4000-8000-000000000007', direction: 'expense', amountCents: -3500, occurredAt: '2026-01-02T03:04:05Z', accountId: '00000000-0000-4000-8000-000000000004', categoryCode: 'dining', note: '午饭' }
  const response = await request({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: entry } })
  expect(response.status).toBe(200)
  const body = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } }
  expect(body.result.isError).toBe(true)
  expect(body.result.content[0].text).toContain('SAVE_UNKNOWN')
  expect(body.result.content[0].text).toContain('原请求重试')
})

test('未知 MCP 方法返回 JSON-RPC 方法不存在', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 11, method: 'unknown/method' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 11, error: { code: -32601 } })
})

test('账户查询拒绝用户指定其他所有者', async () => {
  let reads = 0
  upstream(url => {
    if (url.endsWith('/rpc/ledger_accounts_list')) { reads++; return Response.json({ accounts: [], version: 0 }) }
    return undefined
  })
  const response = await request({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'list_ledger_accounts', arguments: { ownerId: 'someone-else' } } })
  expect(await response.json()).toMatchObject({ id: 12, result: { isError: true, structuredContent: { error: { code: 'INVALID_QUERY' } } } })
  expect(reads).toBe(0)
})

test.each(['create_ledger_transfer', 'delete_ledger_entry', 'update_ledger_account'])('工具 %s 未暴露，不能访问其他账单能力', async name => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name, arguments: {} } })
  expect(await response.json()).toMatchObject({ id: 13, error: { code: -32602 } })
})

test('流水列表复用 REST 查询与读取服务，默认分页并注入可信 owner', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_list')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_page: 1, p_start_date: null, p_end_date: null, p_version: null })
    return Response.json(page)
  })
  const body = await (await request({ jsonrpc: '2.0', id: 'list', method: 'tools/call', params: { name: 'list_ledger_entries', arguments: {} } })).json() as { result: { structuredContent: object } }
  expect(body.result.structuredContent).toEqual(page)
  const rest = await restRequest('/api/ledger/entries')
  expect(rest.status).toBe(200)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test('流水列表按账户和日期调用对应 RPC，并保持版本与分页参数', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_list_by_account')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_account_id: accountId, p_page: 2, p_start_date: '2026-01-02', p_end_date: '2026-01-03', p_version: 4 })
    return Response.json({ ...page, page: 2 })
  })
  const args = { page: 2, startDate: '2026-01-02', endDate: '2026-01-03', accountId, version: 4 }
  const body = await (await request({ jsonrpc: '2.0', id: 'list', method: 'tools/call', params: { name: 'list_ledger_entries', arguments: args } })).json() as { result: { structuredContent: object } }
  expect(body.result.structuredContent).toMatchObject({ page: 2, version: 4 })
  const rest = await restRequest('/api/ledger/entries?page=2&startDate=2026-01-02&endDate=2026-01-03&accountId=' + accountId + '&version=4')
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test.each([
  { page: 0 }, { page: 1.5 }, { page: 1_000_001 }, { startDate: '2026-01-02' },
  { endDate: '2026-01-02' }, { startDate: '2026-01-03', endDate: '2026-01-02' },
  { startDate: '2026-02-30', endDate: '2026-03-01' }, { accountId: 'bad' }, { version: -1 },
  { version: 1.5 }, { ownerId: owner }, { unknown: true },
])('流水列表拒绝非法或越权参数 %j，未调用数据库', async change => {
  let reads = 0
  upstream(url => { if (url.includes('/rpc/ledger_list')) reads++; return undefined })
  const body = await (await request({ jsonrpc: '2.0', id: 'list', method: 'tools/call', params: { name: 'list_ledger_entries', arguments: change } })).json() as { result: { structuredContent: object } }
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_QUERY' } } })
  const query = new URLSearchParams(Object.entries(change).map(([key, value]) => [key, String(value)])).toString()
  const rest = await restRequest('/api/ledger/entries?' + query)
  expect(rest.status).toBe(400)
  expect(body.result.structuredContent).toEqual(await rest.json())
  expect(reads).toBe(0)
})

test('流水列表版本冲突沿用 REST 的 LIST_CHANGED 业务错误', async () => {
  upstream(url => url.endsWith('/rpc/ledger_list') ? Response.json({ message: 'LIST_CHANGED' }, { status: 409 }) : undefined)
  const body = await (await request({ jsonrpc: '2.0', id: 'list', method: 'tools/call', params: { name: 'list_ledger_entries', arguments: { version: 3 } } })).json() as { result: { structuredContent: object } }
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'LIST_CHANGED' } } })
  const rest = await restRequest('/api/ledger/entries?version=3')
  expect(rest.status).toBe(409)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test('单笔详情复用 REST 读取服务，默认关联页并注入可信 owner', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_detail')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_id: entryId, p_refund_page: 1, p_version: null })
    return Response.json(detail)
  })
  const body = await (await request({ jsonrpc: '2.0', id: 'detail', method: 'tools/call', params: { name: 'get_ledger_entry', arguments: { id: entryId } } })).json() as { result: { structuredContent: object } }
  expect(body.result.structuredContent).toEqual(detail)
  const rest = await restRequest('/api/ledger/entries/' + entryId)
  expect(rest.status).toBe(200)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test('单笔详情传递关联页码与版本', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_detail')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_id: entryId, p_refund_page: 2, p_version: 4 })
    return Response.json({ ...detail, refundPage: 2 })
  })
  const body = await (await request({ jsonrpc: '2.0', id: 'detail', method: 'tools/call', params: { name: 'get_ledger_entry', arguments: { id: entryId, refundPage: 2, version: 4 } } })).json() as { result: { structuredContent: object } }
  expect(body.result.structuredContent).toMatchObject({ refundPage: 2, version: 4 })
  const rest = await restRequest('/api/ledger/entries/' + entryId + '?refundPage=2&version=4')
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test.each(['invalid', 'ffffffff-ffff-4fff-8fff-ffffffffffff', null, undefined])('单笔详情对非法或不存在标识返回 NOT_FOUND：%j', async id => {
  upstream(url => url.endsWith('/rpc/ledger_detail') ? Response.json({ message: 'NOT_FOUND' }, { status: 404 }) : undefined)
  const body = await (await request({ jsonrpc: '2.0', id: 'detail', method: 'tools/call', params: { name: 'get_ledger_entry', arguments: { id } } })).json() as { result: { structuredContent: object } }
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_FOUND' } } })
  if (typeof id === 'string' && id !== 'invalid') {
    const rest = await restRequest('/api/ledger/entries/' + id)
    expect(rest.status).toBe(404)
    expect(body.result.structuredContent).toEqual(await rest.json())
  }
})

test.each([
  { id: entryId, refundPage: 0 }, { id: entryId, refundPage: 1.5 }, { id: entryId, version: -1 },
  { id: entryId, version: 1.5 }, { id: entryId, ownerId: owner }, { id: entryId, unknown: true },
])('单笔详情拒绝非法或越权查询 %j，未调用数据库', async args => {
  let reads = 0
  upstream(url => { if (url.endsWith('/rpc/ledger_detail')) reads++; return undefined })
  const body = await (await request({ jsonrpc: '2.0', id: 'detail', method: 'tools/call', params: { name: 'get_ledger_entry', arguments: args } })).json() as { result: { structuredContent: object } }
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_QUERY' } } })
  const query = new URLSearchParams(Object.entries(args).filter(([key]) => key !== 'id').map(([key, value]) => [key, String(value)])).toString()
  const rest = await restRequest('/api/ledger/entries/' + entryId + (query ? '?' + query : ''))
  expect(rest.status).toBe(400)
  expect(body.result.structuredContent).toEqual(await rest.json())
  expect(reads).toBe(0)
})

test('单笔详情版本冲突沿用 REST 的 LIST_CHANGED 业务错误', async () => {
  upstream(url => url.endsWith('/rpc/ledger_detail') ? Response.json({ message: 'LIST_CHANGED' }, { status: 409 }) : undefined)
  const body = await (await request({ jsonrpc: '2.0', id: 'detail', method: 'tools/call', params: { name: 'get_ledger_entry', arguments: { id: entryId, version: 3 } } })).json() as { result: { structuredContent: object } }
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'LIST_CHANGED' } } })
  const rest = await restRequest('/api/ledger/entries/' + entryId + '?version=3')
  expect(rest.status).toBe(409)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test('MCP ping 返回空结果', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 14, method: 'ping' })
  expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 14, result: {} })
})

test('初始化缺少客户端信息时返回参数错误', async () => {
  upstream()
  const response = await request({ jsonrpc: '2.0', id: 15, method: 'initialize', params: {} })
  expect(await response.json()).toMatchObject({ id: 15, error: { code: -32602 } })
})

const refund = { id: '00000000-0000-4000-8000-000000000008', requestId: '00000000-0000-4000-8000-000000000009', amountCents: 500, occurredAt: '2026-01-02T03:04:05Z', note: '  退货  ' }
const refundCall = (args: unknown = refund) => request({ jsonrpc: '2.0', id: 'refund', method: 'tools/call', params: { name: 'create_ledger_refund', arguments: args } })

test('退款允许 trim 后恰好 500 个 Unicode 码点，发现契约不误限原始长度', async () => {
  const note = '😀'.repeat(500)
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_refund')) return undefined
    expect(JSON.parse(String(init?.body)).p_input.note).toBe(note)
    return Response.json({ entryId: refund.requestId, version: 5, deleted: false })
  })
  expect(await (await refundCall({ ...refund, note: '  ' + note + '  ' })).json()).toMatchObject({ result: { structuredContent: { entryId: refund.requestId } } })
})

test('退款复用账单服务，可信 owner 和父标识单独注入，不接收继承字段', async () => {
  upstream((url, init) => {
    if (!url.endsWith('/rpc/ledger_refund')) return undefined
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: owner, p_parent: refund.id, p_input: { requestId: refund.requestId, amountCents: 500, occurredAt: refund.occurredAt, note: '退货' } })
    return Response.json({ entryId: refund.requestId, version: 5, deleted: false })
  })
  const response = await refundCall()
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const body = await response.json() as { result: { content: Array<{ text: string }>; structuredContent: object } }
  expect(body.result.structuredContent).toEqual({ entryId: refund.requestId, version: 5, deleted: false })
  const rest = await restRefund(refund)
  expect(rest.status).toBe(200)
  expect(body.result.structuredContent).toEqual(await rest.json())
  expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent)
})

test.each([
  { requestId: 'invalid' }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 0.1 },
  { amountCents: 100_000_000_000 }, { occurredAt: '2026-01-02T03:04:05.001Z' },
  { occurredAt: '2026-02-30T00:00:00Z' }, { note: '😀'.repeat(501) }, { note: undefined },
  { ownerId: owner }, { accountId: owner }, { categoryCode: 'dining' }, { direction: 'income' },
])('退款拒绝非法或越权字段 %j，未调用业务数据库', async change => {
  let writes = 0
  upstream(url => { if (url.endsWith('/rpc/ledger_refund')) writes++; return undefined })
  const mcp = await (await refundCall({ ...refund, ...change })).json() as { result: { structuredContent: object } }
  expect(mcp.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_ENTRY' } } })
  const rest = await restRefund({ ...refund, ...change })
  expect(rest.status).toBe(400)
  expect(mcp.result.structuredContent).toEqual(await rest.json())
  expect(writes).toBe(0)
})

test('退款拒绝未来时间，未调用业务数据库', async () => {
  upstream()
  expect(await (await refundCall({ ...refund, occurredAt: '2999-01-01T00:00:00Z' })).json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'FUTURE_TIME' } } } })
})

test.each(['NOT_FOUND', 'REFUND_PARENT_INVALID', 'REFUND_LIMIT', 'REFUND_TIME', 'BALANCE_LIMIT', 'REQUEST_ID_REUSED'] as const)('退款业务错误 %s 沿用稳定 MCP 映射', async code => {
  upstream(url => url.endsWith('/rpc/ledger_refund') ? Response.json({ message: code, details: 'private upstream details' }, { status: 400 }) : undefined)
  const body = await (await refundCall()).json()
  expect(body).toMatchObject({ result: { isError: true, structuredContent: { error: { code } } } })
  const rest = await restRefund(refund)
  expect((body as { result: { structuredContent: object } }).result.structuredContent).toEqual(await rest.json())
  expect(JSON.stringify(body)).not.toContain('private upstream details')
})

test.each([new Response(null, { status: 503 }), Response.json({ entryId: 'invalid' }), Response.json({ message: 'private upstream details' }, { status: 500 })])('退款响应丢失或无效时保留未知结果语义', async upstreamResponse => {
  let writes = 0
  upstream(url => { if (url.endsWith('/rpc/ledger_refund')) { writes++; return upstreamResponse }; return undefined })
  const body = await (await refundCall()).json()
  expect(body).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'SAVE_UNKNOWN', message: expect.stringContaining('原请求重试') } } } })
  expect(JSON.stringify(body)).not.toContain('private upstream details')
  expect(writes).toBe(1)
})

test.each(['invalid', null, undefined])('非法父标识 %j 在 REST 与 MCP 返回同一 NOT_FOUND 错误', async id => {
  upstream()
  const args = { ...refund, id }
  const body = await (await refundCall(args)).json() as { result: { isError: boolean; structuredContent: object } }
  const rest = await restRefund(args)
  expect(rest.status).toBe(404)
  expect(body.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_FOUND' } } })
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test('退款未知结果的错误体与 REST 完全一致，重试约定保留在工具说明', async () => {
  upstream(url => url.endsWith('/rpc/ledger_refund') ? new Response(null, { status: 503 }) : undefined)
  const body = await (await refundCall()).json() as { result: { structuredContent: object } }
  const rest = await restRefund(refund)
  expect(rest.status).toBe(503)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test.each([false, true])('账户查询在两种入口使用同一数据与参数错误，非法查询=%s', async invalid => {
  upstream(url => url.endsWith('/rpc/ledger_accounts_list') ? Response.json({ accounts: [], version: 0 }) : undefined)
  const body = await (await request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_ledger_accounts', arguments: invalid ? { ownerId: owner } : {} } })).json() as { result: { structuredContent: object } }
  const rest = await restRequest('/api/ledger/accounts' + (invalid ? '?ownerId=' + owner : ''))
  expect(rest.status).toBe(invalid ? 400 : 200)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test.each(['valid', 'invalid', 'unknown'] as const)('普通创建也统一使用 REST 契约：%s', async scenario => {
  upstream(url => url.endsWith('/rpc/ledger_create') ? scenario === 'unknown' ? new Response(null, { status: 503 }) : Response.json({ entryId: refund.requestId, version: 1, deleted: false }) : undefined)
  const input = { requestId: refund.requestId, direction: 'expense', amountCents: -500, accountId: owner, categoryCode: 'dining', occurredAt: refund.occurredAt, note: '  ' + '😀'.repeat(scenario === 'invalid' ? 501 : 500) + '  ' }
  const body = await (await request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_ledger_entry', arguments: input } })).json() as { result: { structuredContent: object } }
  const rest = await restRequest('/api/ledger/entries', input)
  expect(rest.status).toBe(scenario === 'valid' ? 200 : scenario === 'invalid' ? 400 : 503)
  expect(body.result.structuredContent).toEqual(await rest.json())
})

test.each(['create_ledger_refund'])('%s 仍需 Agent 鉴权与在线准入，Agent 凭据不能访问网页退款接口', async name => {
  upstream()
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: refund } })
  fixture.authKv.value = 'removed@example.invalid'
  expect((await fixture.request('/api/agent/mcp', { method: 'POST', headers, body })).status).toBe(403)
  expect((await fixture.request('/api/agent/mcp', { method: 'POST', headers: { ...headers, Authorization: '' }, body })).status).toBe(401)
  expect((await fixture.request('/api/ledger/entries/' + refund.id + '/refunds', { method: 'POST', headers, body: JSON.stringify(refund) })).status).toBe(401)
})
