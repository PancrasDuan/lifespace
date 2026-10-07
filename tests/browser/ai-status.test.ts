import { expect, test } from '@playwright/test'

const checkedAt = '2026-10-07T02:00:00Z'
const xai = { id: 'xai', name: 'xAI', status: 'normal', statusUrl: 'https://status.x.ai/', checkedAt, description: 'All Systems Operational', incidents: [], affectedServices: [], error: null }
const normal = { status: 'normal', checkedAt, providers: [{ id: 'openai', name: 'OpenAI', status: 'normal', statusUrl: 'https://status.openai.com/', checkedAt, description: 'All Systems Operational', incidents: [], affectedServices: [], error: null }, xai] }
const abnormal = { ...normal, status: 'abnormal', providers: [{ ...normal.providers[0], status: 'abnormal', description: 'Partial System Degradation', incidents: [
  { id: 'chat', title: 'ChatGPT 回应异常', status: 'investigating', description: '正在调查', affectedServices: ['ChatGPT'], updatedAt: checkedAt, updates: [{ body: '正在调查', createdAt: checkedAt }] },
  { id: 'login', title: '登录异常', status: 'investigating', description: '原因待公布', affectedServices: [], updatedAt: checkedAt, updates: [] },
] }, xai] }

test('全部异常及受影响服务在卡片和详情展示，旧异常不能冒充当前状态', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'FAILED', message: '连接失败' } } } : { json: abnormal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看AI 服务状态详情' })
  await expect(card).toContainText('ChatGPT 回应异常')
  await expect(card).toContainText('登录异常')
  await expect(card).toContainText('原因待公布')
  await card.click()
  await expect(page.getByRole('dialog')).toContainText('受影响服务：ChatGPT')
  await expect(page.getByRole('dialog')).toContainText('受影响服务：官方未列出')
  await page.getByRole('button', { name: '关闭详情' }).click()
  failed = true
  await page.getByRole('button', { name: '刷新AI 服务状态' }).click()
  await expect(card.locator('.ai-overall')).toContainText('状态未知')
  await expect(card).toContainText('上次结果')
  await expect(card).toContainText('当前状态未确认')
  await expect(card).toContainText('ChatGPT 回应异常')
})

test('后台页面恢复可见时立即刷新官方状态', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
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
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let requests = 0
  await page.route('**/api/ai-status', route => { requests++; return route.fulfill({ json: normal }) })
  await page.goto('/')
  await expect.poll(() => requests).toBe(1)
  await page.clock.fastForward(3599000)
  expect(requests).toBe(1)
  await page.clock.fastForward(1000)
  await expect.poll(() => requests).toBe(2)
  await page.getByRole('button', { name: '刷新AI 服务状态' }).click()
  await expect.poll(() => requests).toBe(3)
  await expect(page.getByRole('button', { name: '刷新AI 服务状态' })).toBeEnabled()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await expect.poll(() => requests).toBe(4)
})

test('单家刷新失败保留上次结果并标明当前状态未知', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  let failed = false
  await page.route('**/api/ai-status', route => route.fulfill({ json: failed ? { ...normal, status: 'unknown', providers: [{ ...normal.providers[0], status: 'unknown', error: '官方状态获取失败' }, xai] } : normal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看AI 服务状态详情' })
  await expect(card).toContainText('正常')
  failed = true
  await page.getByRole('button', { name: '刷新AI 服务状态' }).click()
  await expect(card).toContainText('状态未知')
  await expect(card).toContainText('上次结果')
  await expect(card).toContainText('当前状态未确认')
})

test('AI 状态卡片显示正常状态，点击详情可打开官方状态页', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: normal }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看AI 服务状态详情' })
  await expect(card).toContainText('正常')
  await card.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('OpenAI')
  await expect(dialog.getByRole('link', { name: 'OpenAI 官方状态页' })).toHaveAttribute('href', 'https://status.openai.com/')
  await expect(dialog.getByRole('link', { name: 'xAI 官方状态页' })).toHaveAttribute('href', 'https://status.x.ai/')
})

test('两家全部异常在首页及详情按提供方分组，电脑和手机无横向溢出', async ({ page }) => {
  const result = { ...abnormal, providers: [abnormal.providers[0], { ...xai, status: 'abnormal', description: 'Partial System Degradation', incidents: [
    { ...abnormal.providers[0].incidents[0], id: 'grok', title: 'Grok 服务异常', affectedServices: ['grok.com'] },
    { ...abnormal.providers[0].incidents[1], id: 'api', title: 'xAI API 异常', affectedServices: ['Global API'] },
  ] }] }
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: result }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/')
    const card = page.getByRole('button', { name: '查看AI 服务状态详情' })
    await expect(card.getByRole('region', { name: 'OpenAI 状态' })).toContainText('ChatGPT 回应异常')
    await expect(card.getByRole('region', { name: 'OpenAI 状态' })).toContainText('登录异常')
    await expect(card.getByRole('region', { name: 'OpenAI 状态' })).not.toContainText('Grok 服务异常')
    await expect(card.getByRole('region', { name: 'xAI 状态' })).toContainText('Grok 服务异常')
    await expect(card.getByRole('region', { name: 'xAI 状态' })).toContainText('xAI API 异常')
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(size.content).toBeLessThanOrEqual(size.width)
    await card.click()
    await expect(page.getByRole('dialog').getByRole('region', { name: 'xAI 状态' })).toContainText('受影响服务：Global API')
    if (width === 1440) await page.screenshot({ path: '.cache/ai-status-detail.png' })
    await page.getByRole('button', { name: '关闭详情' }).click()
    if (width === 1440) await page.screenshot({ path: '.cache/ai-status-card.png', fullPage: true })
  }
})

test('已知异常与单家获取失败并存时，同时展示异常和未知', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '未配置' } } }))
  await page.route('**/api/ai-status', route => route.fulfill({ json: { ...abnormal, providers: [abnormal.providers[0], { ...xai, status: 'unknown', description: '状态未知', error: '官方状态接口拒绝访问' }] } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看AI 服务状态详情' })
  await expect(card.locator('.ai-overall')).toContainText('存在异常')
  await expect(card.getByRole('region', { name: 'xAI 状态' })).toContainText('状态未知')
  await expect(card).toContainText('官方状态接口拒绝访问')
  await expect(card).toContainText('ChatGPT 回应异常')
})
