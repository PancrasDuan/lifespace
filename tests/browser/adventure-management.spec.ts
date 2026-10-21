import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal, withMainline } from './adventure-fixture'

test('主线改名与目标编辑保存后显示新查询事实', async ({ page, context }) => {
  const server = await planningFixture(context, withGoal)
  server.saved({ ...withGoal, version: 3, mainlines: [{ ...withMainline.mainlines[0], name: '健康与活力' }],
    goals: [{ ...withGoal.goals[0], mainlineName: '健康与活力' }] })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '修改主线 健康' }).click()
  await page.getByLabel('主线名称', { exact: true }).fill('健康与活力')
  await page.getByRole('button', { name: '保存名称' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('article', { name: '主线：健康与活力' })).toBeVisible()
  server.saved({ ...withGoal, version: 4, goals: [{ ...withGoal.goals[0], title: '首次五公里', standards: ['户外跑完五公里'] }] })
  await page.getByRole('button', { name: '目标：五公里' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '编辑目标' }).click()
  await page.getByLabel('目标名称').fill('首次五公里')
  await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('户外跑完五公里')
  await page.getByRole('button', { name: '保存目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: '目标：首次五公里' })).toContainText('户外跑完五公里')
  expect(server.envelopes.map(item => item.command.type)).toEqual(['renameMainline', 'editGoal'])
})

test('服务端禁止创建主线时禁用入口，目标入口仍可用', async ({ page, context }) => {
  await planningFixture(context, { ...withMainline, capabilities: { createMainline: { allowed: false, reason: '最多保留 5 条在用主线' }, createGoal: allowed, createTask: later, growth: later } })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button').filter({ hasText: '长期经营' })).toBeDisabled()
  await expect(page.getByRole('dialog').getByRole('button').filter({ hasText: '阶段成果' })).toBeEnabled()
})

test('390px 手机布局、键盘焦点约束和 Escape 取消可用', async ({ page, context }) => {
  const server = await planningFixture(context, withGoal)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/adventure')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /阶段成果/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '关闭弹窗' })).toBeFocused()
  await page.getByRole('button', { name: '新建', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '关闭弹窗' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeFocused()
  expect(server.envelopes).toHaveLength(0)
})

test('分页只展示服务端当前页，不用本页数量替代总数', async ({ page, context }) => {
  const server = await planningFixture(context, { ...withGoal, pageSize: 1, totalGoals: 2 })
  await page.goto('/adventure')
  await expect(page.getByText('共 2 个目标 · 第 1 页')).toBeVisible()
  server.show({ ...withGoal, page: 2, pageSize: 1, totalGoals: 2,
    goals: [{ ...withGoal.goals[0], title: '第二页的目标' }] })
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByRole('button', { name: '目标：第二页的目标' })).toBeVisible()
  await expect(page.getByRole('button', { name: '目标：五公里' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(server.envelopes).toHaveLength(0)
})
