import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'
const taskId = '00000000-0000-4000-8000-000000000056'
const completionId = '00000000-0000-4000-8000-000000000057'
const reward = { amount: 1, calculation: { type: 'fixed_task' as const, completionId, count: 1, coefficient: 1 } }
const base: PlanningPage = {
  ...withGoal, version: 3,
  capabilities: { ...withGoal.capabilities, createTask: allowed },
  tasks: [{ id: taskId, title: '取回耳机', description: '修理店', plannedOn: withGoal.today,
    status: 'pending', completedOn: null, completionId: null, reward: null, completionOrigin: null, independent: true, goalId: null, goalTitle: null, mainlineName: '独立区', overdue: false, progress: { completed: 0, total: 1, ratio: 0 },
    capabilities: { edit: allowed, complete: allowed, cancel: later, reschedule: later, migrate: later, end: later } }],
  totalTasks: 1,
}
const completed: PlanningPage = { ...base, version: 5, tasks: [{ ...base.tasks[0], status: 'completed', completedOn: base.today, completionId, reward, capabilities: { ...base.tasks[0].capabilities, complete: later, edit: later, cancel: allowed } }],
  growth: { ...base.growth, totalXp: 1, progress: 1, remaining: 19, actions: 1 } }

test('一次性任务创建编辑完成、预览取消与再次完成；刷新保持权威结果', async ({ page, context }) => {
  const server = await planningFixture(context, { ...base, version: 2, tasks: [], totalTasks: 0 })
  server.saved(base)
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /一次性任务/ }).click()
  await page.getByLabel('任务名称', { exact: true }).fill('取回耳机')
  await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue(base.today)
  await page.getByLabel('任务说明', { exact: true }).fill('修理店')
  const destination = page.getByLabel('任务归属', { exact: true })
  await expect(destination).toHaveValue('')
  await expect(destination.locator('option[value="independent"]')).toHaveCount(0)
  await expect(destination.locator('option[value=""]')).toHaveText('默认独立任务')
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes[0].command).toEqual({ type: 'createTask', title: '取回耳机', description: '修理店', plannedOn: base.today, destination: '' })
  const card = page.getByRole('article', { name: '任务：取回耳机' })
  await expect(card).toContainText('独立任务')
  await card.getByRole('button', { name: '编辑任务', exact: true }).click()
  await page.getByLabel('任务说明', { exact: true }).fill('下午去修理店')
  server.saved({ ...base, version: 4, tasks: [{ ...base.tasks[0], description: '下午去修理店' }] })
  await page.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  server.saved(completed)
  await card.getByRole('button', { name: '完成', exact: true }).click()
  await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
  expect(server.envelopes[2].command).toEqual({ type: 'completeTask', id: taskId })
  server.preview({ version: 5, today: base.today, allowed: true, requiresConfirmation: true, message: '移除本次完成与经验', completionId, reward,
    growthBefore: completed.growth, growthAfter: base.growth })
  await card.getByRole('button', { name: '取消完成', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '取消任务完成' })
  await expect(dialog).toContainText('取消后')
  await expect(dialog).toContainText('0 点经验')
  expect(server.envelopes).toHaveLength(3)
  expect(server.previews).toHaveLength(1)
  server.saved({ ...base, version: 6 })
  await dialog.getByRole('button', { name: '确认取消完成', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(server.envelopes[3]).toMatchObject({ expectedVersion: 5, command: { type: 'cancelTaskCompletion', completionId } })
  server.saved({ ...completed, version: 7 })
  await card.getByRole('button', { name: '完成', exact: true }).click()
  await page.reload()
  await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(5)
})

test('取消确认遇到版本冲突后必须重新预览，不自动重放', async ({ page, context }) => {
  const server = await planningFixture(context, completed)
  server.preview({ version: 5, today: base.today, allowed: true, requiresConfirmation: true, message: '移除本次完成与经验', completionId, reward,
    growthBefore: completed.growth, growthAfter: base.growth })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '取消完成', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '取消任务完成' })
  server.saved({ ...completed, version: 6 })
  server.conflictNext()
  await dialog.getByRole('button', { name: '确认取消完成', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '确认取消完成', exact: true })).toBeDisabled()
  expect(server.envelopes).toHaveLength(1)
  server.preview({ version: 6, today: base.today, allowed: true, requiresConfirmation: true, message: '移除本次完成与经验', completionId, reward,
    growthBefore: completed.growth, growthAfter: base.growth })
  await dialog.getByRole('button', { name: '重新预览', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '确认取消完成', exact: true })).toBeEnabled()
  server.saved({ ...base, version: 7 })
  await dialog.getByRole('button', { name: '确认取消完成', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(server.envelopes[1].expectedVersion).toBe(6)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})


test('今天未来过去由后端返回，未来任务不能提前完成', async ({ page, context }) => {
  const server = await planningFixture(context, base)
  await page.goto('/adventure')
  server.show({ ...base, taskRange: 'future', tasks: [{ ...base.tasks[0], title: '未来行动', plannedOn: '2026-10-21', capabilities: { ...base.tasks[0].capabilities, complete: { allowed: false, reason: '仅能完成今天的安排' } } }] })
  await page.getByRole('button', { name: '未来', exact: true }).click()
  await expect(page.getByRole('button', { name: '未来', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const future = page.getByRole('article', { name: '任务：未来行动' })
  await expect(future.getByRole('button', { name: '完成', exact: true })).toBeDisabled()
  server.show({ ...base, taskRange: 'past', tasks: [{ ...base.tasks[0], title: '漏做行动', plannedOn: '2026-10-19', overdue: true, capabilities: { ...base.tasks[0].capabilities, complete: { allowed: false, reason: '过去不能补写完成' } } }] })
  await page.getByRole('button', { name: '过去', exact: true }).click()
  await expect(page.getByRole('article', { name: '任务：漏做行动' })).toContainText('逾期，仍待完成')
  expect(server.envelopes).toHaveLength(0)
})
