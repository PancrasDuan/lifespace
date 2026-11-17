import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import rawGraph from '../fixtures/token-usage/tokscale-4.23.0-graph.json'
import {
  canonicalTokenUsageContent, sumTokenMoney, tokenCostSchema, tokenUsageContentHash,
  tokenUsageContentSchema, tokenUsageSnapshotHash, tokenUsageSnapshotSchema, tokenMetricKeys,
} from '../../src/shared/token-usage-contract'
import { adaptTokscaleGraph, tokscaleMoney, tokscaleVersion } from '../../tools/token-collector/tokscale-adapter'

const collectionContext = {
  deviceId: 'synthetic-device-206',
  metadata: {
    schemaVersion: 1 as const, statisticsVersion: 'tokscale-multi-agent-1',
    tool: { name: 'tokscale' as const, version: tokscaleVersion }, priceVersion: null,
    hostname: 'synthetic-host', scannedAt: '2026-11-15T04:00:00Z',
  },
}
const snapshots = () => adaptTokscaleGraph(structuredClone(rawGraph), collectionContext)

test('实际 graph 联合粒度对账，主汇总只计一次，缓存/推理还原包含关系', () => {
  const result = snapshots()
  expect(result.map(row => [row.identity.date, row.identity.agent, row.content.metrics.total])).toEqual([
    ['2026-11-14', 'codex', 130], ['2026-11-15', 'codex', 700],
  ])
  expect(result[0].content.metrics).toEqual({ input: 100, output: 30, total: 130, cacheRead: 20, reasoning: 10 })
  expect(result[1].content.metrics).toEqual({ input: 540, output: 160, total: 700, cacheRead: 125, reasoning: 52 })
  expect(result[1].content.models.items.map(row => [row.modelId, row.metrics.total]).sort()).toEqual([
    ['gpt-5.5', 260], ['synthetic-unpriced-206', 390], [null, 50],
  ].sort())
  expect(result[1].content.models.coverage).toBe('complete')
  expect(result.reduce((total, row) => total + row.content.metrics.total!, 0)).toBe(rawGraph.summary.totalTokens)
})

test('同一天多 Agent 的同名模型生成独立快照，组内重复仍拒绝', () => {
  const total = (tokens: typeof rawGraph.contributions[number]['tokenBreakdown']) =>
    (['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const).reduce((sum, key) => sum + tokens[key], 0)
  const graph: any = structuredClone(rawGraph)
  const day = graph.contributions[0], row = day.clients[0]
  const grok = structuredClone(row)
  grok.client = 'grok'
  grok.cost = 0
  grok.costProvenance = { kind: 'unknown' }
  grok.tokens.cacheWrite = 7
  day.clients.push(grok)
  day.totals.tokens += total(grok.tokens)
  day.totals.cost += grok.cost
  for (const key of tokenMetricKeys.filter(key => key !== 'total')) {
    day.tokenBreakdown[key] += grok.tokens[key]
  }
  graph.summary.totalTokens += total(grok.tokens)
  graph.summary.totalCost += grok.cost
  const result = adaptTokscaleGraph(graph, collectionContext)
  expect(result.map(snapshot => [snapshot.identity.date, snapshot.identity.agent, snapshot.content.metrics.total])).toEqual([
    ['2026-11-14', 'codex', 130], ['2026-11-14', 'grok', 137],
    ['2026-11-15', 'codex', 700],
  ])
  expect(result[0].content.models.items[0].modelId).toBe('gpt-5.5')
  expect(result[1].content.models.items[0].modelId).toBe('gpt-5.5')
  expect(result[1].content.cost).toEqual({ currency: 'USD', apiEstimate: null, coverage: 'unknown' })
  expect(result[1].content.models.items[0].metrics.cacheWrite).toBe(7)
  // Same Agent: one model reports cacheWrite 7, another reports known zero.
  // Both must carry the bucket so the main summary reconciles to 7.
  const mixed = adaptTokscaleGraph({
    meta: { version: tokscaleVersion },
    summary: { totalTokens: 149, totalCost: 3 },
    contributions: [{
      date: '2026-11-15', totals: { tokens: 149, cost: 3 },
      tokenBreakdown: { input: 90, output: 22, cacheRead: 20, cacheWrite: 7, reasoning: 10 },
      clients: [
        { client: 'grok', modelId: 'first-same-agent-model', tokens: { input: 80, output: 20, cacheRead: 20, cacheWrite: 7, reasoning: 10 }, cost: 1, costProvenance: { kind: 'estimated' } },
        { client: 'grok', modelId: 'second-same-agent-model', tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, cost: 2, costProvenance: { kind: 'estimated' } },
      ],
    }],
  }, collectionContext)[0]
  expect(mixed.content.models.items.map(item => item.metrics.cacheWrite).sort()).toEqual([0, 7])
  expect(mixed.content.metrics.cacheWrite).toBe(7)
  const duplicate = structuredClone(graph)
  duplicate.contributions[0].clients.push(structuredClone(duplicate.contributions[0].clients[1]))
  duplicate.contributions[0].totals.tokens += total(grok.tokens)
  duplicate.contributions[0].totals.cost += grok.cost
  for (const key of tokenMetricKeys.filter(key => key !== 'total')) {
    duplicate.contributions[0].tokenBreakdown[key] += grok.tokens[key]
  }
  duplicate.summary.totalTokens += total(grok.tokens)
  duplicate.summary.totalCost += grok.cost
  expect(() => adaptTokscaleGraph(duplicate, collectionContext)).toThrow('Tokscale 联合模型键重复')
})

test('未定价与未知模型不补零；有价部分保留为 API 估算，币种 USD', () => {
  const result = snapshots()
  expect(result[0].content.cost).toEqual({ currency: 'USD', apiEstimate: '0.00014199999999999998', coverage: 'unverified' })
  expect(result[1].content.cost).toEqual({ currency: 'USD', apiEstimate: '0.00027499999999999996', coverage: 'partial' })
  expect(result[1].content.models.items.find(row => row.modelId === null)?.cost).toEqual({ currency: 'USD', apiEstimate: null, coverage: 'unknown' })
  expect(result[1].content.models.items.find(row => row.modelId === 'synthetic-unpriced-206')?.cost.coverage).toBe('unknown')
})

test('实际费用、已知零、混合来源和缺失 provenance 分别表达', () => {
  const graph = structuredClone(rawGraph)
  const day = graph.contributions[0]
  const item = day.clients[0]
  item.cost = day.totals.cost = 0
  graph.summary.totalCost = graph.contributions[1].totals.cost
  Object.assign(item.costProvenance, { kind: 'providerReported' })
  expect(adaptTokscaleGraph(graph, collectionContext)[0].content.cost).toEqual({ currency: 'USD', actual: '0', coverage: 'complete' })
  Object.assign(item.costProvenance, { kind: 'mixed' })
  expect(adaptTokscaleGraph(graph, collectionContext)[0].content.cost).toEqual({ currency: 'USD', unclassified: '0', coverage: 'partial' })
  Reflect.deleteProperty(item, 'costProvenance')
  expect(adaptTokscaleGraph(graph, collectionContext)[0].content.cost).toEqual({ currency: 'USD', coverage: 'unknown' })
})

test('provider 在 graph 可缺失，只是标签，不改变模型子项键', () => {
  const graph = structuredClone(rawGraph)
  Reflect.deleteProperty(graph.contributions[0].clients[0], 'providerId')
  expect(adaptTokscaleGraph(graph, collectionContext)[0].content.models.items[0].providerId).toBeNull()
  const content = snapshots()[0].content
  content.models.items.push({ ...content.models.items[0], providerId: 'another-provider' })
  expect(tokenUsageContentSchema.safeParse(content).success).toBe(false)
})

function reverseKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(reverseKeys)
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).reverse().map(([key, value]) => [key, reverseKeys(value)]))
  return input
}

test('对象键与模型子项排序不影响 SHA-256，调用不会修改原数组', async () => {
  const content = snapshots()[1].content
  const reversed = structuredClone(content)
  reversed.models.items.reverse()
  const originalOrder = content.models.items.map(row => row.modelId)
  expect(await tokenUsageContentHash(reverseKeys(reversed))).toBe(await tokenUsageContentHash(content))
  expect(content.models.items.map(row => row.modelId)).toEqual(originalOrder)
  expect(await tokenUsageContentHash(content)).toBe(createHash('sha256').update(canonicalTokenUsageContent(content)).digest('hex'))
})

test('身份、schema/规则/工具/价格/快照版本、hostname与扫描时间不进入摘要', async () => {
  const first = snapshots()[0]
  const second = structuredClone(first)
  second.identity = { deviceId: 'another-synthetic-device', date: '2026-11-13', agent: 'future-agent' }
  Object.assign(second.metadata, {
    statisticsVersion: 'different', tool: { name: 'tokscale', version: 'future' }, priceVersion: 'another-price',
    snapshotVersion: '99', hostname: 'renamed-host', scannedAt: '2026-11-16T04:00:00Z',
  })
  expect(await tokenUsageSnapshotHash(second)).toBe(await tokenUsageSnapshotHash(first))
  // Hash function only receives statistical content; schema version is outside it.
  expect(canonicalTokenUsageContent(first.content)).not.toMatch(/deviceId|schemaVersion|statisticsVersion|hostname|scannedAt|snapshotVersion/)
})

test('模型归属、币种、费用状态、覆盖变化均改变摘要，身份保持独立', async () => {
  const first = snapshots()[0]
  const hash = await tokenUsageSnapshotHash(first)
  const changes = [
    (content: typeof first.content) => { content.models.items[0].modelId = 'renamed-model' },
    (content: typeof first.content) => { content.cost.currency = 'EUR'; content.models.items[0].cost.currency = 'EUR' },
    (content: typeof first.content) => { content.models.coverage = 'partial' },
    (content: typeof first.content) => {
      content.cost = content.models.items[0].cost = { currency: 'USD', actual: '0.00014199999999999998', coverage: 'complete' }
    },
    (content: typeof first.content) => {
      content.metrics.input!++; content.metrics.total!++
      content.models.items[0].metrics.input!++; content.models.items[0].metrics.total!++
    },
  ]
  for (const change of changes) {
    const modified = structuredClone(first)
    change(modified.content)
    expect(modified.identity).toEqual(first.identity)
    expect(await tokenUsageSnapshotHash(modified)).not.toBe(hash)
  }
})

test('缺失、显式未知与已知零的规范化内容各不相同', async () => {
  const make = (metrics: object) => ({ metrics, cost: { currency: 'USD', coverage: 'unknown' }, models: { coverage: 'missing', items: [] } })
  const hashes = await Promise.all([{}, { cacheRead: null }, { cacheRead: 0 }].map(metrics => tokenUsageContentHash(make(metrics))))
  expect(new Set(hashes).size).toBe(3)
  expect(tokenUsageContentSchema.safeParse(make({ cacheRead: -1 })).success).toBe(false)
  expect(tokenCostSchema.safeParse({ currency: 'USD', apiEstimate: null, coverage: 'complete' }).success).toBe(false)
})

test('固定规范化向量供后续数据库端交叉核验', async () => {
  const content = {
    metrics: { input: 100, output: 30, total: 130, cacheRead: 20, reasoning: 10 },
    cost: { currency: 'USD', coverage: 'unknown', apiEstimate: null }, models: { coverage: 'missing', items: [] },
  }
  expect(await tokenUsageContentHash(content)).toBe('d79d902b2a4f9729093d471e38a8dfac7c4fc755f0569502e454eecb84d5d526')
})

test.each(['01', '1.0', '1e-6', '-0', '-1', 'NaN'])('费用禁止非规范十进制 %s', value => {
  expect(tokenCostSchema.safeParse({ currency: 'USD', apiEstimate: value, coverage: 'complete' }).success).toBe(false)
})

test('费用指数展开与合计不再引入浮点舍入', () => {
  expect(tokscaleMoney(1e-7)).toBe('0.0000001')
  expect(tokscaleMoney(1e21)).toBe('1000000000000000000000')
  expect(tokscaleMoney(0)).toBe('0')
  expect(sumTokenMoney(['0.1', '0.2'])).toBe('0.3')
})

describe('错误或不支持输出拒绝生成汇总', () => {
  test.each(['version', 'missing', 'negative', 'unsafe', 'totals', 'component', 'duplicateDate', 'duplicateModel', 'provenance', 'agent', 'cost'])('%s', kind => {
    const graph = structuredClone(rawGraph)
    const day = graph.contributions[0]
    const row = day.clients[0]
    if (kind === 'version') graph.meta.version = 'old'
    if (kind === 'missing') Reflect.deleteProperty(row.tokens, 'cacheRead')
    if (kind === 'negative') row.tokens.input = -1
    if (kind === 'unsafe') row.tokens.input = Number.MAX_SAFE_INTEGER + 1
    if (kind === 'totals') day.totals.tokens++
    if (kind === 'component') { row.tokens.input++; row.tokens.output-- }
    if (kind === 'duplicateDate') graph.contributions.push(day)
    if (kind === 'duplicateModel') Reflect.set(day.clients, day.clients.length, row)
    if (kind === 'provenance') row.costProvenance.kind = 'futureKind'
    if (kind === 'agent') row.client = 'futureAgent'
    if (kind === 'cost') day.totals.cost = 5
    expect(() => adaptTokscaleGraph(graph, collectionContext)).toThrow()
  })
})

test('上传契约拒绝正文、路径、原始ID及其他未授权字段；适配仅投影统计字段', () => {
  const snapshot = snapshots()[0]
  expect(tokenUsageSnapshotSchema.safeParse({ ...snapshot, rawSystemId: 'synthetic' }).success).toBe(false)
  expect(tokenUsageContentSchema.safeParse({ ...snapshot.content, sessionId: 'synthetic' }).success).toBe(false)
  const graph = structuredClone(rawGraph)
  Object.assign(graph.contributions[0].clients[0], { cwd: '/synthetic-path', responseId: 'synthetic-private', text: 'synthetic-transcript' })
  expect(JSON.stringify(adaptTokscaleGraph(graph, collectionContext))).not.toMatch(/synthetic-path|synthetic-private|synthetic-transcript/)
})

test('契约自身拒绝分类重复、总量重复累加和包含关系错误', () => {
  const content = snapshots()[0].content
  content.metrics.total! += content.models.items[0].metrics.total!
  expect(tokenUsageContentSchema.safeParse(content).success).toBe(false)
  const second = snapshots()[0].content
  second.models.items.push(second.models.items[0])
  expect(tokenUsageContentSchema.safeParse(second).success).toBe(false)
  const third = snapshots()[0].content
  third.metrics.cacheRead = 101
  expect(tokenUsageContentSchema.safeParse(third).success).toBe(false)
})
