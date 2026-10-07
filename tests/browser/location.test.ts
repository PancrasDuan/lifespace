import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, time = '2026-10-05T15:59:00Z', unsupported = false) {
  await page.clock.install({ time: new Date(time) })
  await page.addInitScript(unsupported => {
    if (unsupported) { Object.defineProperty(navigator, 'geolocation', { value: undefined }); return }
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success: PositionCallback, error: PositionErrorCallback) => {
      const w = window as unknown as { positions: { success: PositionCallback; error: PositionErrorCallback }[] }
      ;(w.positions ??= []).push({ success, error })
    } } })
  }, unsupported)
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await page.route('**/api/weather?**', route => {
    const zone = new URL(route.request().url()).searchParams.get('timeZone')!
    return route.fulfill({ json: { date: '2026-10-05', timeZone: zone, fetchedAt: '2026-10-05T15:59:00Z', temperature: 23, weatherCode: 3, temperatureMin: 19, temperatureMax: 26, precipitationProbability: 65 } })
  })
}
async function locate(page: Page, latitude = 40.7128, longitude = -74.006, attempt = 0) {
  await page.evaluate(({ latitude, longitude, attempt }) => {
    const w = window as unknown as { positions: { success: PositionCallback }[] }
    w.positions[attempt].success({ coords: { latitude, longitude } } as GeolocationPosition)
  }, { latitude, longitude, attempt })
}
const timeCard = (page: Page) => page.getByRole('button', { name: '查看世界时间详情' })

test('自动定位独立于设备时区，取整坐标并统一核心日期', async ({ page }) => {
  await fixture(page)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()) })
  await page.goto('/')
  await expect(timeCard(page)).toContainText('北京')
  await locate(page)
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
  await expect(timeCard(page).locator('.local-clock')).toContainText('11:59')
  await expect(page.getByRole('button', { name: '查看日期与黄历详情' })).toContainText('八月廿五')
  await expect.poll(() => requests.some(url => url.includes('timeZone=America%2FNew_York'))).toBe(true)
  await expect.poll(() => requests.some(url => url.includes('latitude=40.71') && url.includes('longitude=-74.01'))).toBe(true)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).not.toContain('40.71')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('自动定位')
})

test('授权等待计入八秒上限，超时后迟到坐标不触发查询', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('正在定位')
  await page.clock.runFor(8000)
  await expect(page.getByRole('dialog')).toContainText('定位超时')
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await locate(page)
  await expect(timeCard(page)).toContainText('北京')
  await page.clock.runFor(1000)
  expect(requests.some(url => url.includes('40.71'))).toBe(false)
  await page.getByRole('combobox', { name: '地区', exact: true }).click()
  await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await locate(page, 22.5726, 88.3639, 1)
  await expect(timeCard(page).locator('.local-clock')).toContainText('UTC+5:30')
})

const ny = { id: 'ny', name: '纽约', region: '美国', latitude: 40.71, longitude: -74.01, timeZone: 'America/New_York' }
async function chooseCity(page: Page) {
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [ny] } }))
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByLabel('地区', { exact: true }).fill('纽约')
  await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择纽约 美国' }).click()
}

test('手动地区保存前不生效，保存后忽略迟到定位，刷新保留且不定位', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await chooseCity(page)
  await expect(timeCard(page)).toContainText('北京')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await locate(page, 31.23, 121.47)
  await expect(timeCard(page).locator('.local-clock')).toContainText('纽约')
  await expect(timeCard(page).locator('.local-clock')).toContainText('11:59')
  await page.reload()
  await expect(timeCard(page).locator('.local-clock')).toContainText('纽约')
  expect(await page.evaluate(() => (window as unknown as { positions?: unknown[] }).positions?.length ?? 0)).toBe(0)
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByRole('combobox', { name: '地区', exact: true }).click()
  await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await expect(timeCard(page).locator('.local-clock')).toContainText('纽约')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await locate(page)
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
})

test('旧首页设置只重置一次，新闻设置保留，自动保存不包含坐标', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    if (!localStorage.getItem('lifespace.settings.v2')) {
      localStorage.setItem('lifespace.settings.v1', JSON.stringify({ city: { name: '旧城市' }, overseas: ['Asia/Tokyo'] }))
      localStorage.setItem('lifespace.news-sources.v1', '["zhihu"]')
    }
  })
  await page.goto('/')
  await expect(timeCard(page)).toContainText('伦敦')
  await locate(page)
  const stored = await page.evaluate(() => ({ home: localStorage.getItem('lifespace.settings.v2'), old: localStorage.getItem('lifespace.settings.v1'), news: localStorage.getItem('lifespace.news-sources.v1') }))
  expect(JSON.parse(stored.home!)).toEqual({ mode: 'auto', city: null, overseas: ['America/New_York', 'Europe/London'] })
  expect(stored.old).toBeNull(); expect(stored.news).toBe('["zhihu"]')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByLabel('东京', { exact: true }).check()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.reload()
  await expect(timeCard(page)).toContainText('另有 1 个时区')
  expect(await page.evaluate(() => localStorage.getItem('lifespace.news-sources.v1'))).toBe('["zhihu"]')
})

test('有效地区午夜同步更新核心内容，更新时间仍使用设备时区，天气失败不改地区', async ({ page }) => {
  await fixture(page, '2026-10-06T03:59:00Z')
  let day = '2026-10-05'; let failed = false
  await page.route('**/api/tasks/today?**', route => route.fulfill({ json: { date: day, timeZone: new URL(route.request().url()).searchParams.get('timeZone'), fetchedAt: '2026-10-06T03:59:00Z', tasks: [{ id: '1', title: `当天任务 ${day}`, plannedAt: 1791259140, dueAt: null, area: '学习' }] } }))
  await page.route('**/api/weather?**', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '天气来源不可用' } } } : { json: { date: day, timeZone: new URL(route.request().url()).searchParams.get('timeZone'), fetchedAt: '2026-10-06T03:59:00Z', temperature: 23, weatherCode: 3, temperatureMin: 19, temperatureMax: 26, precipitationProbability: 65 } }))
  await page.goto('/')
  await locate(page)
  await expect(timeCard(page).locator('.local-clock')).toContainText('23:59')
  const calendar = page.getByRole('button', { name: '查看日期与黄历详情' })
  await expect(calendar).toContainText('八月廿五')
  await calendar.click()
  day = '2026-10-06'
  await page.clock.runFor(120000)
  await expect(page.getByRole('dialog')).toContainText('八月廿六')
  await page.keyboard.press('Escape')
  await expect(calendar).toContainText('八月廿六')
  await expect(page.getByRole('button', { name: '查看今日待办详情' })).toContainText('当天任务 2026-10-06')
  await page.getByRole('button', { name: '查看今日天气详情' }).click()
  await expect(page.getByRole('dialog')).toContainText('2026-10-06')
  await page.keyboard.press('Escape')
  await expect(page.locator('.panel-footer').filter({ hasText: 'Open-Meteo' })).toContainText('11:59')
  failed = true
  await page.getByRole('button', { name: '刷新今日天气' }).click()
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toContainText('上次结果')
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
})

for (const scenario of ['denied', 'invalid', 'unavailable', 'unsupported'] as const) {
  test(`定位失败回退北京：${scenario}`, async ({ page }) => {
    await fixture(page, '2026-10-05T15:59:00Z', scenario === 'unsupported')
    await page.goto('/')
    if (scenario === 'invalid') await locate(page, 91, 0)
    else if (scenario !== 'unsupported') await page.evaluate(code => {
      (window as unknown as { positions: { error: PositionErrorCallback }[] }).positions[0].error({ code } as GeolocationPositionError)
    }, scenario === 'denied' ? 1 : 2)
    await page.getByRole('button', { name: '首页设置', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('已使用北京')
    await expect(timeCard(page).locator('.local-clock')).toContainText('北京')
  })
}

test('保存失败保留已生效地区，关闭草稿不应用', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await locate(page)
  await chooseCity(page)
  await page.keyboard.press('Escape')
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
  await chooseCity(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError') } })
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('浏览器未允许保存设置')
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
})

for (const broken of ['denied', 'corrupt'] as const) {
  test(`首页存储不可用仍可定位：${broken}`, async ({ page }) => {
    await fixture(page)
    await page.addInitScript(broken => {
      if (broken === 'denied') { Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError') } }
      else localStorage.setItem('lifespace.settings.v2', '{invalid')
    }, broken)
    await page.goto('/')
    await locate(page)
    await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
  })
}

test('重新定位替换旧尝试，聚焦和卡片刷新不增加定位请求', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByRole('combobox', { name: '地区', exact: true }).click()
  await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await locate(page, 31.23, 121.47, 0)
  await expect(timeCard(page).locator('.local-clock')).toContainText('北京')
  await locate(page, 40.7128, -74.006, 1)
  await page.evaluate(() => (window as unknown as { positions: { error: PositionErrorCallback }[] }).positions[0].error({ code: 1 } as GeolocationPositionError))
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('button', { name: '刷新今日天气' }).click()
  await page.clock.runFor(1000)
  expect(await page.evaluate(() => (window as unknown as { positions: unknown[] }).positions.length)).toBe(2)
})

test('自动地区时区正确处理夏令时跳时', async ({ page }) => {
  await fixture(page, '2026-03-08T06:59:00Z')
  await page.goto('/')
  await locate(page)
  await expect(timeCard(page).locator('.local-clock')).toContainText('01:59')
  await expect(timeCard(page).locator('.local-clock')).toContainText('UTC-5')
  await page.clock.runFor(120000)
  await expect(timeCard(page).locator('.local-clock')).toContainText('03:01')
  await expect(timeCard(page).locator('.local-clock')).toContainText('UTC-4')
})

test('从手动切回自动等待期间仅采用北京，不复用上次自动位置', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await locate(page, 35.68, 139.69)
  await expect(timeCard(page).locator('.local-clock')).toContainText('当前位置')
  await chooseCity(page)
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByRole('combobox', { name: '地区', exact: true }).click()
  await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await page.clock.fastForward(301000)
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(timeCard(page).locator('.local-clock')).toContainText('北京')
  await page.clock.runFor(1000)
  expect(requests.some(url => url.includes('latitude=35.68'))).toBe(false)
})

test('地区搜索使用下拉列表且不挤动设置内容，键盘选择后保存', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [ny] } }))
  await page.goto('/')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  const input = dialog.getByRole('combobox', { name: '地区', exact: true })
  const before = await dialog.locator('.zone-options').boundingBox()
  await input.fill('纽约')
  await page.clock.runFor(400)
  await expect(dialog.getByRole('listbox')).toBeVisible()
  await expect(dialog.getByRole('option', { name: '选择纽约 美国' })).toBeVisible()
  const after = await dialog.locator('.zone-options').boundingBox()
  expect(after!.y).toBe(before!.y)
  await page.screenshot({ path: '.cache/location-dropdown.png' })
  await input.press('ArrowDown')
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(dialog.getByRole('listbox')).toHaveCount(0)
  await expect(timeCard(page).locator('.local-clock')).toContainText('北京')
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(timeCard(page).locator('.local-clock')).toContainText('纽约')
})

test('长候选列表键盘导航保持当前选项可见', async ({ page }) => {
  await fixture(page)
  const cities = Array.from({ length: 10 }, (_, index) => ({ ...ny, id: `city-${index}`, name: `城市${index + 1}` }))
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: cities } }))
  await page.goto('/')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  const input = page.getByRole('combobox', { name: '地区', exact: true })
  await input.fill('城市')
  await page.clock.runFor(400)
  await expect(page.getByRole('option', { name: '选择城市10 美国' })).toBeVisible()
  for (let index = 0; index < 11; index++) await input.press('ArrowDown')
  const selected = page.getByRole('option', { name: '选择城市10 美国' })
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  const item = await selected.boundingBox()
  const menu = await page.locator('.city-results').boundingBox()
  expect(item!.y).toBeGreaterThanOrEqual(menu!.y)
  expect(item!.y + item!.height).toBeLessThanOrEqual(menu!.y + menu!.height)
})
