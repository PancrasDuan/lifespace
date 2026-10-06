import { expect, test, type Page } from '@playwright/test'
import { newsSources } from '../../src/shared/news-sources'

const result = (id: string) => ({
  sourceId: id, fetchedAt: '2026-10-06T08:00:00.000Z', sourceUpdatedAt: null,
  upstreamStatus: 'success', cacheHit: false, stale: false, warning: null,
  items: [{ id: '1', title: '来源标题-' + id, url: 'https://example.test/' + id, rank: 1 }],
})

async function fixture(page: Page) {
  await page.clock.install({ time: new Date('2026-10-06T08:00:00Z') })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await page.route('**/api/news/sources', route => route.fulfill({ json: { sources: newsSources } }))
  const reads: string[] = []
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    reads.push(id)
    return route.fulfill({ json: result(id) })
  })
  return reads
}

test('新闻设置默认隐藏，27 个独立开关默认仅启用五源，即时控制对应卡片', async ({ page }) => {
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '新闻来源设置', exact: true })
  await expect(settings.getByRole('switch')).toHaveCount(27)
  for (const name of ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']) await expect(settings.getByRole('switch', { name, exact: true })).toBeChecked()
  await expect(settings.getByRole('switch', { name: '哔哩哔哩热搜', exact: true })).not.toBeChecked()
  await settings.getByRole('switch', { name: '哔哩哔哩热搜', exact: true }).check()
  await settings.getByRole('switch', { name: '百度热搜', exact: true }).uncheck()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(['财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '哔哩哔哩热搜'])
  await expect(page.getByRole('link', { name: '来源标题-bilibili-hot-search' })).toBeVisible()
  expect(reads.filter(id => id === 'bilibili-hot-search')).toHaveLength(1)
})

test('来源选择在刷新、首页往返和关闭重开后保留，首页城市与时区配置不变', async ({ page, context }) => {
  await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '首页设置', exact: true }).click()
  await page.getByLabel('东京', { exact: true }).check()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  const originalHome = await page.evaluate(() => localStorage.getItem('lifespace.settings.v1'))
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '哔哩哔哩热搜', exact: true }).check()
  await page.getByRole('switch', { name: '百度热搜', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await page.reload()
  const expected = ['财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '哔哩哔哩热搜']
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(expected)
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('button', { name: '查看世界时间详情', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('东京')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => localStorage.getItem('lifespace.settings.v1'))).toBe(originalHome)
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(expected)
  const reopened = await context.newPage()
  await fixture(reopened)
  await page.close()
  await reopened.goto('/news')
  await expect(reopened.getByRole('article').getByRole('heading')).toHaveText(expected)
})

test('明确关闭全部来源后显示恢复入口，空选择刷新后仍保持为空且不取数', async ({ page }) => {
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  for (const name of ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']) await page.getByRole('switch', { name, exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByText('未启用来源', { exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新全部新闻', exact: true })).toBeDisabled()
  reads.length = 0
  await page.reload()
  await expect(page.getByText('未启用来源', { exact: true })).toBeVisible()
  expect(reads).toEqual([])
  await page.getByRole('button', { name: '打开新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '百度热搜', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: '来源标题-baidu' })).toBeVisible()
  expect(reads).toEqual(['baidu'])
})

test('浏览器拒绝保存时当前选择仍即时生效，并明确提示未保存', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('storage denied', 'QuotaExceededError') }
  })
  await page.goto('/news')
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '百度热搜', exact: true }).uncheck()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('未保存')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('article')).toHaveCount(4)
  await expect(page.getByRole('alert')).toContainText('未保存')
})

test('电脑和手机设置可用键盘操作，关闭后恢复入口焦点与阅读位置', async ({ page }) => {
  await fixture(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/news')
    await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
    await page.mouse.wheel(0, 650)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const before = await page.evaluate(() => window.scrollY)
    const entry = page.getByRole('button', { name: '打开设置', exact: true })
    await entry.click()
    const dialog = page.getByRole('dialog', { name: '新闻来源设置', exact: true })
    await expect(dialog).toBeVisible()
    const size = await dialog.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }))
    expect(size.content).toBeLessThanOrEqual(size.width)
    const switcher = dialog.getByRole('switch', { name: '百度热搜', exact: true })
    await switcher.focus()
    await page.keyboard.press('Space')
    await expect(switcher).not.toBeChecked()
    await page.keyboard.press('Space')
    await expect(switcher).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(entry).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await entry.click()
    await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(entry).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
  }
})

for (const [name, stored, expected] of [
  ['损坏 JSON', '{broken', ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']],
  ['错误结构', '{"enabled":["baidu"]}', ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']],
  ['混合类型', '["baidu",42]', ['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎']],
  ['忽略已移除来源和重复项', '["retired","zhihu","baidu","zhihu"]', ['百度热搜', '知乎']],
] as const) test('读取来源配置：' + name, async ({ page }) => {
  const reads = await fixture(page)
  await page.addInitScript(value => localStorage.setItem('lifespace.news-sources.v1', value), stored)
  await page.goto('/news')
  await expect(page.getByRole('article').getByRole('heading')).toHaveText([...expected])
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  expect(reads.length).toBe(expected.length)
})

test('浏览器拒绝读取存储时使用默认五源，仍能打开设置应用选择', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError') } })
  await page.goto('/news')
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎'])
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  await page.getByRole('switch', { name: '哔哩哔哩热搜', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('article')).toHaveCount(6)
})

test('关闭排队与正在读取的来源后停止取数，晚到响应不重新显示，全部刷新仅作用于启用来源', async ({ page }) => {
  await fixture(page)
  const reads: string[] = []
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const cancelled: string[] = []
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/news/source') cancelled.push(url.searchParams.get('id')!)
  })
  await page.route('**/api/news/source?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    reads.push(id)
    await held
    await route.fulfill({ json: result(id) }).catch(() => {})
  })
  await page.goto('/news')
  await expect.poll(() => reads.length).toBe(3)
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  for (const name of ['今日头条', '知乎', '百度热搜']) await page.getByRole('switch', { name, exact: true }).uncheck()
  await page.keyboard.press('Escape')
  release()
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(['财联社热门', '腾讯新闻综合早报'])
  await expect(page.getByRole('link', { name: '来源标题-tencent-hot' })).toBeVisible()
  await expect.poll(() => cancelled.includes('baidu')).toBe(true)
  expect(reads).toEqual(['baidu', 'cls-hot', 'tencent-hot'])
  await page.getByRole('button', { name: '刷新全部新闻', exact: true }).click()
  await expect.poll(() => reads.length).toBe(5)
  expect(reads.slice(3)).toEqual(['cls-hot', 'tencent-hot'])
  await expect(page.getByRole('article', { name: '百度热搜', exact: true })).toHaveCount(0)
})

test('全部 27 源逐个启用后保持固定顺序，加载与全部刷新均最多三个并发', async ({ page }) => {
  test.setTimeout(30000)
  const reads = await fixture(page)
  let hold = false
  const waiting: Array<() => void> = []
  await page.route('**/api/news/source?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    reads.push(id)
    if (hold) await new Promise<void>(resolve => waiting.push(resolve))
    await route.fulfill({ json: result(id) })
  })
  async function finish(target: number) {
    while (reads.length < target) {
      expect(waiting.length).toBeLessThanOrEqual(3)
      const previous = reads.length
      const next = Math.min(target, previous + 3)
      waiting.splice(0).forEach(resolve => resolve())
      await expect.poll(() => reads.length).toBe(next)
      await expect.poll(() => waiting.length).toBe(next - previous)
    }
    expect(waiting.length).toBeLessThanOrEqual(3)
    waiting.splice(0).forEach(resolve => resolve())
    await expect(page.getByRole('button', { name: '刷新全部新闻', exact: true })).toBeEnabled()
  }
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
  hold = true
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  for (const switcher of await page.getByRole('switch').all()) await switcher.check()
  await expect.poll(() => waiting.length).toBe(3)
  expect(reads.length).toBe(8)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('article')).toHaveCount(27)
  await expect(page.getByRole('article').getByRole('heading')).toHaveText([
    '百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎', '哔哩哔哩热搜', '虫部落最热',
    '酷安今日最热', '豆瓣热门电影', '抖音', 'Freebuf 网络安全', 'GitHub Today', 'Hacker News',
    '虎扑主干道热帖', '凤凰网热点资讯', '爱奇艺热播榜', '稀土掘金', '牛客', 'Product Hunt',
    '腾讯视频热搜榜', '少数派', 'Steam 在线人数', '澎湃新闻热榜', '百度贴吧热议',
    '华尔街见闻最热', '微博实时热搜', '雪球热门股票',
  ])
  await finish(27)
  expect(new Set(reads).size).toBe(27)
  expect(await page.locator('.news-card .news-source-icon').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.getByRole('button', { name: '刷新全部新闻', exact: true }).click()
  await expect.poll(() => waiting.length).toBe(3)
  expect(reads.length).toBe(30)
  await finish(54)
  for (const id of new Set(reads)) expect(reads.filter(value => value === id)).toHaveLength(2)
})

test('新闻过新鲜期后网络恢复不自动取数，只在手动刷新时读取启用来源', async ({ page, context }) => {
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
  await page.clock.fastForward(600000)
  await context.setOffline(true)
  await context.setOffline(false)
  await page.clock.runFor(100)
  expect(reads).toHaveLength(5)
  await page.getByRole('button', { name: '刷新全部新闻', exact: true }).click()
  await expect.poll(() => reads.length).toBe(10)
})

test('离线时启用后又关闭的来源，不会在网络恢复后发起暂停的读取', async ({ page, context }) => {
  const reads = await fixture(page)
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '来源标题-zhihu' })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('button', { name: '新闻来源设置', exact: true }).click()
  const bili = page.getByRole('switch', { name: '哔哩哔哩热搜', exact: true })
  await bili.check()
  await bili.uncheck()
  await page.keyboard.press('Escape')
  await context.setOffline(false)
  await page.clock.runFor(100)
  expect(reads).not.toContain('bilibili-hot-search')
  await expect(page.getByRole('article')).toHaveCount(5)
})
