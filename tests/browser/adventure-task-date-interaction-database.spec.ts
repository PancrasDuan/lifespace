import type { Locator } from '@playwright/test'
import { test, expect, type Page } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()

// Use actual clicks and native date-segment keys; only the initial date is filled.
async function exerciseDatePicker(page: Page, form: Locator, originalDate: string) {
  const date = form.getByLabel('执行日期', { exact: true })
  const bar = form.locator('.task-date-field .lp-time-control')
  const picker = page.getByRole('dialog', { name: '选择执行日期', exact: true })
  const icon = form.getByRole('button', { name: '选择执行日期', exact: true }).locator('svg')
  await expect(date).toHaveValue(originalDate)

  // Click the empty horizontal area between the input and the calendar icon.
  const inputBox = (await date.boundingBox())!
  const barBox = (await bar.boundingBox())!
  const blankStart = inputBox.x + inputBox.width - barBox.x
  const blankEnd = barBox.width - 44
  expect(blankEnd).toBeGreaterThan(blankStart)
  await bar.click({ position: { x: (blankStart + blankEnd) / 2, y: barBox.height / 2 } })
  await expect(picker).toBeVisible()
  await picker.getByLabel('显示月份', { exact: true }).fill('2099-06')
  await picker.getByRole('button', { name: '2099-06-18', exact: true }).click()
  await expect(date).toHaveValue(originalDate)
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(date).toHaveValue(originalDate)

  // Clicking the visible icon opens the same date-only picker.
  await icon.click()
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: '关闭日期选择', exact: true }).click()

  await date.fill('2099-06-15')
  // In en-US the first native segment is month; ArrowRight selects day.
  await date.click({ position: { x: 16, y: 18 } })
  await expect(picker).toBeVisible()
  await date.press('ArrowRight')
  await date.press('ArrowUp')
  await expect(date).toHaveValue('2099-06-16')
  await expect(picker.getByLabel('显示月份', { exact: true })).toHaveValue('2099-06')
  await expect(picker.getByRole('button', { name: '2099-06-16', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await picker.getByRole('button', { name: '2099-06-18', exact: true }).click()
  await expect(date).toHaveValue('2099-06-16')
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(date).toHaveValue('2099-06-16')
  await icon.click()
  await expect(picker.getByRole('button', { name: '2099-06-16', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await picker.getByRole('button', { name: '2099-06-19', exact: true }).click()
  await picker.getByRole('button', { name: '确认日期', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(date).toHaveValue('2099-06-19')
}

test.describe('任务日期控件的真实点击、分段键盘与保存', () => {
  test.use({ locale: 'en-US' })
  test.skip(!localPlanningRpc, '需本机隔离数据库')
  test.beforeEach(async ({ context }) => database.install(context))
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 新建和编辑共用日期交互，取消不写入，确认后保存`, async ({ page }) => {
    test.setTimeout(30_000)
    await page.setViewportSize({ width, height: 900 })
    const today = (await database.snapshot()).today
    const taskId = (await database.write({ type: 'createTask', title: '日期交互任务', description: '保留内容', plannedOn: today, destination: '' })).result.entityId
    const before = await database.snapshot()
    await page.goto('/adventure')
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    const form = page.getByRole('dialog').filter({ has: page.getByLabel('任务名称', { exact: true }) })
    await exerciseDatePicker(page, form, today)
    await form.getByRole('button', { name: '取消', exact: true }).click()
    expect(await database.snapshot()).toEqual(before)

    const task = page.getByRole('article', { name: '任务：日期交互任务', exact: true })
    await task.getByRole('button', { name: '任务详情：日期交互任务', exact: true }).click()
    await task.getByRole('button', { name: '编辑任务', exact: true }).click()
    await exerciseDatePicker(page, form, today)
    await form.getByRole('button', { name: '保存任务', exact: true }).click()
    await expect(form).toBeHidden()
    expect((await database.snapshot('?taskRange=future')).tasks.find(item => item.id === taskId)).toMatchObject({ title: '日期交互任务', description: '保留内容', plannedOn: '2099-06-19', status: 'pending' })
  })
})
