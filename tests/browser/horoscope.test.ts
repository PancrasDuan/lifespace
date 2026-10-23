import { test, expect } from './authenticated-test'

test('首页只有十二星座入口，点击后显示未配置状态且不影响其他卡片', async ({ page }) => {
  let requests = 0
  await page.route('**/api/horoscope?*', route => { requests++; return route.fulfill({ status: 503, json: { error: { code: 'HOROSCOPE_NOT_CONFIGURED', message: '服务尚未配置' } } }) })
  await page.goto('/')
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '星座运势' }) })
  await expect(card.getByRole('button')).toHaveCount(12)
  expect(requests).toBe(0)
  await card.getByRole('button', { name: '天秤座', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '天秤座 · 今日运势' })).toBeVisible()
  await expect(page.getByText('服务尚未配置', { exact: true })).toBeVisible()
  expect(requests).toBe(1)
  await page.keyboard.press('Escape')
  await expect(card.getByRole('button', { name: '天秤座', exact: true })).toBeFocused()
})

test('星座运势卡片位于 DNSHE 卡片上方，详情不展示娱乐参考', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') })
  await page.route('**/api/horoscope?*', route => route.fulfill({ json: result() }))
  await page.goto('/')
  const headings = await page.locator('.glass-grid .panel-heading h2').allTextContents()
  expect(headings.indexOf('星座运势')).toBe(headings.indexOf('DNSHE 域名') - 1)
  await page.getByRole('button', { name: '天秤座', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '天秤座 · 今日运势' })
  await expect(dialog.getByRole('button', { name: '查看详情', exact: true })).toBeVisible()
  await expect(dialog.getByText(/娱乐参考/)).toHaveCount(0)
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '返回', exact: true })).toBeVisible()
  await expect(dialog.getByText(/娱乐参考/)).toHaveCount(0)
})

import { startHoroscopeWorker, horoscopeTestToken } from '../fixtures/horoscope-worker'
import { alapiDay } from '../fixtures/horoscope'

function result(sign = 'libra', date = '2026-10-22', long = false) {
  const day = alapiDay(date)
  return { version: 1, source: 'ALAPI', sign, dataDate: date, fetchedAt: new Date(`${date}T00:00:00+08:00`).toISOString(), validUntil: `${date}T16:00:00.000Z`, cacheHit: false,
    scores: { all: 85, love: 87, work: 88, money: 70, health: 71 },
    texts: { all: '<script>纯文本</script>', love: day.love_text, work: day.work_text, money: day.money_text, health: long ? '长文内容。'.repeat(200) + '全文结束' : day.health_text },
    lucky: { color: day.lucky_color, number: day.lucky_number, sign: day.lucky_star }, notice: day.notice, yi: day.yi, ji: day.ji }
}

test('浏览器经真实 Worker HTTP 与鉴权读取受控 ALAPI/KV，翻转零新增请求，重载后命中缓存', async ({ page }) => {
  const worker = await startHoroscopeWorker({ longText: true })
  try {
    await page.addInitScript(token => {
      const session = JSON.parse(localStorage.getItem('sb-auth-test-auth-token')!)
      session.access_token = token
      localStorage.setItem('sb-auth-test-auth-token', JSON.stringify(session))
    }, horoscopeTestToken)
    await page.route('**/api/horoscope?*', async route => {
      const response = await route.fetch({ url: worker.url + new URL(route.request().url()).pathname + new URL(route.request().url()).search })
      await route.fulfill({ response })
    })
    await page.goto('/')
    expect(worker.calls.api).toBe(0)
    await page.getByRole('button', { name: '天秤座', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('85', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '查看详情', exact: true }).click()
    await expect(dialog.getByText('认真倾听身边的人。')).toBeVisible()
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
    expect(worker.calls).toEqual({ alapi: 1, kvReads: 1, kvWrites: 1, api: 1, auth: 1 })
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.reload()
    await page.getByRole('button', { name: '天秤座', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeVisible()
    expect(worker.calls).toEqual({ alapi: 1, kvReads: 2, kvWrites: 1, api: 2, auth: 1 })
    expect(worker.entries.size).toBe(1)
  } finally { await worker.close() }
})

test('手机长文可滚动到底，正反面隔离焦点，减少动态效果仍能返回', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') })
  await page.setViewportSize({ width: 390, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let requests = 0
  await page.route('**/api/horoscope?*', route => { requests++; return route.fulfill({ json: result('libra', '2026-10-22', true) }) })
  await page.goto('/')
  await page.getByRole('button', { name: '天秤座', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  const reading = page.getByLabel('运势文字解读')
  await expect(reading.getByText('<script>纯文本</script>')).toBeVisible()
  await reading.evaluate(node => { node.scrollTop = node.scrollHeight })
  await expect(reading.getByText('宜', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toHaveCount(0)
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(width[0]).toBeLessThanOrEqual(width[1])
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0)
  expect(requests).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '天秤座', exact: true })).toBeFocused()
})

test('北京零点后已打开背面不展示旧内容，未更新可重新读取', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T15:59:50Z') })
  let requests = 0
  await page.route('**/api/horoscope?*', route => {
    requests++
    if (requests === 2) return route.fulfill({ status: 503, json: { error: { code: 'HOROSCOPE_NOT_UPDATED', message: '今日运势暂未更新' } } })
    return route.fulfill({ json: result('libra', requests > 2 ? '2026-10-23' : '2026-10-22') })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '天秤座', exact: true }).click()
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.clock.fastForward(11000)
  await expect(page.getByText('今日运势暂未更新', { exact: true })).toBeVisible()
  await expect(page.getByText('认真倾听身边的人。')).toHaveCount(0)
  await page.clock.fastForward(8 * 3600 * 1000)
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('2026-10-23')
  expect(requests).toBe(3)
})

test('关闭后新星座从正面开始，迟到响应不会覆盖当前选择', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') })
  let release: (() => void) | undefined
  await page.route('**/api/horoscope?*', async route => {
    const sign = new URL(route.request().url()).searchParams.get('sign')!
    if (sign === 'libra') await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: result(sign) }).catch(() => {})
  })
  await page.goto('/')
  await page.getByRole('button', { name: '天秤座', exact: true }).click()
  await expect(page.getByText('正在读取今日运势…')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '狮子座', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeVisible()
  release?.()
  await expect(page.getByRole('dialog', { name: '狮子座 · 今日运势' })).toBeVisible()
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '狮子座', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeVisible()
})

test('横屏短手机窗口的关闭与返回按钮完整可达', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') })
  await page.setViewportSize({ width: 667, height: 320 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/horoscope?*', route => route.fulfill({ json: result('libra', '2026-10-22', true) }))
  await page.goto('/')
  await page.getByRole('button', { name: '天秤座', exact: true }).click()
  const frontBounds = await page.getByRole('button', { name: '查看详情', exact: true }).boundingBox()
  const beforeBounds = await page.getByRole('dialog').boundingBox()
  expect(frontBounds!.y + frontBounds!.height).toBeLessThanOrEqual(beforeBounds!.y + beforeBounds!.height)
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  const dialog = await page.getByRole('dialog').boundingBox()
  const back = await page.getByRole('button', { name: '返回', exact: true }).boundingBox()
  expect(back!.y + back!.height).toBeLessThanOrEqual(dialog!.y + dialog!.height)
  await expect(page.getByRole('button', { name: '关闭详情', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toBeInViewport()
})
