import { test, expect } from './authenticated-test'
import { planningFixture } from './adventure-fixture'

test('按当前页面加载代码，延迟的页面保留导航并显示加载状态', async ({ page }) => {
  let requested = false
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/src/news/News.tsx*', async route => {
    requested = true
    await held
    await route.continue()
  })
  await page.goto('/')
  expect(requested).toBe(false)
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  try {
    await expect(page.getByRole('status')).toHaveText('正在加载热点新闻…')
    await expect(page.getByRole('link', { name: '新闻', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveTitle('热点新闻 · LifeSpace')
  } finally { release() }
  await expect(page.locator('.news-page')).toBeVisible()
})

test('加载失败可重新加载恢复，也可以从导航进入其他页面', async ({ page, context }) => {
  await context.route('**/src/news/News.tsx*', route => route.abort('failed'))
  await page.goto('/')
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('页面暂时无法显示，请重新加载。')
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await expect(page.locator('.home-page')).toBeVisible()
  await page.getByRole('link', { name: '新闻', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新加载页面' })).toBeVisible()
  await context.unroute('**/src/news/News.tsx*')
  await page.getByRole('button', { name: '重新加载页面' }).click()
  await expect(page.locator('.news-page')).toBeVisible()
})

for (const width of [1440, 390]) test(`${width}px 四个页面可用键盘跳过导航并正确设置标题`, async ({ page, context }) => {
  await planningFixture(context)
  await context.route('**/api/ledger/entries?**', route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 30, version: 0 } }))
  await page.setViewportSize({ width, height: 844 })
  for (const [path, title] of [['/', '首页'], ['/news', '热点新闻'], ['/adventure', '人生冒险'], ['/finance', '财务']]) {
    await page.goto(path)
    await expect(page).toHaveTitle(`${title} · LifeSpace`)
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: '跳到主要内容' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('h1#page-title')).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await page.locator('.sidebar :focus').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
