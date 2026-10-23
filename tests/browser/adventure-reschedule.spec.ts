import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage, ReschedulePreview } from '../../src/shared/adventure-planning'
const id = '00000000-0000-4000-8000-000000000061'
const initial: PlanningPage = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed }, totalTasks: 1,
  tasks: [{ id, title: '改期恢复', description: '', plannedOn: withGoal.today, rescheduleMin: withGoal.today, arrangements: [], totalArrangements: 0,
    status: 'pending', completedOn: null, completionId: null, reward: null, completionOrigin: null,
    goalId: null, goalTitle: null, mainlineName: '独立区', independent: true, overdue: false,
    progress: { completed: 0, total: 1, ratio: 0 }, capabilities: { reschedule: allowed } }] }
const preview: ReschedulePreview = { version: initial.version, today: initial.today, allowed: true, requiresConfirmation: true,
  operation: 'rescheduleTask', taskId: id, title: '改期恢复', oldPlannedOn: initial.today, newPlannedOn: '2099-01-01', sourceEventId: id, message: '保留原安排' }
const open = async (page: import('@playwright/test').Page) => {
  await page.goto('/adventure')
  await openRecordActions(page.locator('.adventure-proto-task').first())
  await page.getByRole('button', { name: '改期', exact: true }).click()
  await page.getByLabel('新的执行日期').fill('2099-01-01')
  await page.getByRole('button', { name: '预览改期', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeEnabled()
}
test('改期未知结果保留原封套；成功后读取失败只重读', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  server.saved({ ...initial, version: 3, tasks: [], totalTasks: 0 })
  await open(page)
  server.loseNextResponse()
  await page.getByRole('button', { name: '确认改期', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  await expect(page.getByLabel('新的执行日期')).toBeDisabled()
  server.failNextQuery()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[0]).toEqual(server.envelopes[1])
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
})
test('改期409后旧预览不可确认，重新预览并确认才使用新版本', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  await open(page)
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.getByRole('button', { name: '确认改期', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeDisabled()
  server.preview({ ...preview, version: 3 })
  await page.getByRole('button', { name: '预览改期', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeEnabled()
  server.saved({ ...initial, version: 4, tasks: [], totalTasks: 0 })
  await page.getByRole('button', { name: '确认改期', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes[1].expectedVersion).toBe(3)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})
test('修改日期后旧预览立即失效，取消无命令写入', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  await open(page)
  await page.getByLabel('新的执行日期').fill('2099-02-01')
  await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(server.envelopes).toHaveLength(0)
})
