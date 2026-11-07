import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningTask } from '../../src/shared/adventure-planning'

const task: PlanningTask = {
  id: '00000000-0000-4000-8000-000000000140', title: '整理书桌和工作区', description: '先整理眼前的一小块。',
  plannedOn: '2026-10-19', rescheduleMin: withGoal.today, independent: true, goalId: null, goalTitle: null, mainlineName: '独立区',
  status: 'pending', completedOn: null, completionId: null, completionOrigin: null, reward: null, overdue: true,
  progress: { completed: 0, total: 1, ratio: 0 }, arrangements: [], totalArrangements: 0,
  capabilities: { complete: allowed, edit: allowed, delete: allowed },
}

// Approved A prototype: these controls and type/spacing values were lost when
// Today reused the older generic record. Exercise the real page and stylesheet.
for (const width of [1440, 390]) test(`${width}px 今日聚焦保留 A 原型的行内操作和视觉层次`, async ({ page, context }) => {
  await planningFixture(context, { ...withGoal, tasks: [task], totalTasks: 1, taskProgress: { completed: 0, total: 1, ratio: 0 },
    capabilities: { ...withGoal.capabilities, createTask: allowed } })
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/adventure')
  const row = page.getByRole('article', { name: `任务：${task.title}`, exact: true })
  const edit = row.getByRole('button', { name: '编辑任务', exact: true })
  await expect(edit).toBeVisible()
  const complete = row.getByRole('button', { name: '完成', exact: true })
  await expect(complete).toBeEnabled()
  await expect(complete).toHaveCSS('height', '24px')
  await complete.hover()
  await expect(complete).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const group = page.locator('.today-task-group h3')
  await expect(group).toHaveText('逾期待完成1')
  await expect(group).toHaveCSS('font-size', '12px')
  await expect(row.locator('.today-task-copy strong')).toHaveCSS('font-size', '13px')
  await expect(row.locator('.today-task-copy strong')).toHaveCSS('font-weight', '500')
  await expect(row.locator('.today-task-dates')).toHaveText('计划 10月19日')
  await expect(page.getByRole('button', { name: `选择日期 ${withGoal.today}`, exact: true })).toContainText('今天')
  await expect(page.locator('.today-calendar')).toHaveCSS('padding', width > 720 ? '18px 20px' : '14px 12px')
  await expect(page.locator('.today-list')).toHaveCSS('padding', width > 720 ? '22px' : '16px 14px')
  await expect(page.locator('.today-search')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.today-search')).toHaveCSS('height', '39px')
  // Font fallback in CI can give the native input a 14px line box. The outer
  // control must retain the approved size across those platform metrics.
  await page.getByRole('searchbox', { name: '搜索任务' }).evaluate(input => { if (input instanceof HTMLInputElement) input.style.lineHeight = '14px' })
  await expect(page.locator('.today-search')).toHaveCSS('height', '39px')
  await page.getByRole('searchbox', { name: '搜索任务' }).evaluate(input => { if (input instanceof HTMLInputElement) input.style.lineHeight = '' })
  await expect(page.getByRole('progressbar', { name: '今日任务进度', exact: true })).toHaveCSS('height', '5px')
  await expect(page.locator('.today-list-heading p')).toHaveCSS('line-height', 'normal')
  await expect(page.getByRole('button', { name: '上一周', exact: true })).toHaveCSS('border-top-width', '0px')
  const otherDay = page.getByRole('button', { name: '选择日期 2026-10-19', exact: true })
  await otherDay.hover()
  await expect(otherDay).toHaveCSS('background-color', 'rgb(247, 249, 245)')
  const selectedDay = page.getByRole('button', { name: `选择日期 ${withGoal.today}`, exact: true })
  await selectedDay.hover()
  await expect(selectedDay).toHaveCSS('background-color', 'rgb(230, 240, 228)')
  const expand = row.getByRole('button', { name: `展开任务详情 ${task.title}`, exact: true })
  await expect(expand).toHaveCSS('height', '28px')
  await expand.click()
  await expect(row.locator('.today-task-details')).toHaveText(task.description)
  await expect(row.locator('.plain-facts, .record-actions')).toHaveCount(0)
  await expect(row.getByRole('button', { name: `收起任务详情 ${task.title}`, exact: true })).toHaveAttribute('aria-expanded', 'true')
  await edit.click()
  const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true })
  await expect(dialog.getByLabel('任务名称', { exact: true })).toHaveValue(task.title)
  const remove = dialog.getByRole('button', { name: '删除任务', exact: true })
  await expect(remove).toHaveCSS('color', 'rgb(154, 85, 80)')
  await expect(remove).toHaveCSS('padding', '9px 13px')
  await expect(dialog.getByRole('button', { name: '保存任务', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(dialog.getByRole('button', { name: '关闭弹窗', exact: true })).toHaveCSS('min-height', '0px')
  const date = dialog.getByLabel('执行日期', { exact: true }), trigger = dialog.getByRole('button', { name: '选择执行日期', exact: true })
  const controlBox = (await dialog.locator('.lp-time-control').boundingBox())!, inputBox = (await date.boundingBox())!, triggerBox = (await trigger.boundingBox())!
  expect(inputBox.x).toBeGreaterThan(controlBox.x)
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(controlBox.x + controlBox.width)
  await expect(date).toHaveCSS('border-top-width', '0px')
  await expect(trigger).toHaveCSS('border-top-width', '0px')
  const removeBox = (await remove.boundingBox())!, cancelBox = (await dialog.getByRole('button', { name: '取消', exact: true }).boundingBox())!
  expect(cancelBox.x - removeBox.x - removeBox.width).toBeGreaterThan(12)
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
