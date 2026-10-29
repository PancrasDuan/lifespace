import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, goalId, planningFixture, withGoal } from './adventure-fixture'
import type { LifecyclePreview, PlanningPage } from '../../src/shared/adventure-planning'

const initial: PlanningPage = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, end: allowed } }] }
const preview: LifecyclePreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true,
  operation: 'endGoal', entityId: goalId, title: '五公里', message: '结束后不可恢复，已有完成及奖励保留。',
  stoppingGoals: [], stoppingTasks: [], preservedCompletedTasks: 0, preservedAchievedGoals: 0 }
const openEnd = async (page: import('@playwright/test').Page) => {
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  await openRecordActions(page.locator('.adventure-proto-goal').first())
  await page.getByRole('button', { name: '结束目标', exact: true }).click()
}

test('结束结果未知只重试原封套，成功后查询失败只重读', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  server.saved({ ...initial, version: 3, goals: [], totalGoals: 0 })
  await openEnd(page)
  server.loseNextResponse()
  await page.getByRole('button', { name: '确认结束目标', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认结束目标', exact: true })).toBeDisabled()
  server.failNextQuery()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[0]).toEqual(server.envelopes[1])
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
})

test('结束遇到409必须重新预览，不能沿用旧影响确认', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  await openEnd(page)
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.getByRole('button', { name: '确认结束目标', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认结束目标', exact: true })).toBeDisabled()
  expect(server.envelopes).toHaveLength(1)
  server.preview({ ...preview, version: 3, stoppingTasks: [{ id: goalId, title: '新增待停任务', plannedOn: initial.today }] })
  await page.getByRole('button', { name: '重新预览', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('新增待停任务')
  server.saved({ ...initial, version: 4, goals: [], totalGoals: 0 })
  await page.getByRole('button', { name: '确认结束目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(server.envelopes[1].expectedVersion).toBe(3)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})

test('终态偏好按已验证账户读取，账户切换不沿用其他账户设置', async ({ page, context }) => {
  const first = '00000000-0000-4000-8000-000000000001'
  const second = '00000000-0000-4000-8000-000000000066'
  let owner = first
  await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: owner, email: 'demo@example.com' } } }))
  await context.route('**/api/adventure**', route => {
    const includeTerminal = new URL(route.request().url()).searchParams.get('includeTerminal') === 'true'
    return route.fulfill({ json: { ...initial, includeTerminal } })
  })
  await page.goto('/adventure?view=planning')
  const toggle = page.getByLabel('显示已达成／已结束', { exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await page.reload()
  await expect(toggle).toBeChecked()
  owner = second
  await page.evaluate(id => localStorage.setItem('test-auth-owner', id), second)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  owner = first
  await page.evaluate(id => localStorage.setItem('test-auth-owner', id), first)
  await page.reload()
  await expect(toggle).toBeChecked()
})

test('终态偏好存储不可用仍可读取和切换，明确提示刷新不保留', async ({ page, context }) => {
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('lifespace.adventure.terminal.')) throw new DOMException('Denied', 'SecurityError')
      return get.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('lifespace.adventure.terminal.')) throw new DOMException('Denied', 'SecurityError')
      return set.call(this, key, value)
    }
  })
  await context.route('**/api/adventure**', route => route.fulfill({ json: { ...initial,
    includeTerminal: new URL(route.request().url()).searchParams.get('includeTerminal') === 'true' } }))
  await page.goto('/adventure?view=planning')
  await page.getByLabel('显示已达成／已结束', { exact: true }).check()
  await expect(page.getByText('终态显示偏好未保存；本页仍可查看，刷新后使用默认设置。')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('显示已达成／已结束', { exact: true })).not.toBeChecked()
})
