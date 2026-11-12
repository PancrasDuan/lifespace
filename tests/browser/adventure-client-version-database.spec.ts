import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const db = planningDatabaseBrowser()
test.describe('客户端版本切换', () => {
  test.skip(!localPlanningRpc, '需要隔离数据库')
  test.beforeEach(async ({ context }) => { await db.install(context) })
  test.afterEach(() => db.restore())
  test('缓存的旧客户端写入被拒绝，刷新后的新客户端可以保存', async ({ page }) => {
    const before = await db.snapshot()
    await page.goto('/adventure?view=planning')
    const path = '**/api/adventure/commands'
    await page.route(path, async route => {
      const headers = { ...route.request().headers() }
      delete headers['x-adventure-client-version']
      await route.fallback({ headers })
    })
    await page.getByRole('button', { name: '新建目标' }).click()
    await page.getByLabel('目标名称').fill('切换验收')
    await page.getByLabel('完成标准 1', { exact: true }).fill('完成')
    await page.getByRole('button', { name: '创建目标', exact: true }).click()
    await expect(page.getByText('旧页面操作结果可能未知，请不要刷新或重新提交，请联系维护人员核对。')).toBeVisible()
    expect(await db.snapshot()).toEqual(before)
    await page.unroute(path)
    await page.reload()
    await page.getByRole('button', { name: '新建目标' }).click()
    await page.getByLabel('目标名称').fill('切换验收')
    await page.getByLabel('完成标准 1', { exact: true }).fill('完成')
    await page.getByRole('button', { name: '创建目标', exact: true }).click()
    await expect(page.getByRole('row', { name: /切换验收/ })).toBeVisible()
    expect((await db.snapshot()).version).toBe(before.version + 1)
  })
})
