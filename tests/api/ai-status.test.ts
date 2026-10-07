import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { aiStatusResultSchema } from '../../src/shared/ai-status-contracts'
import officialSummary from '../fixtures/ai-status/openai-summary.json'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const normal = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [{ id: 'chat', name: 'ChatGPT', status: 'operational' }], incidents: [] }

test('AI 状态接口从 OpenAI 官方来源获取正常状态并提供官方链接', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    expect(String(input)).toBe('https://status.openai.com/api/v2/summary.json')
    return Response.json(normal)
  })
  const response = await app.request('/api/ai-status', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'normal', providers: [{ id: 'openai', name: 'OpenAI', status: 'normal', statusUrl: 'https://status.openai.com/', checkedAt: '2026-10-07T02:00:00.000Z', incidents: [] }] })
})

test('OpenAI 多个当前异常全部保留，已解决事件移除，官方未公布说明时明确提示', async () => {
  const event = { ...officialSummary.incidents[0], components: [{ name: 'ChatGPT' }] }
  vi.stubGlobal('fetch', async () => Response.json({ ...officialSummary, incidents: [event, { ...event, id: 'second', name: 'Login unavailable', incident_updates: [] }, { ...event, id: 'resolved', status: 'resolved' }] }))
  const body = aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
  expect(body.status).toBe('abnormal')
  expect(body.providers[0].incidents).toHaveLength(2)
  expect(body.providers[0].incidents[0]).toMatchObject({ title: 'Workspace Agents Degraded and Responses Impacted', affectedServices: ['ChatGPT'] })
  expect(body.providers[0].incidents[1]).toMatchObject({ description: '原因待公布' })
})

test.each([403, 500])('官方状态获取失败返回未知而非官方故障，且不暴露来源原文：%s', async status => {
  vi.stubGlobal('fetch', async () => new Response('private-detail', { status }))
  const response = await app.request('/api/ai-status', {}, {})
  expect(response.status).toBe(200)
  const body = aiStatusResultSchema.parse(await response.json())
  expect(body.status).toBe('unknown')
  expect(body.providers[0].status).toBe('unknown')
  expect(JSON.stringify(body)).not.toContain('private-detail')
})

test('未知官方状态或不完整响应不伪装为正常', async () => {
  for (const data of [{}, { ...normal, status: { indicator: 'new-state', description: 'Unknown' } }]) {
    vi.stubGlobal('fetch', async () => Response.json(data))
    expect(aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json()).status).toBe('unknown')
  }
})
