import { expect, test, type Page } from './authenticated-test'
import { planningFixture } from './adventure-fixture'

const pages = [
  { path: '/', name: '首页', settings: true },
  { path: '/news', name: '新闻', settings: true },
  { path: '/adventure', name: '人生冒险', settings: false },
  { path: '/finance', name: '财务', settings: false },
] as const

test.beforeEach(async ({ context }) => {
  await planningFixture(context)
  await context.route('**/api/ledger/entries?**', route => route.fulfill({
    json: { items: [], total: 0, page: 1, pageSize: 30, version: 0 },
  }))
})

async function navigationSnapshot(page: Page) {
  return page.getByLabel('主导航', { exact: true }).evaluate(sidebar => {
    const box = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const layout = (element: Element) => {
      const style = getComputedStyle(element)
      return {
        ...box(element), display: style.display, position: style.position,
        flexDirection: style.flexDirection, gap: style.gap,
        padding: style.padding, borderRadius: style.borderRadius,
        fontSize: style.fontSize, lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing, backdropFilter: style.backdropFilter,
      }
    }
    const appearance = (element: Element) => {
      const style = getComputedStyle(element)
      return { color: style.color, background: style.backgroundColor, opacity: style.opacity }
    }
    const appearances = (selector: string) => [...new Set(
      [...sidebar.querySelectorAll(selector)].map(element => JSON.stringify(appearance(element))),
    )].sort().map(value => JSON.parse(value))
    const markup = sidebar.querySelector('nav')!.cloneNode(true) as HTMLElement
    // 当前页面本来就应不同，其余导航结构必须完全相同。
    markup.querySelectorAll('[aria-current]').forEach(element => element.removeAttribute('aria-current'))
    markup.querySelectorAll('.active').forEach(element => element.classList.remove('active'))
    return {
      markup: markup.outerHTML,
      brandMarkup: sidebar.querySelector('.brand-mark')!.outerHTML,
      sidebar: {
        ...layout(sidebar), background: getComputedStyle(sidebar).backgroundColor,
        borderTop: getComputedStyle(sidebar).borderTop,
        borderRight: getComputedStyle(sidebar).borderRight,
        borderBottom: getComputedStyle(sidebar).borderBottom,
        borderLeft: getComputedStyle(sidebar).borderLeft,
      },
      brand: layout(sidebar.querySelector('.brand-mark')!),
      nav: layout(sidebar.querySelector('nav')!),
      items: [...sidebar.querySelectorAll('.nav-item')].map(layout),
      states: {
        active: appearances('.nav-item[aria-current="page"]'),
        inactive: appearances('a.nav-item:not([aria-current="page"])'),
        disabled: appearances('button.nav-item:disabled'),
      },
    }
  })
}

for (const width of [1440, 957, 721, 720, 701, 700, 390, 320]) {
  test(`${width}px 各页面共用相同导航结构、品牌和布局`, async ({ page }) => {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/')
    // 首页骨架也包含导航；设置入口出现后才完成真实页面的测量。
    await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible()
    const baseline = await navigationSnapshot(page)
    const baselineSettings = await page.getByRole('button', { name: '打开设置', exact: true }).boundingBox()

    for (const { path, name, settings } of pages) {
      if (path !== '/') await page.goto(path)
      const navigation = page.getByLabel('主导航', { exact: true })
      await expect(navigation).toBeVisible()
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1)
      await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(navigation.locator('button.nav-item:disabled')).toHaveCount(3)
      expect.soft(await navigationSnapshot(page), `${path} 应与首页使用同一导航`).toEqual(baseline)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const settingsButton = page.getByRole('button', { name: '打开设置', exact: true })
      if (settings) {
        await expect(settingsButton).toBeVisible()
        expect(await settingsButton.boundingBox()).toEqual(baselineSettings)
      } else await expect(settingsButton).toHaveCount(0)

      if (width === 1440 || width === 390) {
        await page.screenshot({ path: `.cache/nav-${path === '/' ? 'home' : path.slice(1)}-${width}.png`, fullPage: true })
        await navigation.getByRole('link', { name: 'LifeSpace 首页', exact: true }).focus()
        for (const destination of pages) {
          await page.keyboard.press('Tab')
          await expect(navigation.getByRole('link', { name: destination.name, exact: true })).toBeFocused()
        }
        // 财务前后的禁用占位都不能截住键盘焦点。
        await page.keyboard.press('Tab')
        if (settings) {
          await expect(settingsButton).toBeFocused()
          await settingsButton.click()
          const dialog = page.getByRole('dialog', { name: path === '/' ? '首页设置' : '新闻来源设置', exact: true })
          await expect(dialog).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(dialog).toHaveCount(0)
        } else await expect(navigation.locator(':focus')).toHaveCount(0)
      }
    }
  })
}

test('导航切页、刷新和浏览器前进后退正确标识当前页面', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible()
  for (const { path, name } of pages.slice(1)) {
    await page.getByLabel('主导航', { exact: true }).getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByLabel('主导航', { exact: true }).locator('[aria-current="page"]')).toHaveText(name)
  }
  await page.reload()
  await expect(page.getByLabel('主导航', { exact: true }).locator('[aria-current="page"]')).toHaveText('财务')
  await page.goBack()
  await expect(page.getByLabel('主导航', { exact: true }).locator('[aria-current="page"]')).toHaveText('人生冒险')
  await page.goForward()
  await expect(page.getByLabel('主导航', { exact: true }).locator('[aria-current="page"]')).toHaveText('财务')
  await page.getByRole('link', { name: 'LifeSpace 首页', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByLabel('主导航', { exact: true }).locator('[aria-current="page"]')).toHaveText('首页')
})
