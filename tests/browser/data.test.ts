import { expect, test } from './authenticated-test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '测试中不访问官方状态来源' } } }))
})

const tasks = [1, 2, 3, 4].map(id => ({ id: String(id), title: `待办 ${id}`, area: '学习', plannedAt: 1791244800 + id * 3600, dueAt: null }))
const weather = { date: '2026-10-06', timeZone: 'Asia/Shanghai', fetchedAt: '2026-10-05T16:10:00Z', temperature: 23, weatherCode: 3, temperatureMin: 19, temperatureMax: 26, precipitationProbability: 65 }

test('首页不展示今日待办卡片，也不请求今日待办接口', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T16:10:00Z') })
  let taskRequests = 0
  await page.route('**/api/tasks/today?**', route => { taskRequests++; return route.fulfill({ json: { date: '2026-10-06', timeZone: 'Asia/Shanghai', fetchedAt: '2026-10-05T16:10:00Z', tasks } }) })
  await page.route('**/api/weather/detail?**', route => route.fulfill({ json: weather }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看今日待办详情' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '今日待办', exact: true })).toHaveCount(0)
  await page.waitForTimeout(250)
  expect(taskRequests).toBe(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 954 })
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(sizes.content).toBeLessThanOrEqual(sizes.viewport)
  }
})

test('天气刷新失败保留最后成功数据，其他卡片仍可用', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T16:10:00Z') })
  let failed = false
  await page.route('**/api/weather/detail?**', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '数据源暂时不可用' } } } : { json: weather }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看今日天气详情' })
  await expect(card).toContainText('23')
  await expect(card).toContainText('65%')
  failed = true
  await page.getByRole('button', { name: '刷新今日天气' }).click()
  await expect(card).toContainText('上次结果')
  await expect(card).toContainText('23')
  await expect(page.getByRole('button', { name: '查看今日待办详情' })).toHaveCount(0)
  await page.getByRole('button', { name: '查看世界时间详情' }).click()
  await expect(page.getByRole('dialog')).toContainText('UTC+8')
})

test('选择城市后天气切换，浏览器刷新保留城市设置', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T16:10:00Z') })
  await page.route('**/api/weather/detail?**', route => route.fulfill({ json: { ...weather, temperature: new URL(route.request().url()).searchParams.get('latitude') === '39.9' ? 18 : 23 } }))
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [{ id: 'beijing', name: '北京', region: '北京市 · 中国', latitude: 39.9, longitude: 116.4, timeZone: 'Asia/Shanghai' }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看今日天气详情' }).click()
  await page.getByRole('combobox', { name: '天气城市' }).fill('北京')
  await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择北京 北京市 · 中国' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toContainText('北京')
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toContainText('18')
  await page.reload()
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toContainText('北京')
})

test('天气按天气城市日期跨日刷新，不受首页地区影响', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T15:59:00Z') })
  let weatherDate = '2026-10-05'; let cityTemperature = 10
  await page.route('**/api/weather/detail?**', route => route.fulfill({ json: { ...weather, date: weatherDate, timeZone: 'America/New_York', temperature: cityTemperature } }))
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [{ id: 'newyork', name: '纽约', region: '纽约州 · 美国', latitude: 40.71, longitude: -74, timeZone: 'America/New_York' }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看今日天气详情' }).click()
  await page.getByRole('combobox', { name: '天气城市' }).fill('纽约')
  await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择纽约 纽约州 · 美国' }).click()
  await page.keyboard.press('Escape')
  const weatherCard = page.getByRole('button', { name: '查看今日天气详情' })
  await expect(weatherCard).toContainText('10°')
  cityTemperature = 18
  await page.clock.fastForward(120000)
  await expect(weatherCard).toContainText('10°')
  weatherDate = '2026-10-06'
  await page.clock.fastForward(11 * 3600000 + 59 * 60000)
  await expect(weatherCard).toContainText('18°')
  await weatherCard.click()
  await expect(page.getByRole('dialog')).toContainText('2026-10-06')
})
