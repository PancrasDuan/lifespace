import { expect, test, type Page } from '@playwright/test'
const shanghai = { id: 'shanghai', name: '上海', region: '上海市 · 中国', latitude: 31.23, longitude: 121.47, timeZone: 'Asia/Shanghai' }
const sampleWeather = { date: '2026-10-06', timeZone: 'Asia/Shanghai', fetchedAt: '2026-10-06T02:00:00Z', currentTime: 1791252000, temperature: 23, weatherCode: 3, temperatureMin: 19, temperatureMax: 26, precipitationProbability: 65, isDay: 1, apparentTemperature: 24, humidity: 70, pressure: 1014, precipitation: 0, windSpeed: 2, windDirection: 90,
  hourly: Array.from({ length: 24 }, (_, index) => ({ time: 1791252000 + index * 3600, temperature: index === 4 ? null : 19 + index % 8, weatherCode: 2, precipitationProbability: 10, isDay: index < 8 ? 1 : 0 })),
  daily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(index + 6).padStart(2, '0')}`, weatherCode: index % 2 ? 61 : 3, temperatureMin: 19 + index, temperatureMax: 26 + index, precipitationProbability: 65, precipitation: index, sunrise: 1791237600 + index * 86400, sunset: 1791280800 + index * 86400 })) }
async function fixture(page: Page) {
  await page.clock.install({ time: new Date('2026-10-06T02:00:00Z') })
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }) })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await page.route('**/api/weather/detail?**', route => route.fulfill({ json: { ...sampleWeather, temperature: new URL(route.request().url()).searchParams.get('latitude') === '31.23' ? 28 : 23 } }))
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [shanghai] } }))
}
test('天气详情切城同步一级卡片并持久化，不修改首页地区', async ({ page }) => {
  await fixture(page); await page.goto('/')
  const card = page.getByRole('button', { name: '查看今日天气详情' })
  await expect(card).toContainText('北京'); await card.click()
  const input = page.getByRole('combobox', { name: '天气城市' })
  await input.fill('上海'); await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择上海 上海市 · 中国' }).click()
  await expect(page.getByRole('dialog')).toContainText('28°')
  await page.keyboard.press('Escape')
  await expect(card).toContainText('上海'); await expect(card).toContainText('28°')
  await expect(page.getByRole('button', { name: '查看世界时间详情' }).locator('.local-clock')).toContainText('北京')
  await page.reload(); await expect(card).toContainText('上海')
  await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [{ ...shanghai, id: 'ny', name: '纽约', region: '美国', latitude: 40.71, longitude: -74, timeZone: 'America/New_York' }] } }))
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByRole('combobox', { name: '地区', exact: true }).fill('纽约'); await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择纽约 美国' }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(card).toContainText('上海')
})


test('详情预报选择与刷新失败保留一致快照，AQI 失败不影响天气', async ({ page }) => {
  await fixture(page); await page.goto('/')
  const card = page.getByRole('button', { name: '查看今日天气详情' })
  await card.click(); const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('region', { name: '未来24小时预报，可横向滚动' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /查看2026-10-.*预报/ })).toHaveCount(7)
  await dialog.getByRole('button', { name: '查看2026-10-07预报' }).click()
  await expect(dialog.locator('.selected-forecast')).toContainText('降水总量 1 mm')
  await expect(dialog).toContainText('空气质量暂时不可用')
  await expect(dialog.getByRole('button', { name: '展开天气窗口' })).toHaveCount(0)
  await page.route('**/api/weather/detail?**', route => route.fulfill({ status: 502, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '天气暂不可用' } } }))
  await dialog.getByRole('button', { name: '刷新天气详情' }).click()
  await expect(dialog).toContainText('更新失败 · 正在显示上次结果')
  await expect(dialog.locator('.weather-now')).toContainText('23°')
  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(card).toContainText('23°'); await expect(card).toContainText('上次结果')
  await expect(card).toBeFocused()
})

test('手机详情横向浏览预报，空气质量明确口径和时间', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page)
  await page.route('**/api/weather/air-quality?**', route => route.fulfill({ json: { timeZone: 'Asia/Shanghai', fetchedAt: '2026-10-06T02:00:00Z', time: 1791252000, usAqi: 130, pm25: 42.5, pm10: null } }))
  await page.goto('/'); await page.getByRole('button', { name: '查看今日天气详情' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('美制 AQI'); await expect(dialog).toContainText('130')
  await expect(dialog).toContainText('对敏感人群不健康')
  await expect(dialog).toContainText('空气质量数据时间 10:00')
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const hourly = dialog.getByRole('region', { name: '未来24小时预报，可横向滚动' })
  expect(await hourly.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await hourly.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await dialog.getByRole('button', { name: '查看2026-10-12预报' }).click()
  await expect(dialog.locator('.selected-forecast')).toContainText('2026-10-12')
  await page.screenshot({ path: '.cache/weather-mobile.png', fullPage: true })
})

test('天气城市保存失败不切城，搜索 Esc 先关闭候选再关闭详情', async ({ page }) => {
  await fixture(page); await page.goto('/'); await page.getByRole('button', { name: '查看今日天气详情' }).click()
  const input = page.getByRole('combobox', { name: '天气城市' })
  await input.fill('上海'); await page.clock.runFor(400)
  await expect(page.getByRole('option', { name: '选择上海 上海市 · 中国' })).toBeVisible()
  await input.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
  await input.fill('上海市'); await page.clock.runFor(400)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError') } })
  await page.getByRole('option', { name: '选择上海 上海市 · 中国' }).click()
  await expect(page.getByRole('dialog')).toContainText('浏览器未允许保存天气城市')
  await expect(page.locator('.weather-place')).toContainText('北京')
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
})

async function locationFixture(page: Page) {
  await fixture(page)
  await page.addInitScript(city => {
    localStorage.setItem('lifespace.settings.v2', JSON.stringify({ mode: 'manual', city: { ...city, name: '首页地区' }, overseas: [] }))
    if (!localStorage.getItem('lifespace.weather-settings.v1')) localStorage.setItem('lifespace.weather-city.v1', JSON.stringify(city))
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success: PositionCallback, error: PositionErrorCallback) => {
      const w = window as unknown as { weatherPositions: { success: PositionCallback; error: PositionErrorCallback }[] }
      ;(w.weatherPositions ??= []).push({ success, error })
    } } })
  }, shanghai)
  await page.route('**/api/weather/detail?**', route => route.fulfill({ json: { ...sampleWeather, timeZone: new URL(route.request().url()).searchParams.get('timeZone') } }))
}
async function weatherPosition(page: Page, attempt = 0) {
  await page.evaluate(attempt => {
    const w = window as unknown as { weatherPositions: { success: PositionCallback }[] }
    w.weatherPositions[attempt].success({ coords: { latitude: 35.68123, longitude: 139.76999 } } as GeolocationPosition)
  }, attempt)
}
test('手动天气城市可切回当前位置，定位独立保存且刷新重新定位', async ({ page }) => {
  await locationFixture(page); await page.goto('/')
  const card = page.getByRole('button', { name: '查看今日天气详情' })
  await expect(card).toContainText('上海'); await card.click()
  const input = page.getByRole('combobox', { name: '天气城市' })
  await input.click()
  await expect(page.getByRole('option', { name: '使用当前位置', exact: true })).toBeVisible()
  await input.press('ArrowDown'); await input.press('Enter')
  await weatherPosition(page)
  await expect(page.locator('.weather-place')).toContainText('当前位置')
  await expect(page.getByRole('dialog')).toContainText('Asia/Tokyo')
  await page.keyboard.press('Escape'); await expect(card).toContainText('当前位置')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toContainText('首页地区')
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).not.toContain('35.68'); expect(stored).not.toContain('139.77')
  await page.reload(); await weatherPosition(page)
  await expect(card).toContainText('当前位置')
  await card.click(); await expect(page.getByRole('button', { name: '展开天气窗口' })).toHaveCount(0)
})

test('天气定位拒绝后可重新定位，手动切换使迟到定位失效', async ({ page }) => {
  await locationFixture(page); await page.goto('/'); await page.getByRole('button', { name: '查看今日天气详情' }).click()
  const input = page.getByRole('combobox', { name: '天气城市' })
  await input.click(); await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await page.evaluate(() => (window as unknown as { weatherPositions: { error: PositionErrorCallback }[] }).weatherPositions[0].error({ code: 1 } as GeolocationPositionError))
  await expect(page.getByRole('dialog')).toContainText('定位授权被拒绝，已使用北京')
  await input.click(); await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await weatherPosition(page, 1)
  await expect(page.locator('.weather-place')).toContainText('当前位置')
  await input.click(); await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await input.fill('上海'); await page.clock.runFor(400)
  await page.getByRole('option', { name: '选择上海 上海市 · 中国' }).click()
  await weatherPosition(page, 2)
  await expect(page.locator('.weather-place')).toContainText('上海')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toContainText('首页地区')
})

test('天气定位八秒超时后迟到成功不会替换回退城市', async ({ page }) => {
  await locationFixture(page); await page.goto('/'); await page.getByRole('button', { name: '查看今日天气详情' }).click()
  await page.getByRole('combobox', { name: '天气城市' }).click()
  await page.getByRole('option', { name: '使用当前位置', exact: true }).click()
  await page.clock.runFor(8000)
  await expect(page.getByRole('dialog')).toContainText('定位超时，已使用北京')
  await weatherPosition(page)
  await expect(page.locator('.weather-place')).toContainText('北京')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '查看今日天气详情' })).toContainText('定位超时，已使用北京')
})
