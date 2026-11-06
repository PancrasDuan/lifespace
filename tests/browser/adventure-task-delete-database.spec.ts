import { test, expect } from './authenticated-test'
import { openRecordActions } from './adventure-record-helpers'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
test.describe('任务编辑卡片删除与终态保护', () => {
  test.skip(!localPlanningRpc, '需本机隔离数据库')
  test.beforeEach(async ({ context }) => database.install(context))
  test.afterEach(() => database.restore())
  for (const width of [1440, 390]) test(`${width}px 先处理未完成任务后达成目标`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const goal = (await database.write({ type: 'createGoal', title: '待处理目标', standards: ['标准'], destination: '' })).result.entityId
    const today = (await database.snapshot()).today
    await database.write({ type: 'createTask', title: '待删除任务', description: '', plannedOn: today, destination: goal })
    await page.goto('/adventure')
    const card = page.getByRole('article', { name: '任务：待删除任务', exact: true })
    await openRecordActions(card)
    await expect(card.getByRole('button', { name: '结束任务', exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '删除任务', exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '删除误建', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '主线与目标', exact: true }).click()
    await page.getByRole('button', { name: '目标：待处理目标', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认达成', exact: true })).toBeDisabled()
    await expect(page.getByText('请先删除未完成任务，或在编辑任务中移到其他在用目标／独立任务', { exact: true })).toBeVisible()
    await page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: '今日聚焦', exact: true }).click()
    await openRecordActions(card)
    await card.getByRole('button', { name: '编辑任务', exact: true }).click()
    await page.getByRole('button', { name: '删除任务', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认删除任务', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '确认删除任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await database.snapshot()).tasks).toHaveLength(0)
    await page.getByRole('button', { name: '主线与目标', exact: true }).click()
    await page.getByRole('button', { name: '目标：待处理目标', exact: true }).click()
    await page.getByRole('button', { name: '确认达成', exact: true }).click()
    await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await database.snapshot('?includeTerminal=true')).goals[0].status).toBe('achieved')
  })
})
