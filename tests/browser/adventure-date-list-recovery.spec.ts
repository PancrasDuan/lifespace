import { test, expect } from './authenticated-test'
import { allowed, emptyPlanning, planningFixture } from './adventure-fixture'
import type { PlanningTask } from '../../src/shared/adventure-planning'

const today = emptyPlanning.today
const tomorrow = '2026-10-21'
const task = (index: number, title = `任务 ${index}`): PlanningTask => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title, description: '可读说明', plannedOn: today,
  status: 'pending', completedOn: null, completionId: null, completionOrigin: null, reward: null,
  goalId: null, goalTitle: null, independent: true, overdue: false, arrangements: [], totalArrangements: 0,
  progress: { completed: 0, total: 1, ratio: 0 }, capabilities: { complete: allowed, edit: allowed },
})
const workspace = { ...emptyPlanning, capabilities: { ...emptyPlanning.capabilities, createTask: allowed } }

test('第二批加载失败不展示部分结果，显式重读后搜索覆盖完整任务', async ({ page, context }) => {
  await planningFixture(context, workspace)
  const tasks = Array.from({ length: 51 }, (_, index) => task(index, index === 50 ? '最后一批命中' : `普通任务 ${index}`))
  let fail = true
  await page.route('**/api/adventure/tasks/list', async route => {
    const input = route.request().postDataJSON() as { date: string; scope: string; page: number }
    if (input.page === 2 && fail) return route.fulfill({ status: 503, json: { error: { message: '第二批暂不可用' } } })
    await route.fulfill({ json: { version: 0, today, ...input, pageSize: 10, total: 51, progress: { completed: 0, total: 51, ratio: 0 }, tasks: tasks.slice((input.page - 1) * 10, input.page * 10) } })
  })
  await page.goto('/adventure')
  await expect(page.getByRole('alert')).toContainText('第二批暂不可用')
  await expect(page.getByRole('article', { name: /^任务：/ })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: '重新读取任务', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('最后一批命中')
  await expect(page.getByRole('article', { name: '任务：最后一批命中', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('0 / 51')
})

test('切换日期取消旧读取，迟到结果不能覆盖新日期，搜索词保留', async ({ page, context }) => {
  await planningFixture(context, workspace)
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/adventure/tasks/list', async route => {
    const input = route.request().postDataJSON() as { date: string; scope: string; page: number }
    if (input.date === today) { requested = true; await pending }
    const tasks = [task(1, input.date === today ? '旧日期任务' : '新日期任务')]
    await route.fulfill({ json: { version: 0, today, ...input, pageSize: 10, total: 1, progress: { completed: 0, total: 1, ratio: 0 }, tasks } }).catch(() => {})
  })
  await page.goto('/adventure')
  await expect.poll(() => requested).toBe(true)
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('日期')
  await page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true }).click()
  await expect(page.getByRole('article', { name: '任务：新日期任务', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('article', { name: '任务：旧日期任务', exact: true })).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: '搜索任务' })).toHaveValue('日期')
  await expect(page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('详情展开与收起保留当前任务在视口的位置', async ({ page, context }) => {
  const tasks = Array.from({ length: 6 }, (_, index) => task(index))
  tasks[5].description = '详细说明。'.repeat(400)
  await planningFixture(context, { ...workspace, tasks, totalTasks: tasks.length, taskProgress: { completed: 0, total: tasks.length, ratio: 0 } })
  await page.setViewportSize({ width: 390, height: 750 })
  await page.goto('/adventure')
  const summary = page.getByRole('button', { name: '任务详情：任务 5', exact: true })
  await summary.scrollIntoViewIfNeeded()
  const before = (await summary.boundingBox())!.y
  const row = page.getByRole('article', { name: '任务：任务 5', exact: true })
  await row.getByRole('button', { name: '展开任务详情 任务 5', exact: true }).click()
  await expect(row.getByRole('button', { name: '收起任务详情 任务 5', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(row.locator('.today-task-expand svg')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)')
  expect(Math.abs((await summary.boundingBox())!.y - before)).toBeLessThan(2)
  await row.getByRole('button', { name: '收起任务详情 任务 5', exact: true }).click()
  expect(Math.abs((await summary.boundingBox())!.y - before)).toBeLessThan(2)
})

test('验收反馈：单条过去完成记录展开收起时卡片宽度稳定', async ({ page, context }) => {
  const past = { ...task(1, '昨天完成的散步'), status: 'completed' as const, plannedOn: '2026-10-19', completedOn: '2026-10-19',
    description: '本机临时数据库样例，可自由创建、编辑、完成、撤销和删除；不会写入真实账户。' }
  await planningFixture(context, { ...workspace, tasks: [past], totalTasks: 1 })
  await page.setViewportSize({ width: 390, height: 950 })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '选择日期 2026-10-19', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^当天已完成/ })).toBeVisible()
  const row = page.getByRole('article', { name: '任务：昨天完成的散步', exact: true })
  const copy = row.getByRole('button', { name: '任务详情：昨天完成的散步', exact: true })
  await copy.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  const before = (await row.boundingBox())!
  await copy.click()
  await expect(row.getByText(past.description, { exact: true })).toBeVisible()
  expect((await row.boundingBox())!.width).toBeCloseTo(before.width, 1)
  await row.getByRole('button', { name: '收起任务详情 昨天完成的散步', exact: true }).click()
  expect((await row.boundingBox())!.width).toBeCloseTo(before.width, 1)
})
