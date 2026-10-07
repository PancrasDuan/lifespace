import { afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import app from '../../worker/index'
import { aiStatusResultSchema } from '../../src/shared/ai-status-contracts'
import officialPageSummary from '../fixtures/ai-status/openai-page-summary.json'

const officialFeed = readFileSync(new URL('../fixtures/ai-status/xai-feed.xml', import.meta.url), 'utf8')
const normalOpenAI = { summary: { ...officialPageSummary.summary, affected_components: [], ongoing_incidents: [] } }
const feed = (items: string) => `<rss version="2.0"><channel><title>SpaceXAI System Status</title><link>https://status.x.ai</link>${items}</channel></rss>`
const item = (id: string, service: string, title: string, status = 'investigating') => `<item><title>[${service}] ${title}</title><guid>${id}</guid><pubDate>Wed, 07 Oct 2026 02:00:00 GMT</pubDate><category>outage</category><category>${status}</category><description><![CDATA[<h3>Status: ${status.toUpperCase()}</h3><h4>Updates:</h4><div><p><strong>Wed, 07 Oct 2026 02:10:00 GMT</strong></p><h3>Investigating</h3><p>We are investigating this incident.</p></div>]]></description></item>`
const activeFeed = feed(item('grok', 'grok.com', 'Grok outage'))
const result = async () => aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
const sources = (openai: unknown = normalOpenAI, xai = officialFeed) => {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    const url = String(input); urls.push(url)
    if (url === 'https://status.openai.com/proxy/status.openai.com') return Response.json(openai)
    if (url === 'https://status.x.ai/feed.xml') return new Response(xai)
    return new Response('Unexpected upstream', { status: 404 })
  })
  return urls
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('真实官网数据回放：Agent 异常归属 ChatGPT，事件同时显示 ChatGPT 与 Agent', async () => {
  sources(officialPageSummary)
  const data = await result()
  expect(data.status).toBe('abnormal')
  expect(data.providers[0].affectedServices).toEqual(['ChatGPT'])
  expect(data.providers[0].incidents[0].affectedServices).toEqual(['ChatGPT / Agent'])
  expect(data.providers[0].incidents[0].description).toBe('We have applied the mitigation and are monitoring the recovery.')
})

test('真实 xAI 官方 RSS 回放：成功取得已解决事件，当前状态无官方异常', async () => {
  const urls = sources(officialPageSummary)
  const data = await result()
  expect(data.providers[1]).toMatchObject({ status: 'normal', incidents: [], error: null })
  expect(data.providers[1].description).toBe('官方事件订阅未报告未解决异常')
  expect(urls).toEqual(['https://status.openai.com/proxy/status.openai.com', 'https://status.x.ai/feed.xml'])
})

test('两家正常时合并状态正常，保留各家官方链接和真实检查时间', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
  sources()
  const data = await result()
  expect(data.status).toBe('normal')
  expect(data.providers.map(provider => provider.statusUrl)).toEqual(['https://status.openai.com/', 'https://status.x.ai/'])
  expect(data.providers.map(provider => provider.checkedAt)).toEqual(['2026-10-07T02:00:00.000Z', '2026-10-07T02:00:00.000Z'])
})

test('OpenAI 每个事件独立关联产品，多个异常全保留，已解决事件移除', async () => {
  const original = officialPageSummary.summary.ongoing_incidents[0]
  const data = { summary: { ...officialPageSummary.summary, ongoing_incidents: [original, { ...original, id: 'second', name: 'Login unavailable', updates: [], affected_components: [{ component_id: '01JMXBRMFE6N2NNT7DG6XZQ6PW', status: 'partial_outage' }] }, { ...original, id: 'resolved', status: 'resolved' }] } }
  sources(data)
  const provider = (await result()).providers[0]
  expect(provider.incidents).toHaveLength(2)
  expect(provider.incidents[0].affectedServices).toEqual(['ChatGPT / Agent'])
  expect(provider.incidents[1]).toMatchObject({ description: '原因待公布', affectedServices: ['APIs / Chat Completions'] })
})

test('xAI 多个当前异常全部保留，同一事件的多服务条目合并，已解决事件移除', async () => {
  sources(normalOpenAI, feed(item('grok', 'grok.com', 'Grok outage') + item('grok', 'Global API', 'Grok outage') + item('voice', 'Voice', 'Voice degraded') + item('old', 'grok.com', 'Past outage', 'resolved')))
  const provider = (await result()).providers[1]
  expect(provider.status).toBe('abnormal')
  expect(provider.incidents).toHaveLength(2)
  expect(provider.incidents[0]).toMatchObject({ title: 'Grok outage', affectedServices: ['grok.com', 'Global API'], description: 'We are investigating this incident.', updatedAt: '2026-10-07T02:10:00.000Z' })
  expect(provider.incidents[1].affectedServices).toEqual(['Voice'])
})

test.each([
  ['normal', 'normal', 'normal'], ['normal', 'abnormal', 'abnormal'], ['abnormal', 'normal', 'abnormal'],
  ['normal', 'unknown', 'unknown'], ['unknown', 'normal', 'unknown'], ['unknown', 'unknown', 'unknown'],
  ['abnormal', 'unknown', 'abnormal'], ['unknown', 'abnormal', 'abnormal'], ['abnormal', 'abnormal', 'abnormal'],
])('两家组合状态 %s 与 %s 合并为 %s', async (openaiState, xaiState, expected) => {
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    const openai = String(input).includes('openai.com'); const state = openai ? openaiState : xaiState
    if (state === 'unknown') return new Response('blocked-private-detail', { status: 403 })
    return openai ? Response.json(state === 'abnormal' ? officialPageSummary : normalOpenAI) : new Response(state === 'abnormal' ? activeFeed : officialFeed)
  })
  const data = await result()
  expect(data.status).toBe(expected)
  expect(data.providers.map(provider => provider.status)).toEqual([openaiState, xaiState])
  expect(JSON.stringify(data)).not.toContain('blocked-private-detail')
})

test.each([403, 500])('来源获取失败显示未知，且不暴露来源响应：%s', async status => {
  vi.stubGlobal('fetch', async () => new Response('private-detail', { status }))
  const data = await result()
  expect(data.status).toBe('unknown')
  expect(data.providers.map(provider => provider.status)).toEqual(['unknown', 'unknown'])
  expect(JSON.stringify(data)).not.toContain('private-detail')
})

test('来源字段变化不伪装为正常，HTML 错误页不作为有效 RSS', async () => {
  sources({}, '<html><body>Blocked</body></html>')
  const data = await result()
  expect(data.status).toBe('unknown')
  expect(data.providers.map(provider => provider.status)).toEqual(['unknown', 'unknown'])
})

test('RSS 含外部实体或无法识别的事件状态时报告未知', async () => {
  for (const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + officialFeed, feed(item('new', 'Grok', 'Unknown status', 'new-status'))]) {
    sources(normalOpenAI, xml)
    expect((await result()).providers[1].status).toBe('unknown')
  }
})
