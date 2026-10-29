import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'

const achievements = [1, 10, 40, 100, 1, 3, 10].map((threshold, index) => ({
  id: `${index < 4 ? 'actions' : 'goals'}_${threshold}`,
  label: `成就 ${index + 1}`, threshold, count: 0, remaining: threshold, unlocked: false,
}))
const state: PlanningPage = {
  ...withGoal,
  capabilities: { ...withGoal.capabilities, createTask: allowed },
  growth: { ...withGoal.growth, level: 2, totalXp: 26, actions: 12, achievedGoals: 2, remaining: 14, achievements },
}
const growth = { version: state.version + 1, growth: { ...state.growth, totalXp: 28, achievements }, items: [], total: 0, pageSize: 10, nextCursor: null }

for (const fail of [false, true]) test(`三个标签共享顶部区域：成长数据${fail ? '读取失败' : '延迟更新'}时保持位置`, async ({ page, context }) => {
  await planningFixture(context, state)
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const requested = new Promise<void>(resolve => { started = resolve })
  await context.route('**/api/adventure/growth**', async route => {
    started()
    await held
    if (fail) await route.fulfill({ status: 503, json: { error: { message: '读取失败' } } })
    else await route.fulfill({ json: growth })
  })
  await page.setViewportSize({ width: 817, height: 905 })
  await page.goto('/adventure')
  const summary = page.getByRole('region', { name: '经验概览', exact: true })
  const tabs = page.getByRole('navigation', { name: '冒险页面', exact: true })
  await expect(summary).toContainText('累计经验26')
  await summary.evaluate(element => { (window as Window & { sharedSummary?: Element }).sharedSummary = element })
  const top = (await tabs.boundingBox())!.y
  await tabs.getByRole('button', { name: '主线与目标', exact: true }).click()
  expect((await tabs.boundingBox())!.y).toBeCloseTo(top, 0)
  await tabs.getByRole('button', { name: '成长记录', exact: true }).click()
  await requested
  try {
    await expect(summary).toBeVisible({ timeout: 1000 })
    await expect(summary).toContainText('累计经验26')
    await expect(summary).toContainText('正在更新')
    expect(await summary.evaluate(element => element === (window as Window & { sharedSummary?: Element }).sharedSummary)).toBe(true)
    expect((await tabs.boundingBox())!.y).toBeCloseTo(top, 0)
  } finally { release() }
  if (fail) {
    await expect(summary).toContainText('暂未更新')
    await expect(summary).toContainText('累计经验26')
  } else {
    await expect(summary).toContainText('累计经验28')
    await expect(summary).not.toContainText('正在更新')
  }
  expect((await tabs.boundingBox())!.y).toBeCloseTo(top, 0)
  await tabs.getByRole('button', { name: '今天', exact: true }).click()
  await expect(summary).toBeVisible()
  expect((await tabs.boundingBox())!.y).toBeCloseTo(top, 0)
})

test('直达成长页时保留顶部占位，读取成长记录前不请求规划接口', async ({ page, context }) => {
  await planningFixture(context, state)
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const requested = new Promise<void>(resolve => { started = resolve })
  let planningRequests = 0
  await context.route('**/api/adventure?**', async route => { planningRequests++; await route.fallback() })
  await context.route('**/api/adventure/growth**', async route => { started(); await held; await route.fulfill({ json: growth }) })
  await page.goto('/adventure?view=growth')
  await requested
  const summary = page.getByRole('region', { name: '经验概览', exact: true })
  try {
    await expect(summary).toBeVisible({ timeout: 1000 })
    await expect(summary).toContainText('正在读取经验概览')
    expect(planningRequests).toBe(0)
  } finally { release() }
  await expect(summary).toContainText('累计经验28')
  expect(planningRequests).toBe(0)
})

test('首次读取规划失败时经验概览提示失败，重试成功后恢复', async ({ page, context }) => {
  const server = await planningFixture(context, state)
  server.failNextQuery()
  await page.goto('/adventure')
  const summary = page.getByRole('region', { name: '经验概览', exact: true })
  await expect(summary).toContainText('经验概览暂时无法读取')
  await expect(summary).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '关闭错误提示', exact: true }).click()
  await expect(summary).toContainText('经验概览暂时无法读取')
  await expect(summary).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(summary).toContainText('累计经验26')
})
