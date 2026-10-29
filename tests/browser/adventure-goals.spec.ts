import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal, goalId } from './adventure-fixture'
import type { GoalAchievementPreview, PlanningPage } from '../../src/shared/adventure-planning'

const initial: PlanningPage = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed },
  goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, achieve: allowed } }] }
const reward = (coefficient: number, count = 0) => ({ amount: count === 0 ? 1 : coefficient,
  calculation: { type: 'goal_actions' as const, actionIds: count === 0 ? [] : [goalId], count, coefficient, fallback: count === 0 } })
const preview: GoalAchievementPreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true, operation: 'achieveGoal',
  goalId, title: '五公里', standards: ['连续跑完五公里'], message: '需要继续的任务请先迁出，达成不可撤销', stoppingTasks: [], rewards: [reward(1), reward(2), reward(3)] }
const achieved: PlanningPage = { ...initial, version: 3, goals: [], totalGoals: 0,
  goalDetail: { goal: { ...initial.goals[0], status: 'achieved', focused: false, terminatedAt: '2026-10-22T00:00:00Z',
    achievement: { id: goalId, occurredOn: initial.today, reflection: '', reward: reward(1) },
    capabilities: { edit: later, createTask: later, achieve: later, focus: later } }, tasks: [], taskPage: 1, totalTasks: 0 },
  growth: { ...initial.growth, totalXp: 1, progress: 1, remaining: 19, achievedGoals: 1 } }

test('达成结果未知安全重试同封套，成功而读取失败只重试查询', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  server.saved(achieved)
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  await page.getByRole('button', { name: '确认达成', exact: true }).click()
  server.loseNextResponse()
  await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '目标：五公里', exact: true })).toHaveAttribute('aria-disabled', 'true')
  server.failNextQuery()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('操作已成功')
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
  await page.getByRole('button', { name: '查看达成结果', exact: true }).click()
  await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
})

test('达成409后必须重新预览，不静默替换奖励或自动提交', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  await page.getByRole('button', { name: '确认达成', exact: true }).click()
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认达成并入账', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('数据已变化')
  expect(server.envelopes).toHaveLength(1)
  server.preview({ ...preview, version: 3, rewards: [reward(1, 1), reward(2, 1), reward(3, 1)] })
  await page.getByRole('button', { name: '重新预览达成', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认达成并入账', exact: true })).toBeEnabled()
  await page.getByLabel('成就感评价', { exact: true }).selectOption('2')
  await expect(page.getByRole('dialog')).toContainText('目标奖励：2 点经验')
  server.saved({ ...achieved, version: 4 })
  await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
  await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
  expect(server.envelopes[1]).toMatchObject({ expectedVersion: 3, command: { type: 'achieveGoal', coefficient: 2 } })
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})

test('达成后切到今天再查看结果会返回规划并展开冻结结果', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(preview)
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  await page.getByRole('button', { name: '确认达成', exact: true }).click()
  server.saved(achieved)
  await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
  const details = page.getByRole('region', { name: '目标详情', exact: true })
  await expect(details).toContainText('已达成 · 结果已冻结')
  const navigation = page.getByRole('navigation', { name: '冒险页面', exact: true })
  await navigation.getByRole('button', { name: '今天', exact: true }).click()
  await expect(navigation.getByRole('button', { name: '今天', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: '查看达成结果', exact: true }).click()
  await expect(navigation.getByRole('button', { name: '主线与目标', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(details).toContainText('已达成 · 结果已冻结')
  expect(server.envelopes).toHaveLength(1)
})


test('永久链接首次读取失败时能退出目标查询，也能重试恢复详情', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.failNextQuery()
  await page.goto(`/adventure?goalId=${goalId}`)
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  const exited = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/adventure')
  await page.getByRole('button', { name: '返回冒险', exact: true }).click()
  expect(new URL((await exited).url()).searchParams.has('goalId')).toBe(false)
  await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  server.failNextQuery()
  await page.goto(`/adventure?goalId=${goalId}`)
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('五公里')
  expect(server.envelopes).toHaveLength(0)
})
