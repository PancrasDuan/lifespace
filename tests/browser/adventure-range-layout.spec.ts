import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage, PlanningTask } from '../../src/shared/adventure-planning'

const task = (id: string, title: string): PlanningTask => ({
  id, title, description: '', plannedOn: withGoal.today, rescheduleMin: withGoal.today,
  independent: true, goalId: null, goalTitle: null, mainlineName: '独立区', status: 'pending', completedOn: null, completionId: null,
  completionOrigin: null, reward: null, overdue: false, progress: { completed: 0, total: 1, ratio: 0 }, arrangements: [], totalArrangements: 0,
  capabilities: { complete: allowed, edit: allowed, migrate: allowed, reschedule: allowed, end: allowed, delete: allowed },
})
const today: PlanningPage = {
  ...withGoal,
  capabilities: { ...withGoal.capabilities, createTask: allowed },
  tasks: [task('00000000-0000-4000-8000-000000000056', '整理本周计划'), task('00000000-0000-4000-8000-000000000057', '散步半小时')],
  totalTasks: 2, taskProgress: { completed: 0, total: 2, ratio: 0 },
}
const future: PlanningPage = { ...today, taskRange: 'future', tasks: [], totalTasks: 0, taskProgress: { completed: 0, total: 0, ratio: null } }

test('切换到空的未来任务时保留筛选器在视口中的位置', async ({ page, context }) => {
  const server = await planningFixture(context, today)
  await page.setViewportSize({ width: 817, height: 905 })
  await page.goto('/adventure')
  const filter = page.getByRole('group', { name: '任务日期范围' })
  await expect(page.getByRole('article', { name: '任务：整理本周计划' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  const before = (await filter.boundingBox())!.y
  server.show(future)
  await filter.getByRole('button', { name: '未来', exact: true }).click()
  await expect(filter.getByRole('button', { name: '未来', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(Math.abs((await filter.boundingBox())!.y - before)).toBeLessThan(2)
  const section = page.locator('.adventure-proto-task-section')
  await expect(section).toHaveAttribute('style', /min-height/)
  const beforeResize = (await section.boundingBox())!.height
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.setViewportSize({ width: 817, height: 875 })
  await expect.poll(async () => (await section.boundingBox())!.height).toBeLessThan(beforeResize - 20)
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0)
  const reserved = (await section.boundingBox())!.height
  await page.evaluate(() => window.scrollBy(0, -40))
  await expect.poll(async () => (await section.boundingBox())!.height).toBeLessThan(reserved - 30)
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore - 40, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(section).not.toHaveAttribute('style', /min-height/)
})
