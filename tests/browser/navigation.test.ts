import { expect, test, type Page } from './authenticated-test'
import { planningFixture } from './adventure-fixture'

const pages = [
  { path: '/', name: '首页' },
  { path: '/news', name: '新闻' },
  { path: '/adventure', name: '人生冒险' },
  { path: '/finance', name: '财务' },
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
      account: layout(sidebar.querySelector('.auth-avatar')!),
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
    await expect(page.getByRole('button', { name: '账户菜单', exact: true })).toBeEnabled()
    const baseline = await navigationSnapshot(page)

    for (const { path, name } of pages) {
      if (path !== '/') await page.goto(path)
      const navigation = page.getByLabel('主导航', { exact: true })
      await expect(navigation).toBeVisible()
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1)
      await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(navigation.locator('button.nav-item:disabled')).toHaveCount(3)
      expect.soft(await navigationSnapshot(page), `${path} 应与首页使用同一导航`).toEqual(baseline)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: '打开设置', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '账户菜单', exact: true })).toHaveCount(1)
      const account = navigation.getByRole('button', { name: '账户菜单', exact: true })
      await expect(account).toBeInViewport()
      const avatar = (await account.boundingBox())!
      expect(avatar.y).toBeGreaterThan(844)

      if (width === 1440 || width === 390) {
        await navigation.getByRole('link', { name: 'LifeSpace 首页', exact: true }).focus()
        for (const destination of pages) {
          await page.keyboard.press('Tab')
          await expect(navigation.getByRole('link', { name: destination.name, exact: true })).toBeFocused()
        }
        // 财务前后的禁用占位都不能截住键盘焦点。
        await page.keyboard.press('Tab')
        await expect(account).toBeFocused()
        await page.keyboard.press('Enter')
        const menu = page.getByRole('menu', { name: '账户', exact: true })
        await expect(menu).toContainText('demo@example.com')
        const box = (await menu.boundingBox())!
        expect(box.x).toBeGreaterThan(baseline.sidebar.width)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBeLessThanOrEqual(avatar.y + avatar.height)
        await page.keyboard.press('Tab')
        const logout = menu.getByRole('menuitem', { name: '退出登录' })
        await expect(logout).toBeFocused()
        expect(await logout.evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        })).toBe(true)
        await page.screenshot({ path: `.cache/nav-${path === '/' ? 'home' : path.slice(1)}-${width}.png` })
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
        await expect(account).toBeFocused()
        await account.click()
        await page.locator('main').click({ position: { x: 5, y: 5 } })
        await expect(menu).toHaveCount(0)
      }
    }
  })
}

for (const [width, height] of [[1440, 360], [390, 360], [320, 240]]) {
  test(`${width}×${height} 矮视口中导航可滚动且不遮挡底部账户`, async ({ page }) => {
    for (const { path } of pages) {
      await page.setViewportSize({ width, height })
      await page.goto(path)
      const navigation = page.getByLabel('主导航', { exact: true })
      const account = navigation.getByRole('button', { name: '账户菜单' })
      const avatar = (await account.boundingBox())!
      await expect(account).toBeInViewport()
      const nav = (await navigation.locator('nav').boundingBox())!
      expect(nav.y + nav.height).toBeLessThanOrEqual(avatar.y)
      for (const name of ['财务', '首页']) {
        const link = navigation.getByRole('link', { name, exact: true })
        await link.focus()
        await expect(link).toBeInViewport()
        expect(await account.boundingBox()).toEqual(avatar)
      }
      await account.click()
      const menu = page.getByRole('menu', { name: '账户', exact: true })
      await expect(menu.getByRole('menuitem', { name: '退出登录' })).toBeInViewport()
      const box = (await menu.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      if (path === '/') await page.screenshot({ path: `.cache/nav-short-${width}.png` })
      await page.keyboard.press('Escape')
      await expect(account).toBeFocused()
    }
  })
}

test('导航切页、刷新和浏览器前进后退正确标识当前页面', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '账户菜单', exact: true })).toBeEnabled()
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
