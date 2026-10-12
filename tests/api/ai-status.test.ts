import { afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import app from './authenticated-app'
import { aiStatusResultSchema } from '../../src/shared/ai-status-contracts'
import officialPageSummary from '../fixtures/ai-status/openai-page-summary.json'
import resendSummary from '../fixtures/ai-status/resend-summary.json'
import githubSummary from '../fixtures/ai-status/github-summary.json'
import cloudflareSummary from '../fixtures/ai-status/cloudflare-summary.json'
import notionSummary from '../fixtures/ai-status/notion-summary.json'
import supabasePage from '../fixtures/ai-status/supabase-page-summary.json'
const normalPage = (page: typeof githubSummary | typeof cloudflareSummary | typeof notionSummary) => ({ ...page, components: page.components.map(component => ({ ...component, status: 'operational' })), incidents: [] })
const additionalSources = new Map<string, unknown>([
  ['https://www.githubstatus.com/api/v2/summary.json', normalPage(githubSummary)],
  ['https://www.cloudflarestatus.com/api/v2/summary.json', normalPage(cloudflareSummary)],
  ['https://status.supabase.com/proxy/status.supabase.com', supabasePage],
  ['https://www.notion-status.com/api/v2/summary.json', normalPage(notionSummary)],
])


const officialFeed = readFileSync(new URL('../fixtures/ai-status/xai-feed.xml', import.meta.url), 'utf8')
const normalOpenAI = { summary: { ...officialPageSummary.summary, affected_components: [], ongoing_incidents: [] } }
const feed = (items: string) => `<rss version="2.0"><channel><title>SpaceXAI System Status</title><link>https://status.x.ai</link>${items}</channel></rss>`
const item = (id: string, service: string, title: string, status = 'investigating') => `<item><title>[${service}] ${title}</title><link>https://status.x.ai/${({'grok.com':'grok-com','Global API':'api-global',Voice:'voice'} as Record<string,string>)[service] ?? service.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/${encodeURIComponent(id)}</link><guid>${id}</guid><pubDate>Wed, 07 Oct 2026 02:00:00 GMT</pubDate><category>outage</category><category>${status}</category><description><![CDATA[<h3>Status: ${status.toUpperCase()}</h3><h4>Updates:</h4><div><p><strong>Wed, 07 Oct 2026 02:10:00 GMT</strong></p><h3>Investigating</h3><p>We are investigating this incident.</p></div>]]></description></item>`
const activeFeed = feed(item('grok', 'grok.com', 'Grok outage'))
const result = async () => aiStatusResultSchema.parse(await (await app.request('/api/ai-status', {}, {})).json())
const sources = (openai: unknown = normalOpenAI, xai = officialFeed) => {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: URL | string | Request) => {
    const url = String(input); urls.push(url)
    if (additionalSources.has(url)) return Response.json(additionalSources.get(url))
    if (url === 'https://status.openai.com/proxy/status.openai.com') return Response.json(openai)
    if (url === 'https://status.x.ai/feed.xml') return new Response(xai)
    if (url === 'https://resend-status.com/api/v2/summary.json') return Response.json(resendSummary)
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
  expect(data.providers[1].description).toBe('无未解决官方事件，按事件规则可用')
  expect(urls).toEqual(['https://status.openai.com/proxy/status.openai.com', 'https://status.x.ai/feed.xml', 'https://resend-status.com/api/v2/summary.json', ...additionalSources.keys()])
})

test('七家正常时合并状态正常，保留各家官方链接和真实检查时间', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
  sources()
  const data = await result()
  expect(data.status).toBe('normal')
  expect(data.providers.map(provider => provider.statusUrl)).toEqual(['https://status.openai.com/', 'https://status.x.ai/', 'https://resend-status.com/', 'https://www.githubstatus.com/', 'https://www.cloudflarestatus.com/', 'https://status.supabase.com/', 'https://www.notion-status.com/'])
  expect(data.providers.map(provider => provider.checkedAt)).toEqual(Array(7).fill('2026-10-07T02:00:00.000Z'))
})

test('OpenAI 官网五个分组独立计算子状态，只有包含异常组件的 ChatGPT 异常', async () => {
  sources(officialPageSummary)
  const data = await result()
  expect(data.providers[0]).toMatchObject({ subStatuses: [
    { name: 'APIs', status: 'normal' }, { name: 'ChatGPT', status: 'abnormal' },
    { name: 'Codex', status: 'normal' }, { name: 'FedRAMP', status: 'normal' }, { name: 'Ads Platform', status: 'normal' },
  ] })
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
    if (additionalSources.has(String(input))) return Response.json(additionalSources.get(String(input)))
    if (String(input) === 'https://resend-status.com/api/v2/summary.json') return Response.json(resendSummary)
    const openai = String(input).includes('openai.com'); const state = openai ? openaiState : xaiState
    if (state === 'unknown') return new Response('blocked-private-detail', { status: 403 })
    return openai ? Response.json(state === 'abnormal' ? officialPageSummary : normalOpenAI) : new Response(state === 'abnormal' ? activeFeed : officialFeed)
  })
  const data = await result()
  expect(data.status).toBe(expected)
  expect(data.providers.map(provider => provider.status)).toEqual([openaiState, xaiState, ...Array(5).fill('normal')])
  expect(JSON.stringify(data)).not.toContain('blocked-private-detail')
})

test.each([403, 500])('来源获取失败显示未知，且不暴露来源响应：%s', async status => {
  vi.stubGlobal('fetch', async () => new Response('private-detail', { status }))
  const data = await result()
  expect(data.status).toBe('unknown')
  expect(data.providers.map(provider => provider.status)).toEqual(Array(7).fill('unknown'))
  expect(JSON.stringify(data)).not.toContain('private-detail')
})

test('来源字段变化不伪装为正常，HTML 错误页不作为有效 RSS', async () => {
  sources({}, '<html><body>Blocked</body></html>')
  const data = await result()
  expect(data.status).toBe('unknown')
  expect(data.providers.map(provider => provider.status)).toEqual(['unknown', 'unknown', ...Array(5).fill('normal')])
})

test('RSS 含外部实体或无法识别的事件状态时报告未知', async () => {
  for (const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + officialFeed, feed(item('new', 'Grok', 'Unknown status', 'new-status'))]) {
    sources(normalOpenAI, xml)
    expect((await result()).providers[1].status).toBe('unknown')
  }
})

test('xAI 无未解决事件则三组14个子模块均可用，只请求RSS不依赖组件JSON', async () => {
  const urls = sources()
  const provider = (await result()).providers[1]
  expect(provider.status).toBe('normal')
  expect(provider.subStatuses.map(group => group.name)).toEqual(['Grok', 'API', 'Services'])
  const modules = provider.subStatuses.flatMap(group => group.components)
  expect(modules).toHaveLength(14)
  expect(modules.every(module => module.status === 'normal' && module.statusLabel === '可用')).toBe(true)
  expect(urls).toEqual(['https://status.openai.com/proxy/status.openai.com', 'https://status.x.ai/feed.xml', 'https://resend-status.com/api/v2/summary.json', ...additionalSources.keys()])
})

test('xAI 有未解决事件只标记涉及模块异常，其余模块可用，其他分组不受影响', async () => {
  sources(normalOpenAI, activeFeed)
  const provider = (await result()).providers[1]
  const groups = provider.subStatuses
  const modules = groups.flatMap(group => group.components)
  expect(provider.status).toBe('abnormal')
  expect(provider.statusBasis).toBe('official-events')
  expect(groups.map(group => group.status)).toEqual(['abnormal', 'normal', 'normal'])
  expect(modules.filter(module => module.status === 'abnormal').map(module => module.id)).toEqual(['grok-com'])
  expect(modules.find(module => module.id === 'voice')?.status).toBe('normal')
  expect(modules.find(module => module.id === 'api-global')?.status).toBe('normal')
})

test('同一模块多个事件全部保留，部分解决仍异常，全部解决才恢复可用', async () => {
  for (const [states, expected] of [[['investigating', 'monitoring'], 'abnormal'], [['resolved', 'monitoring'], 'abnormal'], [['resolved', 'resolved'], 'normal']] as const) {
    sources(normalOpenAI, feed(item('a', 'Voice', 'Voice degraded', states[0]) + item('b', 'Voice', 'Voice error', states[1])))
    const provider = (await result()).providers[1]
    expect(provider.subStatuses.flatMap(group => group.components).find(module => module.id === 'voice')?.status).toBe(expected)
    expect(provider.incidents).toHaveLength(states.filter(state => state !== 'resolved').length)
  }
})

test('目录外的新模块出现事件时加入其他模块，不遗漏异常', async () => {
  sources(normalOpenAI, feed(item('new', 'Future Module', 'New service incident')))
  const provider = (await result()).providers[1]
  expect(provider.subStatuses[3]).toMatchObject({ name: '其他模块', status: 'abnormal', components: [{ id: 'future-module', name: 'Future Module', status: 'abnormal' }] })
})

test('RSS 获取失败时整体及已维护的14个子模块全部未知，不能按空事件判为可用', async () => {
  vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }))
  const provider = (await result()).providers[1]
  expect(provider.status).toBe('unknown')
  expect(provider.subStatuses.flatMap(group => group.components)).toHaveLength(14)
  expect(provider.subStatuses.flatMap(group => group.components).every(module => module.status === 'unknown')).toBe(true)
})

test('同一事件多服务条目保留最新官方说明而非只保留第一条', async () => {
  const later = item('same', 'Global API', 'Shared incident').replace('02:10:00', '02:20:00').replace('We are investigating this incident.', 'We are monitoring the recovery.')
  sources(normalOpenAI, feed(item('same', 'grok.com', 'Shared incident') + later))
  const provider = (await result()).providers[1]
  expect(provider.incidents[0].description).toBe('We are monitoring the recovery.')
  expect(provider.incidents[0].updatedAt).toBe('2026-10-07T02:20:00.000Z')
})

const resendResult = async (summary: unknown) => {
  sources()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', (input: URL | string | Request, init?: RequestInit) => String(input) === 'https://resend-status.com/api/v2/summary.json' ? Promise.resolve(Response.json(summary)) : original(input, init))
  return result()
}
const changeResend = (name: string, status: string) => ({ ...resendSummary, components: resendSummary.components.map(component => component.name === name ? { ...component, status } : component) })
const resendEvent = { id: 'dashboard-event', name: 'Dashboard unavailable', status: 'investigating', updated_at: '2026-10-12T02:00:00Z', components: [{ id: 'dashboard', name: 'Dashboard', status: 'major_outage' }], incident_updates: [{ body: 'Monitoring recovery', created_at: '2026-10-12T02:00:00Z' }, { body: 'Investigating', created_at: '2026-10-12T01:00:00Z' }] }

test.each(['SMTP', 'General API', 'Single Email'])('Resend %s 异常影响三家汇总', async name => {
  const data = await resendResult(changeResend(name, 'partial_outage'))
  expect(data.status).toBe('abnormal')
  expect(data.providers[2]).toMatchObject({ status: 'abnormal', affectedServices: [name] })
})

test('Resend Dashboard 故障与事件仅在详情保留，不影响发信状态汇总', async () => {
  const data = await resendResult({ ...changeResend('Dashboard', 'major_outage'), incidents: [resendEvent, { ...resendEvent, id: 'resolved', status: 'resolved' }] })
  expect(data.status).toBe('normal')
  expect(data.providers[2].subStatuses.find(component => component.name === 'Dashboard')?.status).toBe('abnormal')
  expect(data.providers[2].incidents).toHaveLength(1)
  expect(data.providers[2].incidents[0]).toMatchObject({ description: 'Monitoring recovery', affectedServices: ['Dashboard'] })
})

test('Resend 关键组件缺失或新增未知状态不能误报正常，其他已确认故障优先', async () => {
  const missing = { ...resendSummary, components: resendSummary.components.filter(component => component.name !== 'SMTP') }
  for (const summary of [missing, changeResend('SMTP', 'future-state')]) {
    const data = await resendResult(summary)
    expect(data.status).toBe('unknown')
    expect(data.providers.slice(0, 2).every(provider => provider.status === 'normal')).toBe(true)
  }
  expect((await resendResult({ ...missing, components: missing.components.map(component => component.name === 'General API' ? { ...component, status: 'major_outage' } : component) })).status).toBe('abnormal')
})

test('Resend 无组件归属事件和空说明保留，更新时间排序，来源字段失效显示未知', async () => {
  const data = await resendResult({ ...resendSummary, incidents: [{ ...resendEvent, components: undefined, incident_updates: [{ body: null, created_at: resendEvent.updated_at }] }] })
  expect(data.providers[2].incidents[0]).toMatchObject({ description: '原因待公布', affectedServices: [] })
  expect(data.status).toBe('normal')
  const invalid = await resendResult({ components: [] })
  expect(invalid.providers[2]).toMatchObject({ status: 'unknown', error: '官方状态获取失败，请刷新重试或查看官方状态页' })
  expect(invalid.providers.slice(0, 2).every(provider => provider.status === 'normal')).toBe(true)
})

const extraResult = async (url: string, payload: unknown) => {
  sources()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', (input: URL | string | Request, init?: RequestInit) => String(input) === url ? Promise.resolve(Response.json(payload)) : original(input, init))
  return result()
}

test('GitHub 真实事件完整归属，Cloudflare 全量地区按官网分组，Notion 无事件字段仍正常', async () => {
  const github = (await extraResult('https://www.githubstatus.com/api/v2/summary.json', githubSummary)).providers[3]
  expect(github.status).toBe('abnormal')
  expect(github.incidents[0].affectedServices).toEqual(githubSummary.incidents[0].components.map(component => component.name))
  const cloudflare = (await extraResult('https://www.cloudflarestatus.com/api/v2/summary.json', cloudflareSummary)).providers[4]
  expect(cloudflare.subStatuses.flatMap(group => group.components.length ? group.components : [group])).toHaveLength(cloudflareSummary.components.filter(component => !component.group).length)
  expect(cloudflare.incidents).toHaveLength(cloudflareSummary.incidents.length)
  const notion = (await extraResult('https://www.notion-status.com/api/v2/summary.json', notionSummary)).providers[6]
  expect(notion.status).toBe('normal')
  expect(notion.subStatuses).toHaveLength(notionSummary.components.length)
})

test('Supabase 官网完整快照包含全部产品区域及 Auth 等独立组件', async () => {
  const data = await resultWithSources()
  const provider = data.providers[5]
  expect(provider.subStatuses).toHaveLength(supabasePage.summary.structure.items.length)
  expect(provider.subStatuses.find(group => group.name === 'Postgres')?.components).toHaveLength(18)
  expect(provider.subStatuses.some(group => group.name === 'Auth')).toBe(true)
  expect(provider.status).toBe('normal')
})
async function resultWithSources() { sources(); return result() }

test.each([...additionalSources.keys()])('新增来源 %s 字段失效只影响本家，其他六家保持正常', async url => {
  const data = await extraResult(url, {})
  expect(data.providers.filter(provider => provider.status === 'unknown')).toHaveLength(1)
  expect(data.providers.filter(provider => provider.status === 'normal')).toHaveLength(6)
  expect(data.status).toBe('unknown')
})

test('Statuspage 无法识别的组件状态为未知，不把父分组正常状态作为子服务正常依据', async () => {
  const data = await extraResult('https://www.cloudflarestatus.com/api/v2/summary.json', { components: [
    { id: 'group', name: 'Services', status: 'operational', group: true },
    { id: 'worker', name: 'Workers', status: 'future-status', group_id: 'group' },
  ], incidents: [] })
  expect(data.providers[4]).toMatchObject({ status: 'unknown', subStatuses: [{ status: 'unknown', components: [{ status: 'unknown' }] }] })
})

test('Supabase 区域异常准确归属产品，未知影响状态不误报正常', async () => {
  const postgres = supabasePage.summary.structure.items.find(item => item.group?.name === 'Postgres')!.group!
  const id = postgres.components[0].component_id
  for (const [state, expected] of [['major_outage', 'abnormal'], ['future-state', 'unknown']] as const) {
    const data = await extraResult('https://status.supabase.com/proxy/status.supabase.com', { summary: { ...supabasePage.summary, affected_components: [{ component_id: id, status: state }] } })
    const provider = data.providers[5]
    expect(provider.status).toBe(expected)
    expect(provider.subStatuses.find(group => group.name === 'Postgres')?.components[0].status).toBe(expected)
    expect(provider.subStatuses.find(group => group.name === 'Auth')?.status).toBe('normal')
  }
})


test('Supabase 有效项与字段漂移项混合或组件元数据缺失时，整家未知而不是漏项正常', async () => {
  const original = supabasePage.summary
  for (const structure of [
    { items: [original.structure.items[0], { renamed_component: { component_id: 'missing', name: 'New product' } }] },
    { items: [...original.structure.items, { component: { component_id: 'missing', name: 'New product' } }] },
  ]) {
    const data = await extraResult('https://status.supabase.com/proxy/status.supabase.com', { summary: { ...original, structure } })
    expect(data.providers[5]).toMatchObject({ status: 'unknown', subStatuses: [], subStatusError: '官网子状态暂不可获取' })
    expect(data.providers.filter(provider => provider.status === 'normal')).toHaveLength(6)
  }
})
