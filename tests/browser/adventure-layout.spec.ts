import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal, goalId, mainlineId } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'
import type { GrowthPage, RewardSource } from '../../src/shared/adventure-growth'

const taskId = '00000000-0000-4000-8000-000000000056'
const completionId = '00000000-0000-4000-8000-000000000057'
const achievements = [1, 10, 40, 100, 1, 3, 10].map((threshold, index) => ({
  id: `${index < 4 ? 'actions' : 'goals'}_${threshold}`, label: ['开始行动', '持续前进', '稳稳向前', '走得更远', '第一个成果', '种下方向', '不断收获'][index], threshold,
  count: index < 4 ? 32 : 7, remaining: Math.max(0, threshold - (index < 4 ? 32 : 7)), unlocked: threshold <= (index < 4 ? 32 : 7),
}))
const state: PlanningPage = { ...withGoal,
  capabilities: { ...withGoal.capabilities, createTask: allowed },
  growth: { ...withGoal.growth, level: 4, totalXp: 79, progress: 19, remaining: 1, actions: 32, achievedGoals: 7, achievements },
  goals: [{ ...withGoal.goals[0], progress: { completed: 5, total: 8, ratio: 5 / 8 }, capabilities: { edit: allowed, focus: allowed, achieve: allowed, moveUp: allowed, moveDown: allowed } }],
  tasks: [{ id: taskId, title: '整理本周设计反馈', description: '保留说明与完整原安排。', plannedOn: withGoal.today, rescheduleMin: withGoal.today,
    independent: true, goalId: null, goalTitle: null, mainlineName: '独立区', status: 'pending', completedOn: null, completionId: null,
    completionOrigin: null, reward: null, overdue: false, progress: { completed: 0, total: 1, ratio: 0 }, arrangements: [], totalArrangements: 0,
    capabilities: { complete: allowed, edit: allowed, migrate: allowed, reschedule: allowed, end: allowed, delete: allowed } }], totalTasks: 1,
}
const source: RewardSource = { version: 2, event: { id: completionId, entityId: taskId, kind: 'task_completed', title: '发生时的任务名', occurredAt: '2026-10-20T04:00:00Z', occurredOn: '2026-10-20', amount: 1,
  mainlineId, mainlineName: '发生时主线', mainlineKind: 'normal', goalId, goalTitle: '发生时目标', calculation: { type: 'fixed_task', completionId, count: 1, coefficient: 1 } },
  description: '发生时冻结说明', plannedOn: '2026-10-20', standards: [], reflection: null, actionSources: [], totalSources: 0, page: 1, pageSize: 5,
}
const growth: GrowthPage = { version: 2, growth: { ...state.growth, achievements }, items: [source.event], total: 1, pageSize: 10, nextCursor: null }

for (const width of [1440, 957, 390]) test(`${width}px 原型布局：同层成长、单次展开、向右更多及可读悬停`, async ({ page, context }) => {
  await planningFixture(context, state)
  await page.setViewportSize({ width, height: 954 })
  await page.goto('/adventure')
  const hero = page.locator('.adventure-proto-day-note'), aside = page.locator('.adventure-proto-aside')
  await expect(hero).toBeVisible()
  const heroBox = (await hero.boundingBox())!, asideBox = (await aside.boundingBox())!
  if (width > 700) {
    expect(asideBox.y).toBeCloseTo(heroBox.y, 0)
    expect(asideBox.x).toBeGreaterThanOrEqual(heroBox.x + heroBox.width)
  } else {
    expect(asideBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height)
    expect((await page.locator('.adventure-proto-mainline-list').boundingBox())!.y).toBeGreaterThan(asideBox.y)
  }
  const card = page.getByRole('article', { name: '任务：整理本周设计反馈' })
  await expect(card.getByRole('button', { name: '完成', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '任务详情：整理本周设计反馈' }).click()
  await expect(card.getByRole('region', { name: '完整原安排链' })).toContainText('整理本周设计反馈')
  await expect(card.getByRole('button', { name: '编辑任务', exact: true })).toBeHidden()
  const before = (await card.boundingBox())!
  await card.getByRole('button', { name: /^更多/ }).click()
  const after = (await card.boundingBox())!
  expect(after.height).toBeCloseTo(before.height, 0)
  await expect(card.getByRole('button', { name: '完成', exact: true })).toBeVisible()
  const primary = card.getByRole('button', { name: '完成', exact: true })
  await primary.hover()
  await expect(primary).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(primary).toHaveCSS('background-color', 'rgb(53, 79, 55)')
  await expect(page.locator('.prototype-page a')).toHaveCount(0)
  await expect(page.locator('.adventure-proto-goal article, .adventure-proto-task article, .adventure-proto-mainline-list article article')).toHaveCount(0)
  await expect(page.locator('.prototype-page details')).toHaveCount(0)
  const shell = await page.evaluate(() => {
    const main = document.querySelector('.lifespace-app main')!.getBoundingClientRect()
    return {
      mainLeft: main.x,
      background: getComputedStyle(document.querySelector('.lifespace-app')!).backgroundImage,
    }
  })
  expect(shell.mainLeft).toBe(width > 700 ? 74 : 0)
  expect(shell.background).toContain('radial-gradient')
  if (width <= 700) {
    const avatar = (await page.locator('.auth-avatar').boundingBox())!
    const create = (await page.getByRole('button', { name: '新建', exact: true }).boundingBox())!
    expect(create.x + create.width).toBeLessThanOrEqual(avatar.x)
    const settings = (await page.locator('.proto-mobile-settings').boundingBox())!
    const home = (await page.locator('.proto-sidebar a.nav-item').first().boundingBox())!
    expect(settings.x + settings.width).toBeLessThanOrEqual(home.x)
  }
  await expect(page.locator('.page-heading')).toContainText('LIFESPACE / YOUR NEXT STEP')
  await expect(page.locator('.adventure-proto-day-note')).toContainText('先走稳眼前这一步')
  await expect(page.locator('.adventure-proto-aside')).toContainText('正在成为')
  await expect(page.locator('.adventure-proto-aside')).toContainText('下一处风景')
  await expect(page.locator('.adventure-proto-task-section')).toContainText('一次性任务')
  if (width > 700) expect((await page.locator('.adventure-proto-task-section').boundingBox())!.width).toBeCloseTo((await page.locator('.adventure-proto-mainline-list').boundingBox())!.width, 0)
  await expect(page.locator('.view-tabs')).toContainText('今天')
  await expect(page.locator('.view-tabs')).toContainText('主线与目标')
  await expect(page.locator('.view-tabs')).toContainText('成长记录')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `.cache/adventure-ui-overview-${width}.png`, fullPage: true })
  const taskSection = page.locator('.adventure-proto-task-section')
  if (width > 700) {
    expect((await taskSection.boundingBox())!.width).toBeCloseTo((await page.locator('.adventure-proto-mainline-list').boundingBox())!.width, 0)
    expect((await taskSection.boundingBox())!.x).toBeCloseTo((await hero.boundingBox())!.x, 0)
  }
  await page.getByRole('button', { name: '主线与目标', exact: true }).click()
  await expect(page.locator('.adventure-proto-aside')).toHaveCount(0)
  await expect(page.locator('.adventure-proto-task-section')).toHaveCount(0)
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  const details = page.getByRole('region', { name: '目标详情', exact: true })
  await expect(details).toContainText('连续跑完五公里')
  const goal = page.getByRole('article', { name: '目标卡：五公里' })
  const goalHeight = (await goal.boundingBox())!.height
  await details.getByRole('button', { name: /^更多/ }).click()
  await expect(details.getByRole('button', { name: '编辑目标', exact: true })).toBeVisible()
  if (width > 700) expect((await goal.boundingBox())!.height).toBeCloseTo(goalHeight, 0)
  else expect((await goal.boundingBox())!.height).toBeGreaterThanOrEqual(goalHeight)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `.cache/adventure-ui-planning-${width}.png`, fullPage: true })
})

test('成长记录：已点亮进度封顶，整行打开奖励冻结来源', async ({ page, context }) => {
  await planningFixture(context, state)
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await context.route('**/api/adventure/reward-source**', route => route.fulfill({ json: source }))
  await page.goto('/adventure')
  await page.getByRole('button', { name: '成长记录', exact: true }).click()
  const badge = page.getByRole('article', { name: '成就：开始行动', exact: true })
  await expect(badge).toContainText('已点亮')
  await expect(badge).not.toContainText('32 / 1')
  await expect(page.getByRole('article', { name: '成就：稳稳向前', exact: true })).toContainText('32 / 40')
  await page.getByRole('button', { name: /^查看来源：发生时的任务名/ }).click()
  const detail = page.getByRole('region', { name: '发生时的任务名的奖励来源', exact: true })
  await expect(detail).toContainText('发生时主线 / 发生时目标')
  await expect(detail).toContainText('发生时冻结说明')
  await expect(detail).toContainText('完整行动 · 固定 1 点 · 系数 1')
  await expect(detail.getByRole('link')).toHaveCount(0)
  await expect(detail.locator('details')).toHaveCount(0)
  await page.getByRole('button', { name: /^查看来源：发生时的任务名/ }).click()
  await expect(detail).toHaveCount(0)
  await page.screenshot({ path: '.cache/adventure-ui-reward-source.png', fullPage: true })
})


test('已结束主线直达仍展示平铺历史，不要求开启终态列表', async ({ page, context }) => {
  await planningFixture(context, { ...state, mainlines: [], mainlineDetail: { ...withGoal.mainlines[0], status: 'ended', endedAt: '2026-10-20T04:00:00Z' } })
  await page.goto(`/adventure?mainlineId=${mainlineId}`)
  const history = page.getByRole('region', { name: '主线历史', exact: true })
  await expect(history).toContainText('已结束 · 只读')
  await expect(history).toContainText('结束时间')
  await expect(history).toContainText('五公里')
  await expect(page.getByLabel('显示已达成／已结束', { exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: '收起详情', exact: true }).click()
  await expect(history).toHaveCount(0)
})

test('键盘收起内联详情后焦点回到对应摘要', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure')
  const summary = page.getByRole('button', { name: '目标：五公里', exact: true })
  await summary.click()
  await page.getByRole('region', { name: '目标详情', exact: true }).getByRole('button', { name: '聚焦', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(summary).toBeFocused()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: '目标详情', exact: true })).toHaveCount(0)
})

test('主线目标页隐藏等级经验，目标聚焦筛选请求由后端分页', async ({ page, context }) => {
  const server = await planningFixture(context, { ...state, mainlines: [{ ...state.mainlines[0], activeGoalCount: 8, todayTaskCount: 3 }] })
  await page.goto('/adventure')
  await expect(page.getByRole('article', { name: '主线：健康', exact: true })).toContainText('8 个目标')
  await page.getByRole('button', { name: '主线与目标', exact: true }).click()
  await expect(page.locator('.level-note')).toHaveCount(0)
  server.show({ ...state, goalScope: 'focus', goals: [], totalGoals: 0 })
  const query = page.waitForRequest(request => request.url().includes('/api/adventure?') && new URL(request.url()).searchParams.get('goalScope') === 'focus')
  await page.getByLabel('目标视图').getByRole('button', { name: '聚焦', exact: true }).click()
  await query
  await expect(page.getByRole('button', { name: '目标：五公里', exact: true })).toHaveCount(0)
})

test('目标编辑取消后焦点回到对应目标摘要', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure')
  const summary = page.getByRole('button', { name: '目标：五公里', exact: true })
  await summary.click()
  await page.getByRole('region', { name: '目标详情', exact: true }).getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(summary).toBeFocused()
})

test('聚焦视图创建任务仍可选择未聚焦目标，候选读取不改变页面筛选', async ({ page, context }) => {
  await planningFixture(context, { ...state, goalScope: 'focus', goals: [], totalGoals: 0 })
  await context.route('**/api/adventure?**', async route => {
    const scope = new URL(route.request().url()).searchParams.get('goalScope')
    await route.fulfill({ json: scope === 'all' ? { ...state, goals: [{ ...state.goals[0], focused: false, capabilities: { ...state.goals[0].capabilities, createTask: allowed } }] } : { ...state, goalScope: 'focus', goals: [], totalGoals: 0 } })
  })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '一项行动', exact: true }).click()
  await expect(page.getByLabel('任务归属').getByRole('option', { name: '健康 / 五公里', exact: true })).toBeAttached()
  await page.getByLabel('任务归属').selectOption(goalId)
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('目标视图').getByRole('button', { name: '聚焦', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('主线只展开一层，查看历史不会收起卡片，更多仅一组', async ({ page, context }) => {
  const server = await planningFixture(context, state)
  await page.goto('/adventure')
  const card = page.getByRole('article', { name: '主线：健康', exact: true })
  await card.getByRole('button', { name: '主线：健康', exact: true }).click()
  await expect(card.getByRole('region', { name: '主线历史', exact: true })).toHaveCount(0)
  server.show({ ...state, mainlineDetail: state.mainlines[0] })
  await card.getByRole('button', { name: '查看历史', exact: true }).click()
  await expect(card.getByRole('region', { name: '主线历史', exact: true })).toContainText('五公里')
  await expect(card.getByRole('button', { name: '更多', exact: true })).toHaveCount(1)
  await card.getByRole('button', { name: '查看历史', exact: true }).click()
  const summary = card.getByRole('button', { name: '主线：健康', exact: true })
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(summary).toBeFocused()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
})

test('手机成功提示正文不挡住任务操作，提示关闭按钮仍可点击', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.setViewportSize({ width: 390, height: 954 })
  await page.goto('/adventure')
  const card = page.getByRole('article', { name: '任务：整理本周设计反馈', exact: true })
  await card.getByRole('button', { name: '任务详情：整理本周设计反馈', exact: true }).click()
  await card.getByRole('button', { name: '完成', exact: true }).click()
  const toast = page.getByRole('status').filter({ hasText: '已保存' })
  await expect(toast).toBeVisible()
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '1000px'
    document.querySelector<HTMLElement>('.prototype-page')!.appendChild(spacer)
    const more = document.querySelector<HTMLElement>('.adventure-proto-task .more-actions > button')!
    const toast = document.querySelector<HTMLElement>('.planning-toast-success')!
    const target = more.getBoundingClientRect(), overlay = toast.getBoundingClientRect()
    window.scrollBy(0, target.y + target.height / 2 - overlay.y - overlay.height / 2)
  })
  await card.getByRole('button', { name: '更多', exact: true }).click({ timeout: 1500 })
  await expect(card.getByRole('button', { name: '编辑任务', exact: true })).toBeVisible()
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: '关闭成功提示', exact: true }).click()
  await expect(toast).toHaveCount(0)
})


test('验收反馈：隐藏只读归属和任务聚焦入口', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure')
  await expect(page.getByLabel('任务视图')).toHaveCount(0)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '一项行动', exact: true }).click()
  await expect(page.getByLabel('任务归属').locator('option:disabled')).toHaveCount(0)
  await expect(page.getByLabel('任务归属')).not.toContainText('五公里')
})

test('验收反馈：主线历史不改变下面的目标列表', async ({ page, context }) => {
  await planningFixture(context, state)
  await context.route('**/api/adventure?**', route => {
    const history = new URL(route.request().url()).searchParams.has('mainlineId')
    return route.fulfill({ json: history ? { ...state, mainlineDetail: state.mainlines[0], goals: [], totalGoals: 0 } : state })
  })
  await page.goto('/adventure')
  const goal = page.getByRole('article', { name: '目标卡：五公里', exact: true })
  await expect(goal).toBeVisible()
  const card = page.getByRole('article', { name: '主线：健康', exact: true })
  await card.getByRole('button', { name: '主线：健康', exact: true }).click()
  await card.getByRole('button', { name: '查看历史', exact: true }).click()
  await expect(card.getByRole('region', { name: '主线历史', exact: true })).toContainText('共 0 个目标')
  await expect(goal).toBeVisible()
})
