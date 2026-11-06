import { Temporal } from '@js-temporal/polyfill'
import { test, expect } from './authenticated-test'
import { openRecordActions } from './adventure-record-helpers'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()

test.describe('今日聚焦评审修复的真实数据流程', () => {
  test.skip(!localPlanningRpc, '需本机隔离数据库')
  test.beforeEach(async ({ context }) => database.install(context))
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 从目标详情新建仍默认今天和独立任务，编辑保留归属`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const today = (await database.snapshot()).today
    const goal = (await database.write({ type: 'createGoal', title: '原目标', standards: ['标准'], destination: '' })).result.entityId
    await database.write({ type: 'createTask', title: '原归属任务', description: '原说明', plannedOn: today, destination: goal })
    await page.goto('/adventure')
    await page.getByRole('button', { name: '主线与目标', exact: true }).click()
    await page.getByRole('button', { name: '目标：原目标', exact: true }).click()
    await openRecordActions(page.locator('.adventure-proto-goal').first())
    await page.getByRole('button', { name: '添加任务', exact: true }).click()
    await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('任务说明', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('执行日期', { exact: true })).toHaveValue(today)
    await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue('')
    await page.getByLabel('任务名称', { exact: true }).fill('目标入口的独立任务')
    await page.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await database.snapshot()).tasks.find(item => item.title === '目标入口的独立任务')).toMatchObject({ independent: true, goalId: null, plannedOn: today })
    await page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: '今日聚焦', exact: true }).click()
    const task = page.getByRole('article', { name: '任务：原归属任务', exact: true })
    await task.getByRole('button', { name: '任务详情：原归属任务', exact: true }).click()
    await task.getByRole('button', { name: '编辑任务', exact: true }).click()
    await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue(goal)
  })
  for (const width of [1440, 390]) test(`${width}px 长说明50个完成任务全部加载后搜索分页，过去按实际完成日展示`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 900 })
    const today = (await database.snapshot()).today
    const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString()
    for (let index = 0; index < 50; index++) {
      const description = index === 49 ? '长'.repeat(3996) + '跨批命中' : '长'.repeat(4000)
      const id = (await database.write({ type: 'createTask', title: `长说明完成 ${index}`, description, plannedOn: today, destination: '' })).result.entityId
      await database.write({ type: 'completeTask', id })
    }
    await database.createHistoricalTask({ type: 'createTask', title: '昨天实际完成', description: '历史说明', plannedOn: yesterday, destination: '' }, yesterday)
    await page.goto('/adventure')
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('50 / 50')
    await expect(page.getByRole('article', { name: /^任务：长说明完成 / })).toHaveCount(20)
    await page.getByRole('button', { name: '下一页任务', exact: true }).click()
    await expect(page.getByText('共 50 项 · 第 2 页', { exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: '搜索任务' }).fill('跨批命中')
    await expect(page.getByRole('article', { name: '任务：长说明完成 49', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: /^任务：/ })).toHaveCount(1)
    await expect(page.getByRole('group', { name: '今日任务进度' })).toContainText('50 / 50')
    if (!await page.getByRole('button', { name: `选择日期 ${yesterday}`, exact: true }).count()) await page.getByRole('button', { name: '上一周', exact: true }).click()
    await page.getByRole('button', { name: `选择日期 ${yesterday}`, exact: true }).click()
    await expect(page.getByRole('searchbox', { name: '搜索任务' })).toHaveValue('跨批命中')
    await page.getByRole('searchbox', { name: '搜索任务' }).fill('')
    await expect(page.getByRole('article', { name: '任务：昨天实际完成', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '今日任务进度' })).toHaveCount(0)
  })

})
