import { Temporal } from '@js-temporal/polyfill'
import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()

test.describe('提前完成未来任务的真实日期与直接撤销', () => {
  test.skip(!localPlanningRpc, '仅使用本机隔离数据库')
  test.beforeEach(async ({ context }) => { await database.install(context) })
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 提前完成、刷新、当天撤销及原日期再次完成`, async ({ page }) => {
    test.setTimeout(60000)
    const today = (await database.snapshot()).today
    const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString()
    const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString()
    const goal = (await database.write({ type: 'createGoal', title: '提前完成目标', standards: ['行动已完成'] })).result.entityId
    await database.write({ type: 'createTask', title: '明天提前完成', description: '今天实际执行', plannedOn: tomorrow, destination: goal })
    await database.write({ type: 'createTask', title: '今天保留待办', description: '', plannedOn: today, destination: '' })
    await database.createHistoricalTask({ type: 'createTask', title: '昨天完成只读', description: '', plannedOn: yesterday, destination: '' }, yesterday)
    const previews: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/adventure/preview') previews.push(request.url()) })
    const row = page.getByRole('article', { name: '任务：明天提前完成', exact: true })
    const chooseTomorrow = async () => {
      if (!await page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true }).count()) await page.getByRole('button', { name: '下一周', exact: true }).click()
      await page.getByRole('button', { name: `选择日期 ${tomorrow}`, exact: true }).click()
    }
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/adventure')
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('0 / 1')
    await chooseTomorrow()
    await expect(row.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
    await page.screenshot({ path: `.cache/adventure185-future-${width}.png`, fullPage: true })
    await row.getByRole('button', { name: '完成', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(row).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(row.getByRole('button', { name: '取消完成', exact: true })).toBeEnabled()
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('1 / 2')
    await expect(row.locator('.today-task-dates span').first()).toHaveAttribute('title', tomorrow)
    await expect(row.locator('.today-task-dates span').last()).toHaveAttribute('title', today)
    expect((await database.snapshot(`?goalId=${goal}`)).goalDetail!.goal.progress).toEqual({ completed: 1, total: 1, ratio: 1 })
    await page.screenshot({ path: `.cache/adventure185-completed-${width}.png`, fullPage: true })
    await row.getByRole('button', { name: '取消完成', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('0 / 1')
    expect((await database.growth()).growth).toMatchObject({ totalXp: 1, actions: 1 })
    await chooseTomorrow()
    await expect(row.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
    await row.getByRole('button', { name: '完成', exact: true }).click()
    await expect(row).toHaveCount(0)
    await page.getByRole('button', { name: '回到今天', exact: true }).click()
    await expect(row.getByRole('button', { name: '取消完成', exact: true })).toBeEnabled()
    expect((await database.growth()).growth).toMatchObject({ totalXp: 2, actions: 2 })
    if (!await page.getByRole('button', { name: `选择日期 ${yesterday}`, exact: true }).count()) await page.getByRole('button', { name: '上一周', exact: true }).click()
    await page.getByRole('button', { name: `选择日期 ${yesterday}`, exact: true }).click()
    await expect(page.getByRole('article', { name: '任务：昨天完成只读', exact: true }).getByRole('button', { name: '取消完成', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(previews).toEqual([])
  })
})
