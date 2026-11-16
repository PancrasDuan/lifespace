import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'
import type { PlanningEnvelope } from '../../src/shared/adventure-planning'

const db = planningDatabaseBrowser()
test.describe('持久化恢复：真实浏览器 → Worker → PostgREST → PostgreSQL', () => {
  test.skip(!localPlanningRpc, '需要隔离数据库运行器；跳过不算验收')
  test.beforeEach(async ({ context }) => { await db.install(context) })
  test.afterEach(() => db.restore())
  for (const scenario of ['uncommitted', 'lost-response', 'version-conflict'] as const) {
    test(`${scenario} 重载后使用相同封套恢复`, async ({ page, context }) => {
      let original: PlanningEnvelope | undefined
      const retries: unknown[] = []
      await context.route('**/api/adventure/commands', async route => {
        if (original) { retries.push(route.request().postDataJSON()); await route.fallback(); return }
        original = route.request().postDataJSON()
        if (scenario === 'lost-response') expect((await db.request('/api/adventure/commands', original)).status).toBe(200)
        await route.abort('failed')
      })
      await page.goto('/adventure?view=planning')
      await page.getByRole('button', { name: '新建目标', exact: true }).click()
      await page.getByLabel('目标名称').fill('真实恢复目标')
      await page.getByLabel('完成标准 1', { exact: true }).fill('核对事实')
      await page.getByRole('button', { name: '创建目标', exact: true }).click()
      await expect(page.getByRole('button', { name: '安全重试同一次操作' })).toBeVisible()
      if (scenario === 'version-conflict') await db.write({ type: 'createGoal', title: '另一页面目标', standards: ['标准'] })
      const before = await db.snapshot()
      expect(before.totalGoals).toBe(scenario === 'uncommitted' ? 0 : 1)
      await page.reload()
      await page.getByRole('button', { name: '安全重试同一次操作' }).click()
      await expect.poll(() => retries).toEqual([original])
      if (scenario === 'version-conflict') {
        await expect(page.getByText(/数据版本已变化，原操作未在本次重试中执行/).first()).toBeVisible()
        await page.getByRole('button', { name: '重新读取当前事实' }).click()
        await page.getByRole('checkbox', { name: '我已核对当前页面事实，确认解除本地待确认状态' }).check()
        await page.getByRole('button', { name: '解除本地待确认状态', exact: true }).click()
      }
      await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
      const after = await db.snapshot()
      expect(after.version).toBe(scenario === 'uncommitted' ? before.version + 1 : before.version)
      expect(after.totalGoals).toBe(1)
      expect(after.goals[0].title).toBe(scenario === 'version-conflict' ? '另一页面目标' : '真实恢复目标')
      await page.reload()
      await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
      expect(retries).toEqual([original])
    })
  }
})
