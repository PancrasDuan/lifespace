import { test, expect } from './authenticated-test'
import { allowed, goalId, planningFixture, withGoal } from './adventure-fixture'
import { openRecordActions } from './adventure-record-helpers'

for (const width of [390, 1440]) test(`${width}px 目标更多操作可普通点击且不被排序按钮遮挡`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 844 })
  const initial = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, end: allowed } }] }
  const server = await planningFixture(context, initial)
  server.preview({ version: initial.version, today: initial.today, allowed: true, requiresConfirmation: true,
    operation: 'endGoal', entityId: goalId, title: '五公里', message: '已有完成及奖励保留',
    stoppingGoals: [], stoppingTasks: [], preservedCompletedTasks: 0, preservedAchievedGoals: 0 })
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  const card = page.locator('.adventure-proto-goal').first()
  await openRecordActions(card)
  await page.screenshot({ path: `.cache/goal-actions-${width}.png`, fullPage: true })
  await card.getByRole('button', { name: '结束目标', exact: true }).click({ timeout: 5000 })
  await expect(page.getByRole('dialog', { name: '确认结束目标', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  expect(server.previews).toHaveLength(1)
})
