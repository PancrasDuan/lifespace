import { expect, test, type Page } from '@playwright/test'
import { newsSources } from '../../src/shared/news-sources'

const result = (id: string) => ({
  sourceId: id, fetchedAt: '2026-10-06T08:00:00.000Z', sourceUpdatedAt: '2026-10-06T07:00:00.000Z',
  upstreamStatus: 'cache', cacheHit: false, stale: false, warning: null,
  items: [{ id: 'headline', title: '示例标题-' + id, url: 'https://example.test/' + id, rank: 1 }],
})

async function sourceMetadata(page: Page) {
  await page.route('**/api/news/sources', route => route.fulfill({ json: { sources: newsSources } }))
}

test('前端新鲜期沿用原获取时间，返回页面复用缓存，过期后再取数', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T08:00:00Z') })
  await sourceMetadata(page)
  const requests: string[] = []
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await sourceMetadata(page)
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    requests.push(id)
    return route.fulfill({ json: { ...result(id), fetchedAt: '2026-10-06T07:56:00.000Z', cacheHit: true } })
  })
  await page.goto('/news')
  await expect(page.getByRole('link', { name: '示例标题-zhihu' })).toBeVisible()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect(page.getByRole('link', { name: '示例标题-zhihu' })).toBeVisible()
  expect(requests).toHaveLength(5)
  await page.clock.fastForward(61000)
  // 无轮询或焦点刷新；仅重新进入页面时获取过期榜单。
  expect(requests).toHaveLength(5)
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect.poll(() => requests.length).toBe(10)
})

test('新闻取数最多三个并发，离开页面取消未开始的来源', async ({ page }) => {
  await sourceMetadata(page)
  const requests: string[] = []
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await page.route('**/api/news/sources', route => route.fulfill({ json: { sources: newsSources } }))
  await page.route('**/api/news/source?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    requests.push(id)
    await held
    await route.fulfill({ json: result(id) }).catch(() => {})
  })
  await page.goto('/news')
  await expect(page.getByRole('article')).toHaveCount(5)
  await expect.poll(() => requests.length).toBe(3)
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'LifeSpace', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('article', { name: '百度热搜', exact: true })).toHaveCount(0)
  expect(requests).toEqual(['baidu', 'cls-hot', 'tencent-hot'])
})

test('新闻导航支持站内切换、直接访问、刷新和前进后退，首页保持可用', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '示例来源暂不可用' } } }))
  await page.goto('/')
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect(page).toHaveURL(/\/news$/)
  await expect(page.getByRole('heading', { name: '热点新闻', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '新闻', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(page.getByRole('heading', { name: '热点新闻', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'LifeSpace', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: '热点新闻', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'LifeSpace', exact: true })).toBeVisible()
  for (const name of ['任务管理', '个人目标', '财务', '股票行情']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
})

test('新闻页按默认五源顺序展示真实返回内容，只请求启用来源并打开来源链接', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-06T08:00:00Z') })
  await sourceMetadata(page)
  const requests: string[] = []
  const externalRequests: string[] = []
  page.on('request', request => { if (request.url().includes('newsnow.busiyi.world')) externalRequests.push(request.url()) })
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    requests.push(id)
    return route.fulfill({ json: result(id) })
  })
  await context.route('https://example.test/**', route => route.fulfill({ body: '来源正文' }))
  await page.goto('/news')
  await expect(page.getByRole('article')).toHaveCount(5)
  await expect(page.getByRole('article').getByRole('heading')).toHaveText(['百度热搜', '财联社热门', '腾讯新闻综合早报', '今日头条', '知乎'])
  await expect(page.getByRole('link', { name: '示例标题-zhihu', exact: true })).toBeVisible()
  expect(requests.sort()).toEqual(['baidu', 'cls-hot', 'tencent-hot', 'toutiao', 'zhihu'])
  expect(externalRequests).toEqual([])
  const link = page.getByRole('link', { name: '示例标题-baidu', exact: true })
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const popup = await popupPromise
  await popup.waitForURL('https://example.test/baidu')
  await popup.close()
})

test('加载、空榜单和失败独立呈现，单卡及全部刷新失败保留已有结果', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T08:00:00Z') })
  await sourceMetadata(page)
  const counts = new Map<string, number>()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/news/source?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    const attempt = (counts.get(id) ?? 0) + 1
    counts.set(id, attempt)
    if (id === 'cls-hot' && attempt === 1) await held
    if (id === 'toutiao' && attempt === 1 || id === 'baidu' && attempt > 1) {
      await route.fulfill({ status: 502, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源暂时不可用' } } })
    } else await route.fulfill({ json: { ...result(id), items: id === 'tencent-hot' ? [] : result(id).items } })
  })
  await page.goto('/news')
  await expect(page.getByRole('article', { name: '财联社热门', exact: true })).toContainText('正在加载榜单')
  await expect(page.getByRole('article', { name: '腾讯新闻综合早报', exact: true })).toContainText('暂无热点')
  const failed = page.getByRole('article', { name: '今日头条', exact: true })
  await expect(failed.getByRole('alert')).toContainText('来源暂时不可用')
  await expect(page.getByRole('link', { name: '示例标题-zhihu' })).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  await page.getByRole('button', { name: '刷新百度热搜', exact: true }).click()
  const baidu = page.getByRole('article', { name: '百度热搜', exact: true })
  await expect(baidu.getByRole('alert')).toContainText('上次成功结果 · 本次刷新失败')
  await expect(baidu.getByRole('link', { name: '示例标题-baidu' })).toBeVisible()
  await expect(baidu).toContainText('获取时间 10/06 16:00')
  expect(counts.get('zhihu')).toBe(1)
  await page.getByRole('button', { name: '刷新全部新闻' }).click()
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  await expect(failed.getByRole('link', { name: '示例标题-toutiao' })).toBeVisible()
  expect([...counts.entries()]).toEqual([['baidu', 3], ['cls-hot', 2], ['tencent-hot', 2], ['toutiao', 2], ['zhihu', 2]])
  await page.clock.fastForward(600000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect([...counts.values()]).toEqual([3, 2, 2, 2, 2])
})

test('同源榜单链接无效时显示统一内容错误，不展示底层英文异常', async ({ page }) => {
  await sourceMetadata(page)
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    return route.fulfill({ json: { ...result(id), items: [{ ...result(id).items[0], url: 'invalid-url' }] } })
  })
  await page.goto('/news')
  await expect(page.getByRole('article', { name: '百度热搜', exact: true }).getByRole('alert')).toHaveText('服务返回了无效内容，请刷新重试')
})

test('新开新闻页收到回退结果时提示旧榜单与原时间，刷新恢复后清除提示', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T08:10:00Z') })
  await sourceMetadata(page)
  let restored = false
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    return route.fulfill({ json: id === 'baidu' && !restored ? {
      ...result(id), cacheHit: true, stale: true, warning: { code: 'SOURCE_UNAVAILABLE', message: '数据源暂时不可用，请稍后刷新' },
    } : { ...result(id), fetchedAt: '2026-10-06T08:10:00.000Z' } })
  })
  await page.goto('/news')
  const card = page.getByRole('article', { name: '百度热搜', exact: true })
  await expect(card.getByRole('alert')).toContainText('上次成功结果')
  await expect(card.getByRole('alert')).toContainText('数据源暂时不可用')
  await expect(card).toContainText('获取时间 10/06 16:00')
  await expect(card.getByRole('link', { name: '示例标题-baidu' })).toBeVisible()
  await expect(page.getByRole('article', { name: '知乎', exact: true }).getByRole('alert')).toHaveCount(0)
  restored = true
  await card.getByRole('button', { name: '刷新百度热搜', exact: true }).click()
  await expect(card).toContainText('获取时间 10/06 16:10')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('回退标记不受客户端时钟影响，返回新闻页立即重新检查', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T08:00:00Z') })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '来源不可用' } } }))
  await sourceMetadata(page)
  let reads = 0
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    if (id === 'baidu') reads++
    return route.fulfill({ json: id === 'baidu' && reads === 1 ? {
      ...result(id), cacheHit: true, stale: true, warning: { code: 'SOURCE_UNAVAILABLE', message: '数据源暂时不可用' },
    } : result(id) })
  })
  await page.goto('/news')
  await expect(page.getByRole('article', { name: '百度热搜', exact: true }).getByRole('alert')).toBeVisible()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  await expect(page.getByRole('article', { name: '百度热搜', exact: true }).getByRole('alert')).toHaveCount(0)
})

test('全部刷新同样限制三个并发，完成后继续排队来源', async ({ page }) => {
  await sourceMetadata(page)
  let refreshing = false
  let started = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/news/source?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    if (refreshing) { started++; await held }
    await route.fulfill({ json: result(id) })
  })
  await page.goto('/news')
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  refreshing = true
  await page.getByRole('button', { name: '刷新全部新闻' }).click()
  await expect.poll(() => started).toBe(3)
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeDisabled()
  release()
  await expect.poll(() => started).toBe(5)
  await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
  expect(started).toBe(5)
})

test('新闻卡片按三、二、单列布局，无横向溢出，榜单可滚动且标题作为文本', async ({ page }) => {
  await sourceMetadata(page)
  await page.route('**/api/news/source?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!
    return route.fulfill({ json: { ...result(id), items: Array.from({ length: 30 }, (_, i) => ({
      id: String(i), title: i === 0 ? '<script>标题仍是文本</script>' : '第 ' + (i + 1) + ' 条热点：关注今天发生的变化',
      url: 'https://example.test/' + id + '/' + i, rank: i + 1,
    })) } })
  })
  for (const [width, columns] of [[1440, 3], [952, 2], [390, 1]]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/news')
    await expect(page.getByRole('button', { name: '刷新全部新闻' })).toBeEnabled()
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth,
      columns: getComputedStyle(document.querySelector('.news-grid')!).gridTemplateColumns.split(' ').length,
    }))
    expect(layout.content).toBeLessThanOrEqual(layout.viewport)
    expect(layout.columns).toBe(columns)
    const list = page.getByLabel('百度热搜榜单', { exact: true })
    const scroll = await list.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }))
    expect(scroll.content).toBeGreaterThan(scroll.height)
    if (width !== 952) await page.screenshot({ path: width === 1440 ? '.cache/news-desktop.png' : '.cache/news-mobile.png', fullPage: true })
    await list.focus()
    await page.keyboard.press('End')
    await expect(page.getByRole('article', { name: '百度热搜', exact: true }).getByRole('link').last()).toBeVisible()
    expect(await page.locator('.news-card script').count()).toBe(0)
  }
})
