import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
const { snapshot, write } = database

test.describe('逾期行动的真实数据库浏览器流程', () => {
  test.skip(!localPlanningRpc, '仅运行于隔离本机数据库')
  test.beforeEach(async ({ context }) => { await database.install(context) })
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 逾期直接完成、日期回读和撤销恢复`, async ({ page }) => {
    const task = (await database.createHistoricalTask({ type: 'createTask', title: '直接补做', description: '无需改期', plannedOn: '2020-01-01', destination: '' })).result.entityId
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/adventure')
    const card = page.getByRole('article', { name: '任务：直接补做', exact: true })
    await expect(card.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
    await expect(card.locator('.today-task-dates [title]')).toHaveCount(2)
    await expect(card.locator('.today-task-dates [title]').last()).toHaveAttribute('title', (await snapshot()).today)
    expect((await snapshot()).tasks.find(item => item.id === task)).toMatchObject({ plannedOn: '2020-01-01', status: 'completed' })
    await page.reload()
    await openRecordActions(card)
    await card.getByRole('button', { name: '取消完成', exact: true }).click()
    await expect(card.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog')).toBeHidden()
    await openRecordActions(card)
    await expect(card.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
    await expect(card.locator('xpath=ancestor::section[1]').getByRole('heading')).toContainText('逾期待完成')
    expect((await snapshot('?taskRange=past')).tasks.find(item => item.id === task)).toMatchObject({ plannedOn: '2020-01-01', completedOn: null, status: 'pending' })
    expect((await snapshot()).growth).toMatchObject({ totalXp: 0, actions: 0 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
