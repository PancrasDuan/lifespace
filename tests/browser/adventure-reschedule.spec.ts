import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'

const id = '00000000-0000-4000-8000-000000000061'
const initial: PlanningPage = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed }, totalTasks: 1,
  tasks: [{ id, title: '统一编辑恢复', description: '原说明', plannedOn: withGoal.today, rescheduleMin: withGoal.today, arrangements: [], totalArrangements: 0,
    status: 'pending', completedOn: null, completionId: null, reward: null, completionOrigin: null,
    goalId: null, goalTitle: null, mainlineName: '独立区', independent: true, overdue: false,
    progress: { completed: 0, total: 1, ratio: 0 }, capabilities: { edit: allowed, delete: allowed } }] }
const open = async (page: import('@playwright/test').Page) => {
  await page.goto('/adventure')
  await openRecordActions(page.locator('.adventure-proto-task').first())
  await page.getByRole('button', { name: '编辑任务', exact: true }).click()
  await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue(initial.today)
  await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue('')
}

test('统一编辑修改日期与说明后取消，不发送命令', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  await open(page)
  await page.getByLabel('执行日期', { exact: true }).fill('2099-02-01')
  await page.getByLabel('任务说明', { exact: true }).fill('取消的说明')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes).toHaveLength(0)
})

test('统一编辑未知结果沿用四字段原封套，成功后读取失败只重读', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3 })
  await open(page)
  await page.getByLabel('执行日期', { exact: true }).fill('2099-02-01')
  await page.getByLabel('任务说明', { exact: true }).fill('新说明')
  server.loseNextResponse()
  await page.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  server.failNextQuery()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
  expect(server.envelopes[0].command).toEqual({ type: 'editTask', id, title: '统一编辑恢复', description: '新说明', plannedOn: '2099-02-01', destination: '' })
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建行动', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
})

test('统一编辑冲突后先读新版本，用户再次保存才发新封套', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  await open(page)
  await page.getByLabel('执行日期', { exact: true }).fill('2099-02-01')
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('再次确认')
  expect(server.envelopes).toHaveLength(1)
  await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue('2099-02-01')
  server.saved({ ...initial, version: 4 })
  await page.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1].expectedVersion).toBe(3)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})
