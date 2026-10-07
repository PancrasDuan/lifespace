import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'
import { aiStatusResultSchema } from '../../src/shared/ai-status-contracts'
import officialSummary from '../fixtures/ai-status/openai-summary.json'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const normal = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [{ id: 'chat', name: 'ChatGPT', status: 'operational' }], incidents: [] }
const xaiNormal = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [{ id: 'grok-com', name: 'grok.com', status: 'available' }] }

test('两家正常时合并状态正常，xAI 使用官方公开来源并提供独立链接', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    const url = String(input); urls.push(url)
    return Response.json(url.includes('openai') ? normal : url.endsWith('/summary.json') ? xaiNormal : { incidents: [] })
  })
  const result = aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
  expect(result.status).toBe('normal')
  expect(result.providers.map(provider => provider.id)).toEqual(['openai', 'xai'])
  expect(result.providers[1]).toMatchObject({ name: 'xAI', statusUrl: 'https://status.x.ai/', status: 'normal' })
  expect(urls).toEqual(expect.arrayContaining(['https://data.x.ai/status/summary.json', 'https://data.x.ai/status/incidents.json']))
})

test('AI 状态接口从 OpenAI 官方来源获取正常状态并提供官方链接', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    return Response.json(String(input).includes('openai') ? normal : String(input).endsWith('/summary.json') ? xaiNormal : { incidents: [] })
  })
  const response = await app.request('/api/ai-status', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'normal', providers: expect.arrayContaining([expect.objectContaining({ id: 'openai', name: 'OpenAI', status: 'normal', statusUrl: 'https://status.openai.com/', checkedAt: '2026-10-07T02:00:00.000Z', incidents: [] })]) })
})

test('OpenAI 多个当前异常全部保留，已解决事件移除，官方未公布说明时明确提示', async () => {
  const event = { ...officialSummary.incidents[0], components: [{ name: 'ChatGPT' }] }
  vi.stubGlobal('fetch', async (input: URL | string | Request) => Response.json(String(input).includes('openai') ? { ...officialSummary, incidents: [event, { ...event, id: 'second', name: 'Login unavailable', incident_updates: [] }, { ...event, id: 'resolved', status: 'resolved' }] } : String(input).endsWith('/summary.json') ? xaiNormal : { incidents: [] }))
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

test('xAI 多个异常独立保留受影响服务，已解决事件不列为当前异常', async () => {
  const event = { id: 'grok', name: 'Grok outage', status: 'investigating', impact: 'major', created_at: '2026-10-07T02:00:00Z', updated_at: '2026-10-07T02:00:00Z', resolved_at: null, components: [{ slug: 'grok-com', name: 'grok.com' }], incident_updates: [] }
  vi.stubGlobal('fetch', async (input: URL | string | Request) => Response.json(String(input).includes('openai') ? normal : String(input).endsWith('/summary.json') ? xaiNormal : { incidents: [event, { ...event, id: 'api', name: 'API degraded', components: [{ slug: 'api-global', name: 'Global API' }] }, { ...event, id: 'past', status: 'resolved' }] }))
  const result = aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
  expect(result.status).toBe('abnormal')
  expect(result.providers[0].incidents).toEqual([])
  expect(result.providers[1].incidents).toHaveLength(2)
  expect(result.providers[1].incidents[0]).toMatchObject({ affectedServices: ['grok.com'], description: '原因待公布' })
  expect(result.providers[1].incidents[1]).toMatchObject({ affectedServices: ['Global API'] })
})

test.each([
  ['normal', 'normal', 'normal'], ['normal', 'abnormal', 'abnormal'], ['abnormal', 'normal', 'abnormal'],
  ['normal', 'unknown', 'unknown'], ['unknown', 'normal', 'unknown'], ['unknown', 'unknown', 'unknown'],
  ['abnormal', 'unknown', 'abnormal'], ['unknown', 'abnormal', 'abnormal'], ['abnormal', 'abnormal', 'abnormal'],
])('两家组合状态 %s 与 %s 合并为 %s', async (openaiState, xaiState, expected) => {
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    const url = String(input); const state = url.includes('openai') ? openaiState : xaiState
    if (state === 'unknown') return new Response('blocked-private-detail', { status: 403 })
    if (url.includes('openai')) return Response.json({ ...normal, status: { indicator: state === 'abnormal' ? 'minor' : 'none', description: 'Official description' } })
    return Response.json(url.endsWith('/summary.json') ? { ...xaiNormal, components: [{ id: 'grok-com', name: 'grok.com', status: state === 'abnormal' ? 'disruption' : 'available' }] } : { incidents: [] })
  })
  const result = aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
  expect(result.status).toBe(expected)
  expect(result.providers.map(provider => provider.status)).toEqual([openaiState, xaiState])
  expect(JSON.stringify(result)).not.toContain('blocked-private-detail')
})

test('xAI 组件没有数据时显示未知，而非正常', async () => {
  vi.stubGlobal('fetch', async (input: URL | string | Request) => Response.json(String(input).includes('openai') ? normal : String(input).endsWith('/summary.json') ? { ...xaiNormal, components: [{ id: 'grok-com', name: 'grok.com', status: 'no_data' }] } : { incidents: [] }))
  const result = aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
  expect(result.status).toBe('unknown')
  expect(result.providers[1].error).toContain('未知')
})
