import { test, expect } from './authenticated-test'
import { planningFixture, withGoal, mainlineId } from './adventure-fixture'

test('旧主线链接明确退役，可返回目标列表', async ({ page, context }) => {
  await planningFixture(context, withGoal)
  await page.goto(`/adventure?mainlineId=${mainlineId}`)
  await expect(page.getByRole('alert')).toContainText('旧主线链接已停用')
  await page.getByRole('button', { name: '查看目标' }).click()
  await expect(page.getByRole('row', { name: /五公里/ })).toBeVisible()
  await expect(page).toHaveURL('/adventure?view=planning')
  await expect(page.getByRole('button', { name: /迁移目标|新建主线/ })).toHaveCount(0)
})

test('旧聚焦筛选链接明确提示已退役', async ({ page, context }) => {
  await planningFixture(context, withGoal)
  await page.goto('/adventure?goalScope=focus')
  await expect(page.getByRole('alert')).toContainText('旧目标筛选链接已停用')
  await page.getByRole('button', { name: '查看目标' }).click()
  await expect(page.getByRole('row', { name: /五公里/ })).toBeVisible()
})
