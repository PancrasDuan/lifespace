import { Temporal } from '@js-temporal/polyfill'
import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
const { snapshot, write } = database

test.describe('今日聚焦周历真实数据流程', () => {
  test.skip(!localPlanningRpc, '仅使用本机隔离数据库')
  test.beforeEach(async ({ context }) => { await database.install(context) })
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 周历、完整批次搜索、分页与今日进度`, async ({ page }) => {
    test.setTimeout(60000)
    const today = (await snapshot()).today
    const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString()
    await write({ type: 'createTask', title: '较早逾期', description: '', plannedOn: '2020-01-01', destination: '' })
    const done = (await write({ type: 'createTask', title: '今天补做完成', description: '', plannedOn: '2020-01-02', destination: '' })).result.entityId
    await write({ type: 'completeTask', id: done })
    for (let i = 0; i < 51; i++) await write({ type: 'createTask', title: `完整搜索 ${String(i).padStart(2, '0')}`, description: '', plannedOn: today, destination: '' })
    await write({ type: 'createTask', title: '明天的安排', description: '', plannedOn: tomorrow, destination: '' })
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/adventure')
    await expect(page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: '今日聚焦', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('group', { name: '任务周历' })).toBeVisible()
    await expect(page.getByRole('button', { name: `选择日期 ${today}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('1 / 53')
    await expect(page.getByRole('article', { name: '任务：较早逾期', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一页任务', exact: true }).click()
    await expect(page.getByText('第 2 页', { exact: false })).toBeVisible()
    await page.getByRole('searchbox', { name: '搜索任务' }).fill('完整搜索 50')
    await expect(page.getByRole('article', { name: '任务：完整搜索 50', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('1 / 53')
    await page.getByRole('button', { name: '下一周', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: '搜索任务' })).toHaveValue('完整搜索 50')
    await expect(page.getByRole('progressbar', { name: '今日任务进度' })).toHaveCount(0)
    await page.getByRole('button', { name: '回到今天', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索任务' }).fill('')
    if (!await page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true }).count()) await page.getByRole('button', { name: '下一周', exact: true }).click()
    await page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true }).click()
    const future = page.getByRole('article', { name: '任务：明天的安排', exact: true })
    await expect(future).toBeVisible()
    await expect(future.locator('.today-task-dates')).toBeVisible()
    await future.getByRole('button', { name: '任务详情：明天的安排', exact: true }).click()
    await expect(future.getByRole('button', { name: '完成', exact: true })).toBeDisabled()
    await expect(future).not.toContainText('安排记录')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure145-${width}.png`, fullPage: true })
  })
})
