import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal } from './adventure-fixture'

test('编辑目标标签与名称后读取新事实，身份不变', async ({ page, context }) => {
  const server = await planningFixture(context, withGoal)
  server.saved({ ...withGoal, version: 3, goals: [{ ...withGoal.goals[0], title: '首次五公里', categoryLabel: '运动', standards: ['户外跑完五公里'] }] })
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '变更目标 五公里' }).click()
  await page.getByLabel('目标名称').fill('首次五公里')
  await page.getByLabel('分类标签').fill('运动')
  await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('户外跑完五公里')
  await page.getByRole('button', { name: '保存目标' }).click()
  await expect(page.getByRole('row', { name: /首次五公里/ })).toContainText('运动')
  expect(server.envelopes[0].command).toEqual({ type: 'editGoal', id: withGoal.goals[0].id, title: '首次五公里', categoryLabel: '运动', standards: ['户外跑完五公里'] })
})

test('分页显示服务端总数并读取下一页', async ({ page, context }) => {
  const server = await planningFixture(context, { ...withGoal, pageSize: 1, totalGoals: 2 })
  await page.goto('/adventure?view=planning')
  await expect(page.getByText('共 2 个目标 · 第 1 / 2 页')).toBeVisible()
  await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled()
  server.show({ ...withGoal, page: 2, pageSize: 1, totalGoals: 2, goals: [{ ...withGoal.goals[0], title: '第二页目标' }] })
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByRole('row', { name: /第二页目标/ })).toBeVisible()
  await expect(page.getByText('共 2 个目标 · 第 2 / 2 页')).toBeVisible()
  await expect(page.getByRole('button', { name: '上一页' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(server.envelopes).toHaveLength(0)
})

test('手机创建目标弹窗约束焦点并支持 Escape 取消', async ({ page, context }) => {
  const server = await planningFixture(context, withGoal)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '新建目标' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '关闭弹窗' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: '新建目标' })).toBeFocused()
  expect(server.envelopes).toHaveLength(0)
})

// Task layout remains covered while the goal panel changes.
test('桌面、中等宽度与手机下任务正文和日期不互相挤压', async ({ page, context }) => {
  const planning = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed }, tasks: [{
    arrangements: [], totalArrangements: 0, id: '00000000-0000-4000-8000-000000000056', title: '验收-已有行动 1',
    description: '用于成长流水分页和实时成就验收。', plannedOn: withGoal.today, status: 'completed' as const,
    completedOn: withGoal.today, completionId: '00000000-0000-4000-8000-000000000057',
    reward: { amount: 1, calculation: { type: 'fixed_task' as const, completionId: '00000000-0000-4000-8000-000000000057', count: 1, coefficient: 1 } },
    completionOrigin: { categoryLabel: null, goalId: null, goalTitle: null, title: '验收-已有行动 1', description: '用于成长流水分页和实时成就验收。', plannedOn: withGoal.today, occurredOn: withGoal.today },
    independent: true, goalId: null, goalTitle: null, overdue: false, progress: { completed: 1, total: 1, ratio: 1 },
    capabilities: { edit: later, complete: later, cancel: allowed, reschedule: later, migrate: allowed, end: later, delete: later },
  }], totalTasks: 1 }
  await planningFixture(context, planning)
  for (const width of [1440, 1139, 957, 818, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/adventure')
    const card = page.getByRole('article', { name: '任务：验收-已有行动 1' })
    const copy = (await card.locator('.today-task-copy').boundingBox())!, date = (await card.locator('.today-task-dates').boundingBox())!
    expect(copy.width).toBeGreaterThan(60)
    expect(copy.x + copy.width).toBeLessThanOrEqual(date.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
