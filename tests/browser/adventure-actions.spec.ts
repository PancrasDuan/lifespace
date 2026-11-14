import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'
const taskId = '00000000-0000-4000-8000-000000000056'
const completionId = '00000000-0000-4000-8000-000000000057'
const reward = { amount: 1, calculation: { type: 'fixed_task' as const, completionId, count: 1, coefficient: 1 } }
const base: PlanningPage = {
  ...withGoal, version: 3,
  capabilities: { ...withGoal.capabilities, createTask: allowed },
  tasks: [{ arrangements: [], totalArrangements: 0, id: taskId, title: '取回耳机', description: '修理店', plannedOn: withGoal.today,
    status: 'pending', completedOn: null, completionId: null, reward: null, completionOrigin: null, independent: true, goalId: null, goalTitle: null, overdue: false, progress: { completed: 0, total: 1, ratio: 0 },
    capabilities: { edit: allowed, complete: allowed, cancel: later, reschedule: later, migrate: later, end: later } }],
  totalTasks: 1,
}
const completed: PlanningPage = { ...base, version: 5, tasks: [{ ...base.tasks[0], status: 'completed', completedOn: base.today, completionId, reward, capabilities: { ...base.tasks[0].capabilities, complete: later, edit: later, cancel: allowed } }],
  growth: { ...base.growth, totalXp: 1, progress: 1, remaining: 19, actions: 1 } }

test('验收反馈：直接撤销完成，不打开预览或确认弹窗', async ({ page, context }) => {
  const server = await planningFixture(context, completed)
  server.saved({ ...base, version: 6 })
  server.preview({ version: 5, today: base.today, allowed: true, requiresConfirmation: true, message: '移除本次完成与经验', completionId, reward,
    growthBefore: completed.growth, growthAfter: base.growth })
  await page.goto('/adventure')
  const row = page.getByRole('article', { name: '任务：取回耳机', exact: true })
  await row.getByRole('button', { name: '取消完成', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
  expect(server.previews).toHaveLength(0)
  expect(server.envelopes).toHaveLength(1)
  expect(server.envelopes[0]).toMatchObject({ expectedVersion: 5, command: { type: 'cancelTaskCompletion', completionId } })
})

test('直接撤销结果未知时禁用重复操作，安全重试沿用原封套', async ({ page, context }) => {
  const server = await planningFixture(context, completed)
  server.saved({ ...base, version: 6 })
  server.loseNextResponse()
  await page.goto('/adventure')
  const row = page.getByRole('article', { name: '任务：取回耳机', exact: true })
  await row.getByRole('button', { name: '取消完成', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row.getByRole('button', { name: '取消完成', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(row.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
  expect(server.previews).toHaveLength(0)
})

test('直接撤销遇版本冲突只重读，再次点击才提交新封套', async ({ page, context }) => {
  const server = await planningFixture(context, completed)
  server.saved({ ...completed, version: 6 })
  server.conflictNext()
  await page.goto('/adventure')
  const row = page.getByRole('article', { name: '任务：取回耳机', exact: true })
  await row.getByRole('button', { name: '取消完成', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('数据已更新')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(server.envelopes).toHaveLength(1)
  server.saved({ ...base, version: 7 })
  await row.getByRole('button', { name: '取消完成', exact: true }).click()
  await expect(row.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1].expectedVersion).toBe(6)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
  expect(server.previews).toHaveLength(0)
})

test('一次性任务创建编辑完成、直接撤销与再次完成；刷新保持权威结果', async ({ page, context }) => {
  const server = await planningFixture(context, { ...base, version: 2, tasks: [], totalTasks: 0 })
  server.saved(base)
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建行动', exact: true }).click()
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
  await openRecordActions(card)
  await card.getByRole('button', { name: '编辑任务', exact: true }).click()
  await page.getByLabel('任务说明', { exact: true }).fill('下午去修理店')
  server.saved({ ...base, version: 4, tasks: [{ ...base.tasks[0], description: '下午去修理店' }] })
  await page.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  server.saved(completed)
  await openRecordActions(card)
  await card.getByRole('button', { name: '完成', exact: true }).click()
  await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
  expect(server.envelopes[2].command).toEqual({ type: 'completeTask', id: taskId })
  server.saved({ ...base, version: 6 })
  await card.getByRole('button', { name: '取消完成', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
  expect(server.previews).toHaveLength(0)
  expect(server.envelopes[3]).toMatchObject({ expectedVersion: 5, command: { type: 'cancelTaskCompletion', completionId } })
  server.saved({ ...completed, version: 7 })
  await openRecordActions(card)
  await card.getByRole('button', { name: '完成', exact: true }).click()
  await page.reload()
  await openRecordActions(card)
  await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
  await openRecordActions(card)
  await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(5)
})

test('周历按日读取，未来任务仍遵守服务端能力且过去只看完成事实', async ({ page, context }) => {
  const server = await planningFixture(context, base)
  await page.goto('/adventure')
  server.show({ ...base, taskRange: 'future', tasks: [{ ...base.tasks[0], title: '未来行动', plannedOn: '2026-10-21', capabilities: { ...base.tasks[0].capabilities, complete: { allowed: false, reason: '任务或相关规划已进入终态，只能查看' } } }] })
  await page.getByRole('button', { name: '选择日期 2026-10-21', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择日期 2026-10-21', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const future = page.getByRole('article', { name: '任务：未来行动' })
  await openRecordActions(future)
  await expect(future.getByRole('button', { name: '完成', exact: true })).toBeDisabled()
  server.show({ ...completed, version: base.version, taskRange: 'past', tasks: [{ ...completed.tasks[0], title: '过去完成', plannedOn: '2026-10-18', completedOn: '2026-10-19', capabilities: { ...completed.tasks[0].capabilities, cancel: later } }] })
  await page.getByRole('button', { name: '选择日期 2026-10-19', exact: true }).click()
  const past = page.getByRole('article', { name: '任务：过去完成' })
  await expect(past).toContainText('完成 10月19日')
  await expect(past.locator('.today-task-dates span').last()).toHaveAttribute('title', '2026-10-19')
  await openRecordActions(past)
  await expect(past.getByRole('button', { name: '完成', exact: true })).toHaveCount(0)
  await expect(past.getByRole('button', { name: '取消完成', exact: true })).toBeDisabled()
  expect(server.envelopes).toHaveLength(0)
})
