import { expect, test } from '@playwright/test'

const checkedAt = '2026-10-07T02:00:00Z'
const normal = { status: 'normal', checkedAt, providers: [{ id: 'openai', name: 'OpenAI', status: 'normal', statusUrl: 'https://status.openai.com/', checkedAt, description: 'All Systems Operational', incidents: [], affectedServices: [], error: null }] }
const abnormal = { ...normal, status: 'abnormal', providers: [{ ...normal.providers[0], status: 'abnormal', description: 'Partial System Degradation', incidents: [
  { id: 'chat', title: 'ChatGPT 回应异常', status: 'investigating', description: '正在调查', affectedServices: ['ChatGPT'], updatedAt: checkedAt, updates: [{ body: '正在调查', createdAt: checkedAt }] },
  { id: 'login', title: '登录异常', status: 'investigating', description: '原因待公布', affectedServices: [], updatedAt: checkedAt, updates: [] },
] }] }

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
  await page.route('**/api/ai-status', route => route.fulfill({ json: failed ? { ...normal, status: 'unknown', providers: [{ ...normal.providers[0], status: 'unknown', error: '官方状态获取失败' }] } : normal }))
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
})
