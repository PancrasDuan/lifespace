import { test, expect } from './authenticated-test'
import { openRecordActions } from './adventure-record-helpers'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
test.describe('统一任务编辑的真实浏览器流程', () => {
  test.skip(!localPlanningRpc, '需本机隔离数据库')
  test.beforeEach(async ({ context }) => database.install(context))
  test.afterEach(() => database.restore())
  for (const width of [1440, 390]) test(`${width}px 编辑预填四字段，日期可取消且一次保存`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const goal = (await database.write({ type: 'createGoal', title: '目的目标', standards: ['标准'] })).result.entityId
    const today = (await database.snapshot()).today
    await database.write({ type: 'createTask', title: '原任务', description: '原说明', plannedOn: today, destination: goal })
    await page.goto('/adventure')
    const card = page.getByRole('article', { name: '任务：原任务', exact: true })
    await openRecordActions(card)
    await expect(card.getByRole('button', { name: '改期', exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '迁移任务', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: '编辑任务', exact: true }).click()
    await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue(today)
    await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue(goal)
    await page.getByLabel('执行日期', { exact: true }).click()
    await expect(page.getByRole('dialog', { name: '选择执行日期', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭日期选择', exact: true }).click()
    await page.getByLabel('任务名称', { exact: true }).fill('新任务')
    await page.getByLabel('任务说明', { exact: true }).fill('新说明')
    await page.getByLabel('任务归属', { exact: true }).selectOption('')
    await page.getByRole('button', { name: '保存任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const state = await database.snapshot()
    expect(state.tasks[0]).toMatchObject({ title: '新任务', description: '新说明', plannedOn: today, independent: true })
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue(today)
    await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue('')
    await page.getByLabel('任务名称', { exact: true }).fill('取消不保存')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect((await database.snapshot()).tasks).toHaveLength(1)
  })
})
