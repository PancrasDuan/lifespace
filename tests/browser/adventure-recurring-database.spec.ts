import { mkdir } from 'node:fs/promises'
import { Temporal } from '@js-temporal/polyfill'
import { test, expect, type Page } from './authenticated-test'
import { planningDatabaseBrowser, localPlanningRpc } from '../support/planning-database-browser'
import { recurringParentDetailSchema, recurringChildrenSchema, recurringChildDetailSchema, dateTaskListSchema } from '../../src/shared/adventure-recurring'

const db = planningDatabaseBrowser()
const dialog = (page: Page) => page.getByRole('dialog')
const output = process.env.RECURRING_REAL_EVIDENCE_DIR || 'docs/evidence/201-recurring-integration/real'
const basis = async () => { const p = await db.snapshot(); return { today: p.today, expectedVersion: p.version } }
const json = async (path: string, body?: unknown) => {
  const r = await db.request(path, body)
  expect(r.status, await r.clone().text()).toBe(200)
  return r.json()
}
const parent = async (id: string) => recurringParentDetailSchema.parse(await json('/api/adventure/recurring/detail', { ...await basis(), id })).parent
const children = async (parentId: string, page = 1) => recurringChildrenSchema.parse(await json('/api/adventure/recurring/children', { ...await basis(), parentId, page }))
const child = async (id: string) => recurringChildDetailSchema.parse(await json('/api/adventure/recurring/child', { ...await basis(), id })).child
const seed = async (title: string, requiredCount = 5, destination = '', startOn?: string) => {
  const { today } = await basis()
  return (await db.write({ type: 'createRecurringTask', title, description: '真实数据库事实', periodType: 'week', requiredCount, destination, startOn: startOn ?? today, today })).result.entityId
}
const record = async (id: string) => db.write({ type: 'recordRecurringCompletion', id, today: (await basis()).today })
async function capture(page: Page, name: string) {
  await mkdir(output, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: !(await dialog(page).count()), animations: 'disabled' })
}
async function open(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click()
  await expect(dialog(page).getByRole('heading', { name: '关联子任务' })).toBeVisible()
}
async function saved(page: Page) { await expect(dialog(page)).toHaveCount(0); await expect(page.locator('.planning-toast')).toBeVisible() }
async function choose(page: Page, date: string) {
  const target = Temporal.PlainDate.from(date)
  for (let i = 0; i < 6 && !await page.getByRole('button', { name: `选择日期 ${date}`, exact: true }).count(); i++) {
    await page.getByRole('button', { name: Temporal.PlainDate.compare(target, Temporal.PlainDate.from((await basis()).today)) < 0 ? '上一周' : '下一周', exact: true }).click()
  }
  await page.getByRole('button', { name: `选择日期 ${date}`, exact: true }).click()
}

test.describe('周期集成：真实浏览器 → Node app.request Worker → HTTP PostgREST → 隔离PG', () => {
  test.describe.configure({ timeout: 60000 })
  test.skip(!localPlanningRpc, '必须由 run-recurring-database.mjs --browser 启动独立隔离库；跳过不算验收')
  test.beforeEach(async ({ context, page }) => { await db.install(context); await page.setViewportSize({ width: 1440, height: 1000 }) })
  test.afterEach(() => db.restore())

  for (const width of [1440, 390]) {
    test(`${width}: 周月季年与一次性UI创建、共用搜索、原生dialog键盘`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await page.goto('/adventure')
      const today = (await basis()).today
      for (const [type, label] of [['week', '周'], ['month', '月'], ['quarter', '季'], ['year', '年']] as const) {
        await page.getByRole('button', { name: '新建行动', exact: true }).click()
        await expect(dialog(page).getByLabel('任务名称')).toBeFocused()
        await dialog(page).getByLabel('任务名称').fill(`联通${label}`)
        await dialog(page).getByLabel('周期', { exact: true }).selectOption(type)
        await dialog(page).getByLabel('每期次数').fill('2')
        if (type === 'week') await capture(page, `create-${width}`)
        await dialog(page).getByRole('button', { name: '创建任务', exact: true }).click()
        await saved(page)
        await expect(page.getByRole('button', { name: `联通${label}`, exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: '新建行动', exact: true }).click()
      await dialog(page).getByRole('button', { name: '一次性任务', exact: true }).click()
      await dialog(page).getByLabel('任务名称').fill('联通一次性')
      await dialog(page).getByRole('button', { name: '创建任务', exact: true }).click(); await saved(page)
      expect((await db.snapshot()).tasks).toMatchObject([{ title: '联通一次性', plannedOn: today }])
      await expect(page.locator('.recurring-row')).toHaveCount(4)
      await page.getByRole('searchbox', { name: '搜索任务' }).fill('联通')
      await expect(page.locator('.recurring-row')).toHaveCount(4)
      await expect(page.locator('.today-task-record')).toHaveCount(1)
      await capture(page, `today-${width}`)
      await page.getByRole('searchbox', { name: '搜索任务' }).fill('一次性')
      await expect(page.locator('.recurring-row')).toHaveCount(0)
      await expect(page.locator('.today-task-record')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('button', { name: '新建行动', exact: true }).focus(); await page.keyboard.press('Enter')
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog'))).toBe(true) }
      await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '新建行动', exact: true })).toBeFocused()
    })

    test(`${width}: 真实4/3、快照冻结、上调和撤销至空态`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      const id = await seed('刷 LeetCode')
      await page.goto('/adventure')
      const button = page.getByRole('button', { name: '记录一次', exact: true })
      await button.dblclick()
      await expect.poll(async () => (await db.snapshot()).growth.actions).toBe(1)
      for (let i = 2; i <= 4; i++) { await expect(button).toBeEnabled(); await button.click(); await expect.poll(async () => (await db.snapshot()).growth.actions).toBe(i) }
      await open(page, '刷 LeetCode'); await capture(page, `parent-${width}`)
      await dialog(page).getByRole('button', { name: '编辑任务', exact: true }).click()
      await expect(dialog(page).getByLabel('开始日期不可修改')).toBeVisible()
      await dialog(page).getByLabel('每期次数').fill('3')
      await dialog(page).getByRole('button', { name: '保存任务', exact: true }).click(); await saved(page)
      expect(await parent(id)).toMatchObject({ effectiveChildren: 4, completedPeriods: 1, currentPeriod: { completed: 4, required: 3 }, capabilities: { recordRecurringCompletion: { allowed: false } } })
      await open(page, '刷 LeetCode'); await expect(dialog(page).getByText('4 / 3', { exact: true })).toBeVisible(); await capture(page, `lowered-${width}`)
      await dialog(page).getByRole('button', { name: /^查看子任务 / }).first().click()
      await expect(dialog(page).getByText('每周 5 次', { exact: true })).toBeVisible(); await capture(page, `child-${width}`)
      await dialog(page).getByRole('button', { name: /^父任务/ }).click()
      await dialog(page).getByRole('button', { name: '编辑任务', exact: true }).click(); await dialog(page).getByLabel('每期次数').fill('6')
      await dialog(page).getByRole('button', { name: '保存任务', exact: true }).click(); await saved(page)
      expect(await parent(id)).toMatchObject({ completedPeriods: 0, currentPeriod: { completed: 4, required: 6 } })
      await open(page, '刷 LeetCode')
      for (let count = 3; count >= 0; count--) {
        await dialog(page).getByRole('button', { name: /^查看子任务 / }).first().click()
        await dialog(page).getByRole('button', { name: '撤销本次完成', exact: true }).click()
        await expect(dialog(page).getByText(`${count} 项`, { exact: true })).toBeVisible()
        await expect.poll(async () => (await parent(id)).effectiveChildren).toBe(count)
      }
      await expect(dialog(page).getByText('暂无关联子任务')).toBeVisible(); await capture(page, `revoked-empty-${width}`)
      expect((await db.snapshot()).growth).toMatchObject({ totalXp: 0, actions: 0 })
    })
  }

  test('父迁移不动旧子、一次性进度/taskCount/奖励N和成长null安排', async ({ page }) => {
    const a = (await db.write({ type: 'createGoal', title: '旧归属目标', standards: ['成果'] })).result.entityId
    const b = (await db.write({ type: 'createGoal', title: '新归属目标', standards: ['成果'] })).result.entityId
    const id = await seed('迁移周期', 2, a), first = await record(id)
    const today = (await basis()).today
    const once = await db.write({ type: 'createTask', title: '旧目标一次性', description: '', destination: a, plannedOn: today })
    await db.write({ type: 'completeTask', id: once.result.entityId })
    await page.goto('/adventure'); await open(page, '迁移周期')
    await dialog(page).getByRole('button', { name: '编辑任务', exact: true }).click()
    await dialog(page).getByLabel('任务归属').selectOption(b)
    await dialog(page).getByLabel('任务名称').fill('迁移后的周期')
    await dialog(page).getByRole('button', { name: '保存任务', exact: true }).click(); await saved(page)
    await open(page, '迁移后的周期'); await dialog(page).getByRole('button', { name: '记录一次', exact: true }).click(); await saved(page)
    expect((await child(first.result.entityId)).snapshot).toMatchObject({ title: '迁移周期', goalId: a })
    expect((await children(id)).children.map(c => c.snapshot.goalId).sort()).toEqual([a, b].sort())
    const snapshot = await db.snapshot()
    expect(snapshot.goals.find(g => g.id === a)).toMatchObject({ taskCount: 1, progress: { completed: 1, total: 1 } })
    expect(snapshot.goals.find(g => g.id === b)).toMatchObject({ taskCount: 1, progress: { total: 0, ratio: null } })
    expect(snapshot.todayTaskProgress).toMatchObject({ completed: 3, total: 3 })
    await page.getByRole('button', { name: '目标', exact: true }).click()
    await page.locator('.goal-console-row').filter({ hasText: '旧归属目标' }).getByRole('button', { name: '达成', exact: true }).click()
    await page.getByRole('radio', { name: /3×/ }).check(); await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
    await page.getByRole('dialog', { name: '目标详情', exact: true }).getByRole('button', { name: '相关任务', exact: true }).click()
    await expect(dialog(page)).toContainText('旧目标一次性'); await expect(dialog(page)).not.toContainText('迁移周期')
    await dialog(page).getByRole('button', { name: '关闭弹窗', exact: true }).click()
    expect((await child(first.result.entityId)).capabilities.cancelRecurringCompletion.allowed).toBe(false)
    expect((await db.snapshot()).growth).toMatchObject({ totalXp: 9, actions: 3, achievedGoals: 1 })
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await page.getByRole('button', { name: /^查看来源：迁移周期，/ }).click()
    const source = page.getByRole('region', { name: '迁移周期的奖励来源' })
    await expect(source).toContainText('旧归属目标'); await expect(source).toContainText('周期完成')
    await expect(source).not.toContainText('原安排 null'); await expect(source).not.toContainText('发生时安排')
    await capture(page, 'growth-attribution-1440')
  })

  test('真实提交丢响应后刷新只读恢复、同封套/异摘要、成功后只重读', async ({ page, context }) => {
    const id = await seed('回执恢复', 3), envelopes: unknown[] = [], lookups: unknown[] = []
    await page.goto('/adventure')
    let lose = true
    await context.route('**/api/adventure/commands', async route => {
      const body = route.request().postDataJSON(); envelopes.push(body)
      const response = await db.request('/api/adventure/commands', body)
      expect(response.status).toBe(200)
      if (lose) { lose = false; await route.abort('failed') }
      else await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
    })
    await context.route('**/api/adventure/receipts/lookup', async route => { lookups.push(route.request().postDataJSON()); await route.fallback() })
    await page.getByRole('button', { name: '记录一次', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认上次操作结果', exact: true })).toBeVisible()
    const committed = await db.snapshot()
    await page.reload(); await page.getByRole('button', { name: '确认上次操作结果', exact: true }).click()
    await expect.poll(() => lookups.length).toBe(1)
    await expect(page.getByRole('button', { name: '记录一次', exact: true })).toBeEnabled()
    expect(envelopes).toHaveLength(1); expect(lookups[0]).toMatchObject(envelopes[0] as Record<string, unknown>)
    expect(await db.snapshot()).toEqual(committed)
    const replay = await db.request('/api/adventure/commands', envelopes[0]); expect(replay.status).toBe(200)
    expect(await db.snapshot()).toEqual(committed)
    const value = envelopes[0] as { command: object }
    const changed = await db.request('/api/adventure/commands', { ...value, command: { ...value.command, id: crypto.randomUUID() } })
    expect(changed.status).toBe(409)
    await context.unroute('**/api/adventure/commands')
    let failRead = false
    await context.route('**/api/adventure/commands', async route => {
      envelopes.push(route.request().postDataJSON())
      const response = await db.request('/api/adventure/commands', route.request().postDataJSON())
      expect(response.status).toBe(200); failRead = true
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
    await context.route('**/api/adventure?**', async route => {
      if (failRead) { failRead = false; await route.fulfill({ status: 503, json: { error: { message: '测试读取中断' } } }) }
      else await route.fallback()
    })
    await page.getByRole('button', { name: '记录一次', exact: true }).click()
    await expect(page.getByText('操作已成功，页面更新失败。请重新读取。')).toBeVisible()
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await expect.poll(async () => (await parent(id)).effectiveChildren).toBe(2)
    expect(envelopes).toHaveLength(2)
    await capture(page, 'receipt-recovered-1440')
  })

  test('真实关联分页、撤销第11项后返回父、全量进度和空页返回', async ({ page }) => {
    const id = await seed('分页周期', 20)
    for (let i = 0; i < 11; i++) await record(id)
    await page.goto('/adventure')
    await expect(page.getByRole('group', { name: '今日任务进度', exact: true })).toHaveText('今日进度11 / 11')
    await page.getByRole('button', { name: '下一页任务', exact: true }).click()
    await expect(page.locator('.today-task-record')).toHaveCount(1)
    await page.getByRole('button', { name: '上一页任务', exact: true }).click()
    await open(page, '分页周期'); await expect(dialog(page).getByText('11 项', { exact: true })).toBeVisible()
    await dialog(page).getByRole('button', { name: '下一页子任务', exact: true }).click()
    await expect(dialog(page).getByRole('button', { name: /^查看子任务 / })).toHaveCount(1)
    await dialog(page).getByRole('button', { name: /^查看子任务 / }).click()
    await dialog(page).getByRole('button', { name: '撤销本次完成', exact: true }).click()
    await expect(dialog(page).getByText('10 项', { exact: true })).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: /^查看子任务 / })).toHaveCount(10)
    expect((await children(id)).total).toBe(10)
    await capture(page, 'children-after-revoke-1440')
  })

  test('未开始编辑/日期/删除、未来及满额父阻断目标、结束后父子只读', async ({ page }) => {
    const today = (await basis()).today, future = Temporal.PlainDate.from(today).add({ days: 3 }).toString()
    const goal = (await db.write({ type: 'createGoal', title: '被周期阻断的目标', standards: ['成果'] })).result.entityId
    const next = await seed('未来开始', 1, goal, future), active = await seed('已满仍未结束', 1, goal)
    await record(active)
    await page.goto('/adventure'); await page.getByRole('button', { name: '目标', exact: true }).click()
    const row = page.locator('.goal-console-row').filter({ hasText: '被周期阻断的目标' })
    await expect(row.getByRole('button', { name: '达成', exact: true })).toBeDisabled()
    await expect(row.getByRole('button', { name: '结束目标', exact: true })).toBeDisabled()
    await page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: '今日聚焦', exact: true }).click()
    await choose(page, future); await open(page, '未来开始')
    await expect(dialog(page).getByText('尚未开始', { exact: true })).toBeVisible()
    await dialog(page).getByRole('button', { name: '编辑任务', exact: true }).click()
    const moved = Temporal.PlainDate.from(future).add({ days: 1 }).toString()
    await dialog(page).getByLabel('开始日期', { exact: true }).fill(moved)
    await dialog(page).getByRole('button', { name: '保存任务', exact: true }).click(); await saved(page)
    expect((await parent(next)).startOn).toBe(moved)
    await choose(page, moved); await open(page, '未来开始')
    await dialog(page).getByRole('button', { name: '删除任务', exact: true }).click()
    await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await dialog(page).getByRole('button', { name: '确认删除', exact: true }).click(); await saved(page)
    await expect(page.getByRole('button', { name: '未来开始', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '回到今天', exact: true }).click(); await open(page, '已满仍未结束')
    await dialog(page).getByRole('button', { name: '结束任务', exact: true }).click()
    await expect(dialog(page).getByRole('button', { name: '确认结束', exact: true })).toBeEnabled()
    await capture(page, 'end-confirm-1440')
    await dialog(page).getByRole('button', { name: '确认结束', exact: true }).click(); await saved(page)
    await open(page, '已满仍未结束'); await expect(dialog(page).getByText('已结束', { exact: true }).first()).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: '编辑任务', exact: true })).toHaveCount(0)
    await dialog(page).getByRole('button', { name: /^查看子任务 / }).click()
    await expect(dialog(page).getByRole('button', { name: '撤销本次完成', exact: true })).toHaveCount(0)
    expect((await db.snapshot()).growth.totalXp).toBe(1)
  })

  test('实际日期入口、历史不展开父/待办、服务端拒绝过期today且不补交', async ({ page, context }) => {
    const { today } = await basis(), past = Temporal.PlainDate.from(today).subtract({ days: 2 }).toString()
    const id = await seed('今日运行父')
    await db.createHistoricalTask({ type: 'createTask', title: '历史已完成', description: '', destination: '', plannedOn: past }, past)
    await db.createHistoricalTask({ type: 'createTask', title: '逾期待办', description: '', destination: '', plannedOn: past })
    await page.goto('/adventure'); await choose(page, past)
    await expect(page.locator('.recurring-row')).toHaveCount(0)
    await expect(page.locator('.today-task-record')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '取消完成', exact: true })).toBeDisabled()
    await capture(page, 'history-date-1440')
    await page.getByRole('button', { name: '回到今天', exact: true }).click()
    await expect(page.locator('.recurring-row')).toHaveCount(1)
    await expect(page.getByRole('article', { name: '任务：逾期待办', exact: true })).toBeVisible()
    const before = await db.snapshot(), envelopes: unknown[] = []
    // The browser has a stale intent; only its request date is changed. The
    // response and all business validation still come from production Worker/PG.
    await context.route('**/api/adventure/commands', async route => {
      const body = route.request().postDataJSON(); body.command.today = past; envelopes.push(body)
      const response = await db.request('/api/adventure/commands', body)
      expect(response.status).toBe(409)
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
    await page.getByRole('button', { name: '记录一次', exact: true }).click()
    await expect(page.getByRole('button', { name: '刷新日期', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '刷新日期', exact: true }).click()
    await page.reload()
    expect(envelopes).toHaveLength(1); expect(await db.snapshot()).toEqual(before)
    expect((await parent(id)).effectiveChildren).toBe(0)
    const date = dateTaskListSchema.parse(await json('/api/adventure/date-tasks/list', { ...await basis(), date: today }))
    expect(date.progress).toMatchObject({ completed: 0, total: 1 })
  })
})
