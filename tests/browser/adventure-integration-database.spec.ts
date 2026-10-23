import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
const { snapshot, write, growth, request } = database

test.describe('跨功能交付与真实提交恢复验收（受控身份）', () => {
  test.skip(!localPlanningRpc, '仅在显式启动的隔离本机 PostgreSQL／PostgREST 中运行')
  test.beforeEach(async ({ context }) => { await database.install(context) })
  test.afterEach(() => database.restore())

  for (const width of [1440, 390]) test(`${width}px 真实提交后丢失响应、查询失败、预览过期与迁移达成来源联动`, async ({ page, context }) => {
    const main = (await write({ type: 'createMainline', name: '联动主线' })).result.entityId
    const goal = (await write({ type: 'createGoal', title: '联动成果', standards: ['结果确已达成'], destination: main })).result.entityId
    const task = (await write({ type: 'createTask', title: '联动行动', description: '原行动说明', plannedOn: '2020-01-01', destination: goal })).result.entityId
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/adventure')
    await page.getByRole('button', { name: '过去', exact: true }).click()
    const card = page.getByRole('article', { name: '任务：联动行动', exact: true })
    await expect(card).toBeVisible()
    await openRecordActions(card)
    await card.getByRole('button', { name: '改期', exact: true }).click()
    await page.getByLabel('新的执行日期').fill((await snapshot()).today)
    await page.getByRole('button', { name: '预览改期', exact: true }).click()
    await expect(page.getByRole('region', { name: '改期预览' })).toContainText('2020-01-01 →')
    await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeEnabled()
    const before = await snapshot('?taskRange=past')
    await page.getByRole('button', { name: '确认改期', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await snapshot()).version).toBe(before.version + 1)
    await page.getByRole('group', { name: '任务日期范围' }).getByRole('button', { name: '今天', exact: true }).click()

    // Let the real transaction commit, then lose only its HTTP response.
    let lose = true, failRead = false
    const envelopes: unknown[] = []
    await context.route('**/api/adventure/commands', async route => {
      const input = route.request().postDataJSON()
      envelopes.push(input)
      const response = await request('/api/adventure/commands', input)
      expect(response.status).toBe(200)
      if (lose) { lose = false; await route.abort('failed') }
      else { failRead = true; await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() }) }
    })
    await context.route('**/api/adventure?**', async route => {
      if (failRead) { failRead = false; await route.fulfill({ status: 503, json: { error: { message: '测试读取中断' } } }) }
      else await route.fallback()
    })
    await openRecordActions(card)
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
    const committed = await snapshot()
    expect(committed.growth).toMatchObject({ totalXp: 1, actions: 1 })
    const completion = committed.tasks[0].completionId!
    await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('操作已成功，页面更新失败')
    expect(envelopes).toHaveLength(2)
    expect(envelopes[1]).toEqual(envelopes[0])
    expect(await snapshot()).toEqual(committed)
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await expect(card).toContainText('已完成')
    expect(envelopes).toHaveLength(2)
    await context.unroute('**/api/adventure/commands')

    await openRecordActions(card)
    await card.getByRole('button', { name: '取消完成', exact: true }).click()
    expect(await snapshot()).toEqual(committed)
    await write({ type: 'createGoal', title: '另一会话的新目标', standards: ['标准'], destination: '' })
    await page.getByRole('button', { name: '确认取消完成', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认取消完成', exact: true })).toBeDisabled()
    expect((await snapshot()).tasks[0].completionId).toBe(completion)
    await page.getByRole('button', { name: '重新预览', exact: true }).click()
    await page.getByRole('button', { name: '确认取消完成', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await snapshot()).growth).toMatchObject({ totalXp: 0, actions: 0 })
    await openRecordActions(card)
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(card).toContainText('已完成')
    expect((await snapshot()).tasks[0].completionId).not.toBe(completion)
    await openRecordActions(card)
    await card.getByRole('button', { name: '迁移任务', exact: true }).click()
    await page.getByLabel('迁移目的').selectOption('')
    await page.getByRole('button', { name: '确认迁移', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: '目标：联动成果', exact: true }).click()
    await page.getByRole('button', { name: '确认达成', exact: true }).click()
    await page.getByLabel('成就感评价', { exact: true }).selectOption('3')
    await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
    await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('目标奖励 3 点经验')
    await page.keyboard.press('Escape')
    await openRecordActions(card)
    await expect(card.getByRole('button', { name: '取消完成', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await expect(page.getByRole('region', { name: '全账户成长', exact: true })).toContainText('4 点累计经验')
    await page.getByRole('article', { name: '奖励：联动成果', exact: true }).getByRole('button', { name: /^查看来源：/ }).click()
    await page.reload()
    const source = page.getByRole('region', { name: '联动成果的奖励来源', exact: true })
    await expect(source).toContainText('联动行动')
    await expect(source).toContainText('原行动说明')
    const final = await snapshot(`?goalId=${goal}`)
    expect(final.goalDetail?.goal).toMatchObject({ status: 'achieved', progress: { completed: 0, total: 0 } })
    expect(final.tasks[0]).toMatchObject({ id: task, independent: true, status: 'completed', totalArrangements: 2 })
    expect((await growth()).growth).toMatchObject({ totalXp: 4, actions: 1, achievedGoals: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure63-integration-${width}.png`, fullPage: true })
  })
})
