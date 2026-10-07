import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'

// 仅核验公开 AI 状态，不读取首页的任务、域名或本地凭据。
const args = process.argv.slice(2)
const base = new URL(args.find(value => !value.startsWith('--')) ?? 'http://127.0.0.1:5174/')
const requireSubStatuses = args.includes('--require-substatuses')
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200, `来源无法获取：${url} HTTP ${response.status}`)
  return response.text()
}
const [openaiText, xaiText, localText] = await Promise.all([
  get('https://status.openai.com/proxy/status.openai.com'), get('https://status.x.ai/feed.xml'), get(new URL('/api/ai-status', base)),
])
const official = JSON.parse(openaiText).summary
const local = JSON.parse(localText)
const openai = local.providers.find(provider => provider.id === 'openai')
const xai = local.providers.find(provider => provider.id === 'xai')
assert(openai && xai, '必须返回两家提供方')
assert.notEqual(openai.status, 'unknown', 'OpenAI 未完成真实取数')
assert.equal(xai.error, null, 'xAI 事件来源未完成真实取数')
const active = official.ongoing_incidents.filter(event => !['resolved', 'completed', 'postmortem'].includes(event.status))
const parent = new Map()
const product = new Map()
for (const row of official.structure.items) for (const component of row.group?.components ?? []) {
  parent.set(component.component_id, `${row.group.name} / ${component.name}`)
  product.set(component.component_id, row.group.name)
}
const sorted = values => [...values].sort()
const affectedProducts = [...new Set(official.affected_components.filter(component => component.status !== 'operational').map(component => product.get(component.component_id) ?? official.components.find(candidate => candidate.id === component.component_id)?.name))]
assert.deepEqual(sorted(openai.affectedServices), sorted(affectedProducts), 'OpenAI 整体受影响产品不一致')
assert.equal(openai.status, active.length || affectedProducts.length ? 'abnormal' : 'normal', 'OpenAI 整体状态不一致')
const abnormalComponents = new Set(official.affected_components.filter(component => component.status !== 'operational').map(component => component.component_id))
const expectedGroups = official.structure.items.filter(row => row.group && !row.group.hidden).map(({ group }) => ({ name: group.name, status: group.components.some(component => abnormalComponents.has(component.component_id)) ? 'abnormal' : 'normal' }))
assert.deepEqual(openai.subStatuses.map(({ name, status }) => ({ name, status })), expectedGroups, 'OpenAI 官网五组子状态不一致')
assert.deepEqual(sorted(openai.incidents.map(event => event.id)), sorted(active.map(event => event.id)), 'OpenAI 当前事件不一致')
for (const event of active) {
  const shown = openai.incidents.find(candidate => candidate.id === event.id)
  assert.deepEqual(sorted(shown.affectedServices), sorted(event.affected_components.map(component => parent.get(component.component_id))), 'OpenAI 产品归属不一致')
  assert.equal(shown.title, event.name, 'OpenAI 事件标题不一致')
  const updates = [...event.updates].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  assert.equal(shown.description, updates.find(update => update.message_string.trim())?.message_string ?? '原因待公布', 'OpenAI 最新官方说明不一致')
}
const rss = new XMLParser({ parseTagValue: false, isArray: name => name === 'item' || name === 'category' }).parse(xaiText)
const feedItems = rss.rss.channel.item ?? []
const activeItems = feedItems.filter(item => !item.category.includes('resolved'))
const activeIds = [...new Set(activeItems.map(item => item.guid))]
assert.deepEqual(sorted(xai.incidents.map(event => event.id)), sorted(activeIds), 'xAI 未解决事件与官方 RSS 不一致')
assert.equal(xai.statusBasis, 'official-events', 'xAI 应以官方事件作为判定依据')
assert.equal(xai.status, activeIds.length ? 'abnormal' : 'normal', 'xAI 整体事件判定不一致')
const catalogue = JSON.parse(await readFile(new URL('../src/shared/xai-modules.json', import.meta.url), 'utf8'))
const moduleIds = new Set(catalogue.groups.flatMap(group => group.modules.map(module => module.id)))
const affectedIds = new Set(activeItems.map(item => {
  const url = new URL(item.link)
  assert.equal(url.origin, 'https://status.x.ai', 'xAI 事件模块链接不是官方来源')
  return decodeURIComponent(url.pathname.split('/').filter(Boolean)[0])
}))
const shownModules = xai.subStatuses.flatMap(group => group.components)
assert.deepEqual(sorted(shownModules.map(module => module.id)), sorted([...new Set([...moduleIds, ...affectedIds])]), 'xAI 模块目录或新增事件模块未完整展示')
for (const group of xai.subStatuses) {
  for (const module of group.components) {
    assert.equal(module.status, affectedIds.has(module.id) ? 'abnormal' : 'normal', `xAI 模块事件判定错误：${module.id}`)
  }
  assert.equal(group.status, group.components.some(module => affectedIds.has(module.id)) ? 'abnormal' : 'normal', `xAI 分组事件判定错误：${group.name}`)
}
const textContent = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(textContent).join(' ') : value && typeof value === 'object' ? Object.values(value).map(textContent).join(' ') : ''
const clean = value => value.replace(/\s+/g, ' ').trim()
for (const id of activeIds) {
  const items = activeItems.filter(item => item.guid === id)
  const shown = xai.incidents.find(event => event.id === id)
  const titles = items.map(item => item.title.match(/^\[([^\]]+)\]\s*(.*)$/))
  assert(titles.every(Boolean), 'xAI 官方服务名称无法识别')
  assert.deepEqual(sorted(shown.affectedServices), sorted([...new Set(titles.map(title => title[1]))]), 'xAI 全部受影响服务不一致')
  assert.equal(shown.title, titles[0][2] || titles[0][1], 'xAI 事件标题不一致')
  const updates = items.flatMap(item => [...item.description.matchAll(/<div>([\s\S]*?)<\/div>/gi)].map(block => {
    const parsed = new XMLParser({ parseTagValue: false, isArray: name => name === 'p' }).parse(`<root>${block[1]}</root>`).root
    const date = parsed.p?.[0]?.strong
    // 用独立 XML 树读取正文，忽略排版空白，不复用服务端转换函数。
    const paragraphs = (parsed.p ?? []).slice(1)
    return { at: Date.parse(date), body: clean(textContent(paragraphs)) }
  })).sort((a, b) => b.at - a.at)
  assert(updates.every(update => Number.isFinite(update.at)), 'xAI 官方事件更新时间无法识别')
  assert.equal(clean(shown.description), updates.find(update => update.body)?.body ?? '原因待公布', 'xAI 最新官方说明不一致')
}
const report = {
  checkedAt: new Date().toISOString(), passed: true,
  subStatusCoverage: { openai: true, xai: shownModules.length >= moduleIds.size },
  statusBasis: { openai: 'official-components', xai: 'official-events' }, catalogueVerifiedOn: catalogue.verifiedOn,
  sources: { openai: 'https://status.openai.com/proxy/status.openai.com', xai: 'https://status.x.ai/feed.xml' },
  providers: local.providers.map(({ name, status, affectedServices, incidents }) => ({ name, status, affectedServices, incidents: incidents.map(({ title, affectedServices }) => ({ title, affectedServices })) })),
}
if (requireSubStatuses) assert(report.subStatusCoverage.xai, 'xAI 事件判定子模块未完整展示')
await mkdir('.cache', { recursive: true })
await writeFile('.cache/ai-status-live-check.json', JSON.stringify(report, null, 2) + '\n')
console.log(`核心状态核验通过：${report.checkedAt}；OpenAI ${openai.status}（${openai.affectedServices.join('、') || '无异常'}）；xAI ${xai.status}；OpenAI 子状态一致；xAI 事件判定子模块${report.subStatusCoverage.xai ? '验证通过' : '尚未完整'}。`)
