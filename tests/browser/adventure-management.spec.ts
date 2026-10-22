import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal, withMainline, mainlineId } from './adventure-fixture'

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

test('桌面、中等宽度与手机下任务正文和操作按钮不互相挤压', async ({ page, context }) => {
  const planning = {
    ...withGoal,
    capabilities: { ...withGoal.capabilities, createTask: allowed },
    tasks: [{
      arrangements: [], totalArrangements: 0, id: '00000000-0000-4000-8000-000000000056', title: '验收-已有行动 1',
      description: '用于成长流水分页和实时成就验收。', plannedOn: withGoal.today, status: 'completed' as const,
      completedOn: withGoal.today, completionId: '00000000-0000-4000-8000-000000000057',
      reward: { amount: 1, calculation: { type: 'fixed_task' as const, completionId: '00000000-0000-4000-8000-000000000057', count: 1, coefficient: 1 } },
      completionOrigin: { mainlineId, mainlineName: '独立区', goalId: null, goalTitle: null, title: '验收-已有行动 1', description: '用于成长流水分页和实时成就验收。', plannedOn: withGoal.today, occurredOn: withGoal.today },
      independent: true, goalId: null, goalTitle: null, mainlineName: '独立区', overdue: false, progress: { completed: 1, total: 1, ratio: 1 },
      capabilities: { edit: later, complete: later, cancel: allowed, reschedule: later, migrate: allowed, end: later, delete: later },
    }],
    totalTasks: 1,
  }
  await planningFixture(context, planning)
  const card = page.getByRole('article', { name: '任务：验收-已有行动 1', exact: true })
  const buttons = card.locator('.planning-task-buttons')
  for (const width of [1440, 1139, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/adventure')
    const layout = await card.evaluate(element => {
      const content = element.firstElementChild
      const actions = element.lastElementChild
      if (!content || !actions) throw new Error('任务卡缺少正文或操作')
      const card = element.getBoundingClientRect()
      const copy = content.getBoundingClientRect()
      const buttons = actions.getBoundingClientRect()
      return { direction: getComputedStyle(element).flexDirection, card: { left: card.left, right: card.right, width: card.width },
        copy: { left: copy.left, right: copy.right, width: copy.width }, buttons: { left: buttons.left, right: buttons.right, width: buttons.width } }
    })
    expect(layout.copy.width).toBeGreaterThan(200)
    expect(layout.buttons.left).toBeGreaterThanOrEqual(layout.card.left)
    expect(layout.buttons.right).toBeLessThanOrEqual(layout.card.right)
    expect(layout.direction).toBe('column')
    expect(await buttons.boundingBox()).not.toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
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


test('独立目标编辑时归属显示与提交一致，可转入主线及清空', async ({ page, context }) => {
  const independent = { ...withGoal, goals: [{ ...withGoal.goals[0], independent: true, mainlineName: '独立区' }] }
  const server = await planningFixture(context, independent)
  server.saved(withGoal)
  await page.goto('/adventure')
  await page.getByRole('button', { name: '目标：五公里' }).click()
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const destination = page.getByLabel('目标归属')
  await expect(destination).toHaveValue('')
  await expect(destination).toHaveCSS('color', 'rgb(156, 164, 149)')
  await destination.selectOption(mainlineId)
  await expect(destination).toHaveValue(mainlineId)
  await expect(destination).not.toHaveCSS('color', 'rgb(156, 164, 149)')
  await page.getByRole('button', { name: '保存目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes[0].command).toMatchObject({ type: 'editGoal', destination: mainlineId })
  await page.getByRole('button', { name: '目标：五公里' }).click()
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  await expect(destination).toHaveValue(mainlineId)
  await destination.selectOption('')
  server.saved({ ...independent, version: 3 })
  await page.getByRole('button', { name: '保存目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes[1].command).toMatchObject({ type: 'editGoal', destination: '' })
  await expect(page.getByRole('button', { name: '目标：五公里' })).toContainText('独立目标')
})
