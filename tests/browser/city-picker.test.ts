import type { Route } from '@playwright/test'
import { expect, test, type Page } from './authenticated-test'

const shanghai = { id: 'shanghai', name: '上海', region: '中国', latitude: 31.23, longitude: 121.47, timeZone: 'Asia/Shanghai' }
const newYork = { id: 'new-york', name: '纽约', region: '美国', latitude: 40.71, longitude: -74.01, timeZone: 'America/New_York' }
const entries = [
  { label: '地区', opener: '首页设置', weather: false },
  { label: '天气城市', opener: '查看今日天气详情', weather: true },
]

async function openPicker(page: Page, opener: string) {
  await page.clock.install({ time: new Date('2026-10-06T02:00:00Z') })
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }) })
  await page.goto('/')
  await page.getByRole('button', { name: opener, exact: true }).click()
}

for (const entry of entries) {
  test(`${entry.label}搜索去抖，改词和短输入立即屏蔽旧候选`, async ({ page }) => {
    const queries: string[] = []
    await page.route('**/api/weather/locations?**', route => {
      const query = new URL(route.request().url()).searchParams.get('q')!
      queries.push(query)
      return route.fulfill({ json: { locations: [query === '上海' ? shanghai : newYork] } })
    })
    await openPicker(page, entry.opener)
    await page.clock.pauseAt(new Date('2026-10-06T02:01:00Z'))
    const input = page.getByRole('combobox', { name: entry.label, exact: true })
    await input.fill('上')
    await page.clock.runFor(400)
    expect(queries).toEqual([])
    await expect(page.getByRole('option', { name: '使用当前位置', exact: true })).toBeVisible()
    if (entry.weather) await expect(page.getByText('输入至少两个字符搜索城市')).toBeVisible()
    else await expect(page.getByRole('option', { name: '使用当前位置', exact: true })).toContainText('保存后重新获取位置')

    await input.fill('上海')
    await page.clock.runFor(299)
    expect(queries).toEqual([])
    await page.clock.runFor(1)
    await page.clock.resume()
    await expect(page.getByRole('option', { name: '选择上海 中国' })).toBeVisible()
    await page.clock.pauseAt(new Date('2026-10-06T02:02:00Z'))
    await input.fill('上杭')
    await expect(page.getByRole('option', { name: '选择上海 中国' })).toHaveCount(0)
    await page.clock.runFor(150)
    await input.fill('纽约')
    await page.clock.runFor(299)
    expect(queries).toEqual(['上海'])
    await page.clock.runFor(1)
    await page.clock.resume()
    await expect(page.getByRole('option', { name: '选择纽约 美国' })).toBeVisible()
    expect(queries).toEqual(['上海', '纽约'])
    await input.fill('纽')
    await expect(page.getByRole('option', { name: '选择纽约 美国' })).toHaveCount(0)
    await page.clock.runFor(400)
    expect(queries).toEqual(['上海', '纽约'])
  })

  test(`${entry.label}键盘与 aria 关联、失焦关闭和选中后焦点在手机端保持一致`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/weather/locations?**', route => route.fulfill({ json: { locations: [newYork] } }))
    await openPicker(page, entry.opener)
    const input = page.getByRole('combobox', { name: entry.label, exact: true })
    const dialog = page.getByRole('dialog')
    await input.fill('纽约')
    await page.clock.runFor(300)
    const city = page.getByRole('option', { name: '选择纽约 美国' })
    await expect(city).toBeVisible()
    await expect(page.getByRole('listbox')).toHaveAttribute('id', (await input.getAttribute('aria-controls'))!)
    await expect(input).toHaveAttribute('aria-expanded', 'true')
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await expect(city).toHaveAttribute('aria-selected', 'true')
    await expect(input).toHaveAttribute('aria-activedescendant', (await city.getAttribute('id'))!)
    await input.press('ArrowUp')
    await expect(page.getByRole('option', { name: '使用当前位置', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    await expect(input).not.toHaveAttribute('aria-activedescendant')
    await expect(dialog).toBeVisible()

    await input.click()
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).focus()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await input.click()
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    await expect(input).toBeFocused()
    if (entry.weather) await expect(page.locator('.weather-place')).toContainText('纽约')
    else {
      await expect(dialog.locator('.selected-city')).toContainText('纽约')
      await expect(page.getByRole('button', { name: '查看世界时间详情' }).locator('.local-clock')).toContainText('北京')
    }
  })

  test(`${entry.label}忽略改词前的迟到结果，并展示无结果与搜索错误`, async ({ page }) => {
    let pending: Route | undefined
    await page.route('**/api/weather/locations?**', route => {
      const query = new URL(route.request().url()).searchParams.get('q')
      if (query === '上海') { pending = route; return }
      if (query === '失败') return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '城市搜索暂不可用' } } })
      return route.fulfill({ json: { locations: query === '纽约' ? [newYork] : [] } })
    })
    await openPicker(page, entry.opener)
    const input = page.getByRole('combobox', { name: entry.label, exact: true })
    await input.fill('上海')
    await page.clock.runFor(300)
    await expect.poll(() => Boolean(pending)).toBe(true)
    await expect(page.getByText('正在搜索城市…', { exact: true })).toBeVisible()
    await input.fill('纽约')
    await pending!.fulfill({ json: { locations: [shanghai] } })
    await expect(page.getByRole('option', { name: '选择上海 中国' })).toHaveCount(0)
    await page.clock.runFor(300)
    await expect(page.getByRole('option', { name: '选择纽约 美国' })).toBeVisible()
    await input.fill('无果')
    await page.clock.runFor(300)
    await expect(page.getByText('没有匹配城市，请换个名称搜索')).toBeVisible()
    await input.fill('失败')
    await page.clock.runFor(300)
    await expect(page.getByText('城市搜索暂不可用', { exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: '使用当前位置', exact: true })).toBeVisible()
  })
}
