import { expect, test, type Page } from './authenticated-test'
import { newsSources } from '../../src/shared/news-sources'

const key = 'lifespace.news-order.v1'
const defaultLabels = ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']
const headings = (page: Page) => page.locator('.news-grid .news-card h2')
const stored = (page: Page) => page.evaluate(storageKey => localStorage.getItem(storageKey), key)

async function fixture(page: Page) {
  const reads: string[] = []
  await page.route('**/api/news/sources', route => route.fulfill({ json: { sources: newsSources } }))
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    reads.push(id)
    return route.fulfill({ json: { sourceId: id, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, upstreamStatus: 'success',
      cacheHit: false, stale: false, warning: null,
      items: Array.from({ length: 25 }, (_, i) => ({ id: String(i), rank: i + 1, title: `来源标题-${id}-${i}`, url: `https://example.test/${id}/${i}` })),
    } })
  })
  return reads
}

async function move(page: Page, from: string, to: string, release = true) {
  const handle = page.getByRole('button', { name: '拖动' + from, exact: true })
  await handle.scrollIntoViewIfNeeded()
  const a = (await handle.boundingBox())!
  const b = (await page.getByRole('button', { name: '拖动' + to, exact: true }).boundingBox())!
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 }
  const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 8, start.y, { steps: 2 })
  await expect(page.locator('.news-drag-overlay')).toBeVisible()
  await page.mouse.move(end.x, end.y, { steps: 18 })
  if (release) {
    await page.mouse.up()
    await expect(page.locator('.news-drag-overlay')).toHaveCount(0)
    // dnd-kit 在放下后的 50ms 内拦截合成 click；等真实下一次操作的间隔。
    await page.waitForTimeout(60)
  }
}

test('鼠标跨行实时预览，松手才保存，刷新和重开保留且不额外取数', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  await move(page, '百度热搜', '知乎', false)
  await expect(headings(page)).toHaveText(['财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '百度热搜'])
  expect(await stored(page)).toBeNull()
  await page.mouse.up()
  await expect(page.locator('.news-drag-overlay')).toHaveCount(0)
  expect(JSON.parse((await stored(page))!)).toEqual(expect.arrayContaining(newsSources.map(source => source.id)))
  expect(reads).toHaveLength(5)
  await expect(page.getByText('顺序已保存在当前浏览器', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(headings(page)).toHaveText(['财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '百度热搜'])
  const reopened = await context.newPage()
  await fixture(reopened)
  await reopened.goto('/news')
  await expect(headings(reopened)).toHaveText(['财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '百度热搜'])
  await reopened.close()
})

test('Escape 取消预览不改顺序或存储，正文和刷新按钮不触发拖动', async ({ page }) => {
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(headings(page)).toHaveText(defaultLabels)
  await move(page, '百度热搜', '财联社热门', false)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(headings(page)).toHaveText(defaultLabels)
  expect(await stored(page)).toBeNull()
  await page.getByRole('button', { name: '刷新百度热搜', exact: true }).click()
  await expect.poll(() => reads.filter(id => id === 'baidu').length).toBe(2)
  const list = page.locator('.news-grid .news-list').first()
  await list.hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.news-drag-overlay')).toHaveCount(0)
  expect(await stored(page)).toBeNull()
})

test('排序配置与来源开关独立，关闭后重新开启回原位，新增来源追加', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('lifespace.news-sources.v1', '["baidu","cls-hot","zhihu"]')
    localStorage.setItem('lifespace.news-order.v1', '["zhihu","cls-hot","baidu"]')
  })
  await page.goto('/news')
  await expect(headings(page)).toHaveText(['知乎', '财联社热门', '百度热搜'])
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '财联社热门', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await move(page, '知乎', '百度热搜')
  await expect(headings(page)).toHaveText(['百度热搜', '知乎'])
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '财联社热门', exact: true }).check()
  await page.getByRole('switch', { name: '哔哩哔哩热搜', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(headings(page)).toHaveText(['百度热搜', '财联社热门', '知乎', '哔哩哔哩热搜'])
})

test('恢复默认顺序须二次确认，取消保留原顺序，确认不改来源开关', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('lifespace.news-sources.v1', '["baidu","zhihu"]')
    localStorage.setItem('lifespace.news-order.v1', '["zhihu","baidu"]')
  })
  await page.goto('/news')
  await expect(headings(page)).toHaveText(['知乎', '百度热搜'])
  const originalSelection = await page.evaluate(() => localStorage.getItem('lifespace.news-sources.v1'))
  const originalOrder = await stored(page)
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('button', { name: '恢复默认顺序', exact: true }).click()
  expect(await stored(page)).toBe(originalOrder)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await stored(page)).toBe(originalOrder)
  await page.getByRole('button', { name: '恢复默认顺序', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复默认顺序', exact: true })).toBeFocused()
  expect(await page.evaluate(() => localStorage.getItem('lifespace.news-sources.v1'))).toBe(originalSelection)
  await page.keyboard.press('Escape')
  await expect(headings(page)).toHaveText(['百度热搜', '知乎'])
  expect(JSON.parse((await stored(page))!)).toEqual(newsSources.map(source => source.id))
})

test('排序保存失败时保留本页排序并提示，后续保存成功清除提示', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'lifespace.news-order.v1' && !localStorage.getItem('allow-order-save')) throw new DOMException('denied', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  })
  await page.goto('/news')
  await move(page, '百度热搜', '财联社热门')
  await expect(headings(page)).toHaveText(['财联社热门', '百度热搜', '腾讯新闻综合早报', '今日头条', '知乎'])
  await expect(page.getByRole('alert')).toHaveText('卡片顺序未保存，仅在当前页面生效。')
  expect(await stored(page)).toBeNull()
  await page.evaluate(() => localStorage.setItem('allow-order-save', '1'))
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('button', { name: '恢复默认顺序', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(headings(page)).toHaveText(defaultLabels)
})

for (const [name, value, labels] of [
  ['损坏 JSON', '{bad', defaultLabels],
  ['错误结构', '{}', defaultLabels],
  ['混合类型', '["zhihu",3]', defaultLabels],
  ['未知与重复来源', '["retired","zhihu","baidu","zhihu"]', ['知乎', '百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条']],
] as const) test('排序配置：' + name, async ({ page }) => {
  await fixture(page)
  await page.addInitScript(value => localStorage.setItem('lifespace.news-order.v1', value), value)
  await page.goto('/news')
  await expect(headings(page)).toHaveText([...labels])
})

test('浏览器拒绝读取顺序配置时默认展示，不影响来源选择', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (key) {
      if (key === 'lifespace.news-order.v1') throw new DOMException('denied', 'SecurityError')
      return getItem.call(this, key)
    }
  })
  await page.goto('/news')
  await expect(headings(page)).toHaveText(defaultLabels)
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '百度热搜', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(headings(page)).toHaveText(defaultLabels.slice(1))
})

test.describe('手机触控排序', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('手柄拖动并保存，单列无横向溢出', async ({ page, context }) => {
    await fixture(page)
    await page.goto('/news')
    await expect(headings(page)).toHaveText(defaultLabels)
    const first = (await page.getByRole('button', { name: '拖动百度热搜', exact: true }).boundingBox())!
    const second = (await page.getByRole('button', { name: '拖动财联社热门', exact: true }).boundingBox())!
    const x = first.x + first.width / 2
    const y = first.y + first.height / 2
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await page.waitForTimeout(240)
    await expect(page.locator('.news-drag-overlay')).toBeVisible()
    const targetY = Math.min(second.y + second.height / 2, 800)
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (targetY - y) * step / 12 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.locator('.news-drag-overlay')).toHaveCount(0)
    await expect(headings(page)).toHaveText(['财联社热门', '百度热搜', '腾讯新闻综合早报', '今日头条', '知乎'])
    expect(JSON.parse((await stored(page))!)[0]).toBe('cls-hot')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: '.cache/news-order-mobile.png' })
  })
})
