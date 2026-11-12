import { test, expect } from './authenticated-test'
import { planningFixture, withGoal } from './adventure-fixture'

test('人生冒险读取失败时提供重新读取', async ({ page }) => {
  await page.goto('/adventure')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取人生冒险')
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible()
})

test('空目标列表创建目标，过滤空白标准并刷新回读', async ({ page, context }) => {
  const server = await planningFixture(context)
  server.saved(withGoal)
  await page.goto('/adventure?view=planning')
  await expect(page.getByText('还没有目标。先创建一个目标，再为它添加任务。')).toBeVisible()
  await page.getByRole('button', { name: '新建目标' }).click()
  await page.getByLabel('目标名称').fill('五公里')
  await page.getByLabel('分类标签').fill('健康')
  await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('连续跑完五公里')
  await page.getByRole('button', { name: '在完成标准 1 后添加' }).click()
  await page.getByRole('button', { name: '创建目标', exact: true }).click()
  await expect(page.getByRole('row', { name: /五公里/ })).toContainText('健康')
  expect(server.envelopes).toHaveLength(1)
  expect(server.envelopes[0].command).toEqual({ type: 'createGoal', title: '五公里', categoryLabel: '健康', standards: ['连续跑完五公里'] })
  await page.reload()
  await expect(page.getByRole('row', { name: /五公里/ })).toBeVisible()
})

test('目标名称和非空标准必填，标签可留空且禁止超长', async ({ page, context }) => {
  await planningFixture(context)
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '新建目标' }).click()
  const submit = page.getByRole('button', { name: '创建目标', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByLabel('目标名称').fill('目标')
  await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('标准')
  await expect(submit).toBeEnabled()
  await page.getByLabel('分类标签').fill('字'.repeat(201))
  await expect(submit).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('最多 200 个字符')
})
