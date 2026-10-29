import { test, expect as baseExpect } from '@playwright/test'
import { liveEnabled, livePlanning, type LivePlanning } from '../support/planning-live'
import app from '../../worker/index'

const expect = baseExpect.configure({ timeout: 15_000 })
test.use({ trace: 'off' })
test.describe('真实账户与五表持久化的浏览器切片', () => {
  test.skip(!liveEnabled, '需要显式开启隔离真实数据库验收')
  let live: LivePlanning
  test.beforeAll(async () => { live = await livePlanning() })
  test.afterAll(async () => { if (live) await live.cleanup() })

  for (const [index, width] of [1440, 390].entries()) {
    test(`${width}px 创建、编辑、取消、键盘及刷新回读`, async ({ context, page }) => {
      test.setTimeout(90_000)
      const user = live.users[index]
      const storageKey = `sb-${new URL(live.env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`
      await context.addInitScript(({ key, session }) => {
        localStorage.setItem(key, JSON.stringify(session))
      }, { key: storageKey, session: user.session })
      await context.route('**/api/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname + new URL(request.url()).search
        if (!path.startsWith('/api/adventure') && !path.startsWith('/api/auth/'))
          return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '此验收未配置其他数据源' } } })
        const response = await app.request(path, {
          method: request.method(), headers: request.headers(),
          body: request.postData() ?? undefined,
        }, live.env)
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
      })
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/adventure')
      await expect(page.locator('.level-lockup strong')).toHaveText('01')
      await page.getByRole('button', { name: '主线与目标', exact: true }).click()
      await page.getByRole('button', { name: '新建主线', exact: true }).click()
      await page.getByLabel('主线名称').fill('健康与活力')
      await page.getByRole('dialog').getByRole('button', { name: '创建主线', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      const state = await live.read(index)
      const mainline = state.mainlines[0]
      await page.getByRole('button', { name: '新建目标', exact: true }).click()
      await expect(page.getByLabel('目标归属')).toHaveValue('')
      await expect(page.getByLabel('目标归属').locator('option[value=""]')).toHaveText('默认独立目标')
      await page.getByLabel('目标名称').fill('完成首次五公里')
      await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('在户外连续跑完五公里，记录一次体验。')
      await page.getByLabel('目标归属').selectOption(mainline.id)
      await page.getByRole('dialog').getByRole('button', { name: '创建目标', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await page.getByRole('button', { name: '目标：完成首次五公里' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '编辑目标' }).click()
      await page.getByLabel('目标名称').fill('跑过自己的第一个五公里')
      await page.getByRole('button', { name: '保存目标', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await page.getByRole('button', { name: '新建目标', exact: true }).click()
      await page.getByLabel('目标名称').fill('让书桌成为喜欢的角落')
      await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('清理书桌，并留出一处阅读空间。')
      await page.getByRole('dialog').getByRole('button', { name: '创建目标', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      const beforeCancel = await live.read(index)
      await page.getByRole('button', { name: '新建主线', exact: true }).click()
      await page.getByLabel('主线名称').fill('取消后不保存')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeFocused()
      expect((await live.read(index)).version).toBe(beforeCancel.version)
      await page.reload()
      await expect(page.getByRole('button', { name: '目标：跑过自己的第一个五公里' })).toBeVisible()
      await expect(page.getByRole('button', { name: '目标：让书桌成为喜欢的角落' })).toContainText('独立目标')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(page.getByText(/支线|次日|周期|inbox/)).toHaveCount(0)
      await page.screenshot({ path: `.cache/adventure54-${width}.png`, fullPage: true })
    })
  }
})
