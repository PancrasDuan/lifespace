import { expect, test } from './authenticated-test'

// 既有来源与布局回归显式选择全部服务；默认选择在 service-status-settings.test.ts 单独验证。
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('lifespace.service-status.providers.v1', JSON.stringify(['openai', 'xai', 'resend', 'github', 'cloudflare', 'supabase', 'notion', 'tailscale', 'tencent'])))
})

const checkedAt = '2026-10-07T02:00:00Z'
const xai = { id: 'xai', name: 'xAI', statusBasis: 'official-events', status: 'normal', statusUrl: 'https://status.x.ai/', checkedAt, description: '无未解决官方事件，按事件规则可用', incidents: [], affectedServices: [], error: null }
const normal = { status: 'normal', checkedAt, providers: [{ id: 'openai', name: 'OpenAI', status: 'normal', statusUrl: 'https://status.openai.com/', checkedAt, description: 'All Systems Operational', incidents: [], affectedServices: [], error: null }, xai] }
const abnormal = { ...normal, status: 'abnormal', providers: [{ ...normal.providers[0], status: 'abnormal', description: 'Partial System Degradation', incidents: [
  { id: 'chat', title: 'ChatGPT 回应异常', status: 'investigating', description: '正在调查', affectedServices: ['ChatGPT'], updatedAt: checkedAt, updates: [{ body: '正在调查', createdAt: checkedAt }] },
  { id: 'login', title: '登录异常', status: 'investigating', description: '原因待公布', affectedServices: [], updatedAt: checkedAt, updates: [] },
] }, xai] }

test('首页卡片没有说明，详情标题下保留说明并展示两家子状态', async ({ page }) => {
  const groups = ['APIs', 'ChatGPT', 'Codex', 'FedRAMP', 'Ads Platform'].map(name => ({ id: name, name, status: name === 'ChatGPT' ? 'abnormal' : 'normal', statusLabel: name === 'ChatGPT' ? '存在异常' : '可用', components: [] }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, providers: [{ ...normal.providers[0], subStatuses: groups }, { ...xai, subStatuses: [{ id: 'Grok', name: 'Grok', status: 'abnormal', statusLabel: '异常', components: [{ id: 'grok-com', name: 'grok.com', status: 'normal', statusLabel: '可用' }, { id: 'voice', name: 'Voice', status: 'abnormal', statusLabel: '异常' }] }] }] } }))
  await page.goto('/')
  await expect(page.locator('.panel-ai > .panel-description')).toHaveCount(0)
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('header')).toContainText('官方状态为汇总信息')
  await expect(dialog.locator('.detail-content > .detail-note')).toHaveCount(0)
  await dialog.locator('summary[aria-label="OpenAI 子服务"]').click()
  const openai = dialog.getByRole('list', { name: 'OpenAI 官网子状态' })
  await expect(openai.getByRole('listitem')).toHaveCount(5)
  await expect(openai).toContainText('ChatGPT')
  await expect(openai).toContainText('存在异常')
  await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('grok.com')
  await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('Voice')
  await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('异常')
})

test('xAI 子模块按事件显示异常和可用，注明规则，不出现旧组件快照缺失提示', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, status: 'abnormal', providers: [normal.providers[0], { ...xai, status: 'abnormal', description: '存在未解决官方事件，涉及的子模块标为异常', subStatuses: [{ id: 'grok', name: 'Grok', status: 'abnormal', statusLabel: '异常', components: [{ id: 'grok-com', name: 'grok.com', status: 'abnormal', statusLabel: '异常' }, { id: 'voice', name: 'Voice', status: 'normal', statusLabel: '可用' }] }] }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  const provider = page.getByRole('dialog').getByRole('region', { name: 'xAI 状态' })
  await expect(provider).toContainText('子模块状态（按事件）')
  await expect(provider).toContainText('依据官方未解决事件判定')
  await provider.locator('summary[aria-label="xAI 子服务"]').click()
  await provider.locator('summary[aria-label="xAI Grok 子服务"]').click()
  const list = provider.getByRole('list', { name: 'xAI 子模块状态' })
  await expect(list).toContainText('grok.com')
  await expect(list).toContainText('异常')
  await expect(list).toContainText('Voice')
  await expect(list).toContainText('可用')
  await expect(provider).not.toContainText('官网子状态暂不可获取')
})

test('请求失败后隐藏旧子状态的可用标记，明确当前官网子状态未知', async ({ page }) => {
  const data = { ...normal, providers: [{ ...normal.providers[0], subStatuses: ['APIs', 'ChatGPT', 'Codex', 'FedRAMP', 'Ads Platform'].map(name => ({ id: name, name, status: 'normal', statusLabel: '可用', components: [] })) }, xai] }
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'FAILED', message: '获取失败' } } } : { json: data }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  await page.getByRole('dialog').locator('summary[aria-label="OpenAI 子服务"]').click()
  await expect(page.getByRole('dialog').getByRole('list', { name: 'OpenAI 官网子状态' })).toContainText('可用')
  await page.getByRole('button', { name: '关闭详情' }).click()
  failed = true
  await page.getByRole('button', { name: '刷新服务状态' }).click()
  await expect(page.getByRole('button', { name: '查看服务状态详情' })).toContainText('状态未知')
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  const provider = page.getByRole('dialog').getByRole('region', { name: 'OpenAI 状态' })
  await expect(provider).toContainText('当前官网子状态未知')
  await expect(provider).toContainText('上次成功检查')
  await expect(provider.getByRole('list', { name: 'OpenAI 官网子状态' })).toHaveCount(0)
  await expect(provider).not.toContainText('可用')
})

test('一级只显示系统状态，全部异常和受影响服务在二级展示，旧异常不能冒充当前状态', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'FAILED', message: '连接失败' } } } : { json: abnormal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).not.toContainText('ChatGPT 回应异常')
  await expect(card).not.toContainText('登录异常')
  await expect(card.getByRole('region', { name: 'OpenAI 状态' })).toContainText('存在异常')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('受影响服务：ChatGPT')
  await expect(page.getByRole('dialog')).toContainText('受影响服务：官方未列出')
  await page.getByRole('button', { name: '关闭详情' }).click()
  failed = true
  await page.getByRole('button', { name: '刷新服务状态' }).click()
  await expect(card.locator('.ai-overall')).toContainText('状态未知')
  await expect(card).not.toContainText('上次结果')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('上次结果')
  await expect(page.getByRole('dialog')).toContainText('当前状态未确认')
  await expect(page.getByRole('dialog')).toContainText('ChatGPT 回应异常')
})

test('后台页面恢复可见时立即刷新官方状态', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let requests = 0
  await page.route('**/api/ai-status', route => { requests++; return route.fulfill({ json: normal }) })
  await page.goto('/')
  await expect.poll(() => requests).toBe(1)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); window.dispatchEvent(new Event('visibilitychange')) })
  expect(requests).toBe(1)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); window.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => requests).toBe(2)
})

test('AI 状态打开、手动、返回主页与每小时刷新，未到一小时不轮询', async ({ page }) => {
  await page.clock.install({ time: new Date(checkedAt) })
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let requests = 0
  await page.route('**/api/ai-status', route => { requests++; return route.fulfill({ json: normal }) })
  await page.goto('/')
  await expect.poll(() => requests).toBe(1)
  await page.clock.fastForward(3599000)
  expect(requests).toBe(1)
  await page.clock.fastForward(1000)
  await expect.poll(() => requests).toBe(2)
  await page.getByRole('button', { name: '刷新服务状态' }).click()
  await expect.poll(() => requests).toBe(3)
  await expect(page.getByRole('button', { name: '刷新服务状态' })).toBeEnabled()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await expect.poll(() => requests).toBe(4)
})

test('单家刷新失败保留上次结果并标明当前状态未知', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill({ json: failed ? { ...normal, status: 'unknown', providers: [{ ...normal.providers[0], status: 'unknown', error: '官方状态获取失败' }, xai] } : normal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).toContainText('正常')
  failed = true
  await page.getByRole('button', { name: '刷新服务状态' }).click()
  await expect(card).toContainText('状态未知')
  await expect(card).not.toContainText('上次结果')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('上次结果')
  await expect(page.getByRole('dialog')).toContainText('当前状态未确认')
})

test('AI 状态卡片显示正常状态，点击详情可打开官方状态页', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: normal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).toContainText('正常')
  await card.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('OpenAI')
  await expect(dialog.getByRole('link', { name: 'OpenAI 官方状态页' })).toHaveAttribute('href', 'https://status.openai.com/')
  await expect(dialog.getByRole('link', { name: 'xAI 官方状态页' })).toHaveAttribute('href', 'https://status.x.ai/')
})

test('一级按行显示两家状态，二级保留全部事件，电脑和手机无横向溢出', async ({ page }) => {
  const result = { ...abnormal, providers: [abnormal.providers[0], { ...xai, status: 'abnormal', description: 'Partial System Degradation', incidents: [
    { ...abnormal.providers[0].incidents[0], id: 'grok', title: 'Grok 服务异常', affectedServices: ['grok.com'] },
    { ...abnormal.providers[0].incidents[1], id: 'api', title: 'xAI API 异常', affectedServices: ['Global API'] },
  ] }] }
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: result }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/')
    const card = page.getByRole('button', { name: '查看服务状态详情' })
    await expect(card.getByRole('region', { name: 'OpenAI 状态' })).toHaveText('OpenAI存在异常')
    await expect(card.getByRole('region', { name: 'xAI 状态' })).toHaveText('xAI存在异常')
    await expect(card).not.toContainText('ChatGPT 回应异常')
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(size.content).toBeLessThanOrEqual(size.width)
    await card.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('region', { name: 'OpenAI 状态' })).toContainText('ChatGPT 回应异常')
    await expect(dialog.getByRole('region', { name: 'OpenAI 状态' })).toContainText('登录异常')
    await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('Grok 服务异常')
    await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('xAI API 异常')
    await expect(dialog.getByRole('region', { name: 'xAI 状态' })).toContainText('受影响服务：Global API')
    if (width === 1440) await page.screenshot({ path: '.cache/ai-status-detail.png' })
    await page.getByRole('button', { name: '关闭详情' }).click()
    if (width === 1440) await page.screenshot({ path: '.cache/ai-status-card.png', fullPage: true })
  }
})

test('已知异常与单家获取失败并存时，同时展示异常和未知', async ({ page }) => {
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...abnormal, providers: [abnormal.providers[0], { ...xai, status: 'unknown', description: '状态未知', error: '官方状态接口拒绝访问' }] } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.locator('.ai-overall')).toContainText('存在异常')
  await expect(card.getByRole('region', { name: 'xAI 状态' })).toContainText('状态未知')
  await expect(card).not.toContainText('官方状态接口拒绝访问')
  await expect(card).not.toContainText('ChatGPT 回应异常')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('官方状态接口拒绝访问')
  await expect(page.getByRole('dialog')).toContainText('ChatGPT 回应异常')
})

const resend = { id: 'resend', name: 'Resend', statusBasis: 'official-components', status: 'normal', statusUrl: 'https://resend-status.com/', checkedAt, description: '发信相关组件正常', error: null, affectedServices: [], subStatusError: null,
  subStatuses: ['SMTP', 'General API', 'Single Email', 'Dashboard', 'Webhooks'].map(name => ({ id: name, name, status: name === 'Dashboard' ? 'abnormal' : 'normal', statusLabel: name === 'Dashboard' ? '严重故障' : '正常', components: [] })),
  incidents: [{ id: 'dashboard', title: 'Dashboard 故障', status: 'investigating', description: '正在调查控制台异常', affectedServices: ['Dashboard'], updatedAt: checkedAt, updates: [] }],
}

test('服务状态展示三家，Resend 非发信异常保留在详情，刷新失败保留历史结果', async ({ page }) => {
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, status: failed ? 'unknown' : 'normal', providers: [...normal.providers, failed ? { ...resend, status: 'unknown', description: '状态未知', error: '官方状态获取失败', subStatuses: [], incidents: [] } : resend] } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.locator('.service-status-row')).toHaveCount(3)
  await expect(card).toContainText('OpenAI')
  await expect(card).toContainText('xAI')
  await expect(card).toContainText('Resend')
  await expect(card).toContainText('正常')
  await expect(card).not.toContainText('Dashboard 故障')
  await card.click()
  const region = page.getByRole('dialog').getByRole('region', { name: 'Resend 状态' })
  await expect(region).toContainText('汇总仅关注 SMTP、General API、Single Email')
  await expect(region).toContainText('Dashboard 故障')
  await expect(region).toContainText('严重故障')
  await expect(region).toContainText('Webhooks')
  await expect(region.getByRole('link', { name: 'Resend 官方状态页' })).toHaveAttribute('href', 'https://resend-status.com/')
  await page.getByRole('button', { name: '关闭详情' }).click()
  failed = true
  await page.getByRole('button', { name: '刷新服务状态' }).click()
  await expect(card).toContainText('状态未知')
  await expect(card).not.toContainText('上次结果')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('上次结果')
  await expect(page.getByRole('dialog')).toContainText('当前状态未确认')
})


test('Resend 发信组件未知时仍展示已取得的当前事件与其余组件', async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, status: 'unknown', providers: [...normal.providers, { ...resend, status: 'unknown', error: '发信相关组件状态无法识别', subStatuses: resend.subStatuses.map(component => component.name === 'SMTP' ? { ...component, status: 'unknown', statusLabel: '未知' } : component) }] } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).toContainText('状态未知')
  await card.click()
  const region = page.getByRole('dialog').getByRole('region', { name: 'Resend 状态' })
  await expect(region).toContainText('Dashboard 故障')
  await expect(region).toContainText('正在调查控制台异常')
  await expect(region).toContainText('Webhooks')
  await expect(region).not.toContainText('上次结果')
})

const extendedProviders = [
  ...normal.providers, resend,
  ...[{ id: 'github', name: 'GitHub', statusUrl: 'https://www.githubstatus.com/' }, { id: 'cloudflare', name: 'Cloudflare', statusUrl: 'https://www.cloudflarestatus.com/' }, { id: 'supabase', name: 'Supabase', statusUrl: 'https://status.supabase.com/' }, { id: 'notion', name: 'Notion', statusUrl: 'https://www.notion-status.com/' }, { id: 'tailscale', name: 'Tailscale', statusUrl: 'https://status.tailscale.com/' }, { id: 'tencent', name: '腾讯云', statusUrl: 'https://status.cloud.tencent.com/' }].map(provider => ({ ...provider, statusBasis: 'official-components', status: 'normal', checkedAt, description: '官方全平台状态', error: null, incidents: [], affectedServices: [], subStatusError: null,
    subStatuses: [{ id: 'group', name: 'Services', status: 'normal', statusLabel: '正常', components: Array.from({ length: provider.id === 'cloudflare' ? 300 : 3 }, (_, i) => ({ id: String(i), name: `Service ${i}`, status: i === 1 ? 'abnormal' : 'normal', statusLabel: i === 1 ? '部分故障' : '正常' })) }],
  })),
]

test('九家独立服务卡片，子服务默认收起，分组可键盘展开，各家独立收起', async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, providers: extendedProviders } }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.service-provider-card')).toHaveCount(9)
  await expect(dialog.locator('.service-substatus-fold[open]')).toHaveCount(0)
  const cloudflare = dialog.getByRole('region', { name: 'Cloudflare 状态' })
  await expect(cloudflare).toContainText('300 项')
  await expect(cloudflare).toContainText('1 项异常')
  const summary = cloudflare.locator('summary[aria-label="Cloudflare 子服务"]')
  await summary.focus(); await page.keyboard.press('Enter')
  await expect(cloudflare.locator('.service-substatus-fold')).toHaveAttribute('open', '')
  const group = cloudflare.locator('summary[aria-label="Cloudflare Services 子服务"]')
  await group.click()
  await expect(cloudflare.getByText('Service 299', { exact: true })).toBeVisible()
  await expect(cloudflare.getByText('部分故障', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Notion 状态' }).locator('.service-substatus-fold')).not.toHaveAttribute('open', '')
  await summary.click()
  await expect(cloudflare.getByText('Service 299', { exact: true })).not.toBeVisible()
})

test('九家详情在电脑与手机无横向溢出，服务边界清晰且异常事件不随子服务折叠', async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, providers: extendedProviders } }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/')
    await page.getByRole('button', { name: '查看服务状态详情' }).click()
    const dialog = page.getByRole('dialog')
    const resendRegion = dialog.getByRole('region', { name: 'Resend 状态' })
    await expect(resendRegion.getByText('Dashboard 故障', { exact: true })).toBeVisible()
    await expect(resendRegion.locator('.service-substatus-fold')).not.toHaveAttribute('open', '')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await dialog.locator('.service-provider-card').first().evaluate(element => getComputedStyle(element).borderLeftWidth)).not.toBe('0px')
    if (width === 1440) await page.screenshot({ path: '.cache/service-status-redesign.png' })
    await page.getByRole('button', { name: '关闭详情' }).click()
  }
})


test('一级九个系统各占一行，仅显示标题和状态，正常系统可见且手机不溢出', async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, providers: extendedProviders } }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/')
    const card = page.getByRole('button', { name: '查看服务状态详情' })
    const rows = card.locator('.service-status-row')
    await expect(rows).toHaveCount(9)
    for (let i = 0; i < extendedProviders.length; i++) {
      await expect(rows.nth(i).locator('strong')).toHaveText(extendedProviders[i].name)
      await expect(rows.nth(i).locator('.ai-state')).toBeVisible()
    }
    await expect(card).not.toContainText('Dashboard 故障')
    await expect(card).not.toContainText('官方全平台状态')
    await expect(card).not.toContainText('Webhooks')
    const boxes = await rows.evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, bottom: box.bottom, width: box.width } }))
    expect(boxes.every(box => Math.abs(box.x - boxes[0].x) < 1 && Math.abs(box.width - boxes[0].width) < 1)).toBe(true)
    expect(boxes.slice(1).every((box, i) => box.y >= boxes[i].bottom)).toBe(true)
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    if (width === 1440) await page.screenshot({ path: '.cache/service-status-primary.png', fullPage: true })
  }
})


test('Tailscale 一级仅名称与状态，二级独立分区默认收起并可打开官方链接', async ({ page }) => {
  const provider = { ...extendedProviders[7], subStatuses: ['Coordination service', 'DERP relay servers', 'API (api.tailscale.com)'].map(name => ({ id: name, name, status: 'normal', statusLabel: '正常', components: [] })) }
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, providers: extendedProviders.map(current => current.id === 'tailscale' ? provider : current) } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.getByRole('region', { name: 'Tailscale 状态' })).toHaveText('Tailscale正常')
  await expect(card).not.toContainText('DERP relay servers')
  await card.click()
  const region = page.getByRole('dialog').getByRole('region', { name: 'Tailscale 状态' })
  await expect(region.locator('.service-substatus-fold')).not.toHaveAttribute('open', '')
  await region.locator('summary[aria-label="Tailscale 子服务"]').click()
  await expect(region.getByText('DERP relay servers', { exact: true })).toBeVisible()
  await expect(region.getByRole('link', { name: 'Tailscale 官方状态页' })).toHaveAttribute('href', 'https://status.tailscale.com/')
})


test('腾讯云一级只显示名称状态，二级区分当前产品提示与事件时间', async ({ page }) => {
  const provider = { ...extendedProviders[8], status: 'abnormal', incidents: [{ id: 'ap-beijing:cvm', kind: 'component-status', title: '北京 / 云服务器', status: 'NOTIFY', description: '官方当前状态：服务提示', affectedServices: ['北京 / 云服务器'], updatedAt: null, updates: [] }], subStatuses: [] }
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...normal, status: 'abnormal', providers: extendedProviders.map(current => current.id === 'tencent' ? provider : current) } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.getByRole('region', { name: '腾讯云 状态' })).toHaveText('腾讯云存在异常')
  await expect(card).not.toContainText('北京 / 云服务器')
  await card.click()
  const region = page.getByRole('dialog').getByRole('region', { name: '腾讯云 状态' })
  await expect(region).toContainText('当前服务状态提示')
  await expect(region).not.toContainText('事件更新')
  await expect(region.getByRole('link', { name: '腾讯云 官方状态页' })).toHaveAttribute('href', 'https://status.cloud.tencent.com/')
})
