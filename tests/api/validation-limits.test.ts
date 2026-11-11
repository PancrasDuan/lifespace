import { expect, it } from 'vitest'
import { planningEnvelopeSchema } from '../../src/shared/adventure-planning'
import { newsResultSchema } from '../../src/shared/news-contracts'

const goal = (standards: unknown[]) => ({
  requestId: 'validation-limits-1', expectedVersion: 0,
  command: { type: 'createGoal', title: '阅读', standards },
})
const news = (items: unknown[]) => ({
  sourceId: 'baidu', fetchedAt: '2026-11-02T00:00:00.000Z', sourceUpdatedAt: null,
  upstreamStatus: 'success', cacheHit: false, stale: false, warning: null, items,
})

it('目标完成标准超限时提前拒绝，不为每个无效元素累积错误', () => {
  const payload = goal(Array(5000).fill(null))
  expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(32_768)
  const result = planningEnvelopeSchema.safeParse(payload)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('超限完成标准被接受')
  expect(result.error.issues.length).toBe(1)
  expect(result.error.issues[0]).toMatchObject({ code: 'too_big', path: ['command', 'standards'], maximum: 50 })
})

it('新闻榜单超限时提前拒绝，不为每个无效元素累积错误', () => {
  const result = newsResultSchema.safeParse(news(Array(5000).fill(null)))
  expect(result.success).toBe(false)
  if (result.success) throw new Error('超限新闻榜单被接受')
  expect(result.error.issues.length).toBe(1)
  expect(result.error.issues[0]).toMatchObject({ code: 'too_big', path: ['items'], maximum: 30 })
})

it('长度上限内的目标完成标准和新闻榜单仍可正常使用', () => {
  const command = planningEnvelopeSchema.parse(goal(Array.from({ length: 50 }, (_, index) => ` 标准 ${index} `))).command
  if (command.type !== 'createGoal') throw new Error('目标命令类型发生变化')
  expect(command.standards).toHaveLength(50)
  expect(command.standards[0]).toBe('标准 0')
  const items = Array.from({ length: 30 }, (_, index) => ({ id: String(index), title: '新闻', url: `https://example.com/${index}`, rank: index + 1 }))
  expect(newsResultSchema.parse(news(items)).items).toEqual(items)
})
