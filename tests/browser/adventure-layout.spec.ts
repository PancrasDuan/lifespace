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

for (const width of [1440, 957, 390]) test(`${width}px 公共布局：今日任务优先、成长辅助、规划独立`, async ({ page, context }) => {
  await planningFixture(context, state)
  await page.setViewportSize({ width, height: 954 })
  await page.goto('/adventure')
  const taskSection = page.locator('.adventure-proto-task-section'), aside = page.locator('.adventure-proto-aside')
  const card = page.getByRole('article', { name: '任务：整理本周设计反馈' })
  await expect(taskSection).toBeVisible()
  await expect(card).toBeInViewport()
  await expect(aside).toBeVisible()
  const summary = page.getByRole('region', { name: '经验概览', exact: true })
  const tabs = page.getByRole('navigation', { name: '冒险页面', exact: true })
  await expect(summary).toContainText('累计经验79')
  expect((await summary.boundingBox())!.y + (await summary.boundingBox())!.height).toBeLessThanOrEqual((await tabs.boundingBox())!.y)
  await expect(page.locator('.adventure-toolbar')).not.toContainText('10月20日')
  await expect(page.locator('.adventure-proto-day-note, .adventure-proto-mainline-list, .adventure-proto-goal')).toHaveCount(0)
  expect(await taskSection.evaluate((element, supportSelector) => {
    const support = document.querySelector(supportSelector)!
    return !!(element.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, '.adventure-proto-aside')).toBe(true)
  const taskBox = (await taskSection.boundingBox())!, asideBox = (await aside.boundingBox())!
  if (width > 720) {
    expect(asideBox.y).toBeCloseTo(taskBox.y, 0)
    expect(asideBox.x).toBeGreaterThanOrEqual(taskBox.x + taskBox.width)
  } else {
    expect(asideBox.y).toBeGreaterThanOrEqual(taskBox.y + taskBox.height)
  }
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
  await expect(primary).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
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
  expect(shell.mainLeft).toBe(width > 720 ? 76 : 54)
  expect(shell.background).toContain('radial-gradient')
  await expect(page.locator('.sidebar .brand-mark img')).toHaveAttribute('src', '/favicon.svg')
  await expect(page.locator('.proto-mobile-settings')).toHaveCount(0)
  const font = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)
  await expect(page.getByRole('heading', { name: '人生冒险', exact: true })).toHaveCSS('font-family', font)
  if (width <= 720) {
    const avatar = (await page.locator('.auth-avatar').boundingBox())!
    for (const name of ['新建主线', '新建目标', '新建行动']) {
      const create = (await page.getByRole('button', { name, exact: true }).boundingBox())!
      expect(create.x + create.width <= avatar.x || avatar.x + avatar.width <= create.x
        || create.y + create.height <= avatar.y || avatar.y + avatar.height <= create.y).toBe(true)
    }
  }
  await expect(page.locator('.adventure-proto-aside')).toContainText('下一处风景')
  await expect(taskSection.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(page.locator('.view-tabs')).toContainText('今天')
  await expect(page.locator('.view-tabs')).toContainText('主线与目标')
  await expect(page.locator('.view-tabs')).toContainText('成长记录')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `.cache/adventure-ui-overview-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: '主线与目标', exact: true }).click()
  await expect(page).toHaveURL('/adventure?view=planning')
  await expect(page.locator('.adventure-proto-aside')).toHaveCount(0)
  await expect(page.locator('.adventure-proto-task-section')).toHaveCount(0)
  await expect(page.getByRole('article', { name: '主线：健康', exact: true })).toBeVisible()
  const workspace = (await page.locator('.adventure-proto-workspace').boundingBox())!
  expect((await page.locator('.adventure-proto-mainline-list').boundingBox())!.width).toBeCloseTo(workspace.width, 0)
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  const details = page.getByRole('region', { name: '目标详情', exact: true })
  await expect(details).toContainText('连续跑完五公里')
  const goal = page.getByRole('article', { name: '目标卡：五公里' })
  const goalHeight = (await goal.boundingBox())!.height
  await details.getByRole('button', { name: /^更多/ }).click()
  await expect(details.getByRole('button', { name: '编辑目标', exact: true })).toBeVisible()
  if (width > 720) expect((await goal.boundingBox())!.height).toBeCloseTo(goalHeight, 0)
  else expect((await goal.boundingBox())!.height).toBeGreaterThanOrEqual(goalHeight)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `.cache/adventure-ui-planning-${width}.png`, fullPage: true })
})

for (const width of [721, 720]) test(`${width}px 冒险沿用全站侧栏断点`, async ({ page, context }) => {
  await planningFixture(context, state)
  await page.setViewportSize({ width, height: 954 })
  await page.goto('/adventure')
  const navigationWidth = width > 720 ? 76 : 54
  await expect(page.locator('.sidebar')).toHaveCSS('width', `${navigationWidth}px`)
  expect((await page.locator('.lifespace-app main').boundingBox())!.x).toBe(navigationWidth)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('规划标签刷新后保持，返回今天只展示行动与成长支持', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure')
  const navigation = page.getByRole('navigation', { name: '冒险页面', exact: true })
  await navigation.getByRole('button', { name: '主线与目标', exact: true }).click()
  await expect(page).toHaveURL('/adventure?view=planning')
  await page.reload()
  await expect(navigation.getByRole('button', { name: '主线与目标', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('article', { name: '主线：健康', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '目标：五公里', exact: true })).toBeVisible()
  await expect(page.locator('.adventure-proto-task-section, .adventure-proto-aside')).toHaveCount(0)
  await navigation.getByRole('button', { name: '今天', exact: true }).click()
  await expect(page).toHaveURL('/adventure')
  await expect(page.locator('.adventure-proto-task-section')).toBeVisible()
  await expect(page.locator('.adventure-proto-aside')).toBeVisible()
  await expect(page.locator('.adventure-proto-mainline-list, .adventure-proto-goal')).toHaveCount(0)
})

test('直接新建主线或目标进入规划，行动留在今天，取消后保留对应页面', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure')
  const navigation = page.getByRole('navigation', { name: '冒险页面', exact: true })
  await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
  for (const entry of [
    { option: '新建主线', title: '创建主线', tab: '主线与目标', url: '/adventure?view=planning' },
    { option: '新建目标', title: '创建目标', tab: '主线与目标', url: '/adventure?view=planning' },
    { option: '新建行动', title: '创建任务', tab: '今天', url: '/adventure' },
  ]) {
    await navigation.getByRole('button', { name: '今天', exact: true }).click()
    const create = page.getByRole('button', { name: entry.option, exact: true })
    await create.click()
    const dialog = page.getByRole('dialog', { name: entry.title, exact: true })
    const selectedTab = navigation.getByRole('button', { name: entry.tab, exact: true })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(selectedTab).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveURL(entry.url)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(create).toBeFocused()
    await expect(selectedTab).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveURL(entry.url)
  }
})

test('经验概览位于三个标签上方，成长页使用最新数据', async ({ page, context }) => {
  await planningFixture(context, state)
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: { ...growth, growth: { ...growth.growth, totalXp: 99 } } }))
  await page.setViewportSize({ width: 390, height: 954 })
  await page.goto('/adventure')
  const summary = page.getByRole('region', { name: '经验概览', exact: true })
  const navigation = page.getByRole('navigation', { name: '冒险页面', exact: true })
  for (const label of ['今天', '主线与目标', '成长记录']) {
    await navigation.getByRole('button', { name: label, exact: true }).click()
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(label === '成长记录' ? '累计经验99' : '累计经验79')
    expect((await summary.boundingBox())!.y + (await summary.boundingBox())!.height).toBeLessThanOrEqual((await navigation.boundingBox())!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.reload()
  await expect(summary).toContainText('累计经验99')
})

test('关闭新建表单后焦点回到入口', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.setViewportSize({ width: 390, height: 954 })
  await page.goto('/adventure')
  const create = page.getByRole('button', { name: '新建主线', exact: true })
  await create.click()
  const dialog = page.getByRole('dialog', { name: '创建主线', exact: true })
  await expect(dialog.getByRole('button', { name: '关闭弹窗' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(create).toBeFocused()
})

test('目标深链自动进入规划，刷新保持详情，收起后保留规划标签', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto(`/adventure?goalId=${goalId}`)
  const planningTab = page.getByRole('navigation', { name: '冒险页面', exact: true }).getByRole('button', { name: '主线与目标', exact: true })
  const details = page.getByRole('region', { name: '目标详情', exact: true })
  await expect(planningTab).toHaveAttribute('aria-current', 'page')
  await expect(details).toContainText('连续跑完五公里')
  await expect(page.locator('.adventure-proto-task-section, .adventure-proto-aside')).toHaveCount(0)
  await page.reload()
  await expect(planningTab).toHaveAttribute('aria-current', 'page')
  await expect(details).toContainText('连续跑完五公里')
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(page).toHaveURL('/adventure?view=planning')
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
  const planningTab = page.getByRole('navigation', { name: '冒险页面', exact: true }).getByRole('button', { name: '主线与目标', exact: true })
  await expect(planningTab).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.adventure-proto-task-section, .adventure-proto-aside')).toHaveCount(0)
  const history = page.getByRole('region', { name: '主线历史', exact: true })
  await expect(history).toContainText('已结束 · 只读')
  await expect(history).toContainText('结束时间')
  await expect(history).toContainText('五公里')
  await expect(page.getByLabel('显示已达成／已结束', { exact: true })).not.toBeChecked()
  await page.reload()
  await expect(planningTab).toHaveAttribute('aria-current', 'page')
  await expect(history).toContainText('已结束 · 只读')
  await page.getByRole('button', { name: '收起详情', exact: true }).click()
  await expect(history).toHaveCount(0)
  await expect(page).toHaveURL('/adventure?view=planning')
})

test('键盘收起内联详情后焦点回到对应摘要', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure?view=planning')
  const summary = page.getByRole('button', { name: '目标：五公里', exact: true })
  await summary.click()
  await page.getByRole('region', { name: '目标详情', exact: true }).getByRole('button', { name: '聚焦', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(summary).toBeFocused()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: '目标详情', exact: true })).toHaveCount(0)
})

test('主线目标页展示经验概览，目标聚焦筛选请求由后端分页', async ({ page, context }) => {
  const server = await planningFixture(context, { ...state, mainlines: [{ ...state.mainlines[0], activeGoalCount: 8, todayTaskCount: 3 }] })
  await page.goto('/adventure?view=planning')
  await expect(page.getByRole('article', { name: '主线：健康', exact: true })).toContainText('8 个目标')
  await expect(page.getByRole('region', { name: '经验概览', exact: true })).toContainText('累计经验79')
  await expect(page.locator('.level-note')).toHaveCount(0)
  server.show({ ...state, goalScope: 'focus', goals: [], totalGoals: 0 })
  const query = page.waitForRequest(request => request.url().includes('/api/adventure?') && new URL(request.url()).searchParams.get('goalScope') === 'focus')
  await page.getByLabel('目标视图').getByRole('button', { name: '聚焦', exact: true }).click()
  await query
  await expect(page.getByRole('button', { name: '目标：五公里', exact: true })).toHaveCount(0)
})

test('目标编辑取消后焦点回到对应目标摘要', async ({ page, context }) => {
  await planningFixture(context, state)
  await page.goto('/adventure?view=planning')
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
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '新建行动', exact: true }).click()
  await expect(page.getByLabel('任务归属').getByRole('option', { name: '健康 / 五公里', exact: true })).toBeAttached()
  await page.getByLabel('任务归属').selectOption(goalId)
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('目标视图').getByRole('button', { name: '聚焦', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('主线只展开一层，查看历史不会收起卡片，更多仅一组', async ({ page, context }) => {
  const server = await planningFixture(context, state)
  await page.goto('/adventure?view=planning')
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
  await page.getByRole('button', { name: '新建行动', exact: true }).click()
  await expect(page.getByLabel('任务归属').locator('option:disabled')).toHaveCount(0)
  await expect(page.getByLabel('任务归属')).not.toContainText('五公里')
})

test('验收反馈：主线历史不改变下面的目标列表', async ({ page, context }) => {
  await planningFixture(context, state)
  await context.route('**/api/adventure?**', route => {
    const history = new URL(route.request().url()).searchParams.has('mainlineId')
    return route.fulfill({ json: history ? { ...state, mainlineDetail: state.mainlines[0], goals: [], totalGoals: 0 } : state })
  })
  await page.goto('/adventure?view=planning')
  const goal = page.getByRole('article', { name: '目标卡：五公里', exact: true })
  await expect(goal).toBeVisible()
  const card = page.getByRole('article', { name: '主线：健康', exact: true })
  await card.getByRole('button', { name: '主线：健康', exact: true }).click()
  await card.getByRole('button', { name: '查看历史', exact: true }).click()
  await expect(card.getByRole('region', { name: '主线历史', exact: true })).toContainText('共 0 个目标')
  await expect(goal).toBeVisible()
})


test('主线历史保留名称并可切换到隐藏终态目标的单层详情', async ({ page, context }) => {
  const ended = { ...state.goals[0], status: 'ended' as const, terminatedAt: '2026-10-20T05:00:00Z', focused: false }
  const base = { ...state, goals: [], totalGoals: 0 }
  await planningFixture(context, base)
  await context.route('**/api/adventure?**', route => {
    const query = new URL(route.request().url()).searchParams
    const value = query.has('mainlineId') ? { ...base, mainlineDetail: state.mainlines[0], goals: [ended], totalGoals: 1 }
      : query.has('goalId') ? { ...base, goalDetail: { goal: ended, tasks: [], taskPage: 1, totalTasks: 0 } } : base
    return route.fulfill({ json: value })
  })
  await page.goto('/adventure?view=planning')
  const card = page.getByRole('article', { name: '主线：健康', exact: true })
  await card.getByRole('button', { name: '主线：健康', exact: true }).click()
  await card.getByRole('button', { name: '查看历史', exact: true }).click()
  const history = card.getByRole('region', { name: '主线历史', exact: true })
  await expect(history.getByRole('heading', { name: '健康', exact: true })).toBeVisible()
  await history.getByRole('button', { name: '查看目标：五公里', exact: true }).click()
  await expect(history).toHaveCount(0)
  const details = page.getByRole('region', { name: '目标详情', exact: true })
  await expect(details).toContainText('连续跑完五公里')
  await expect(details).toContainText('创建时间：')
  await expect(details).toContainText('终态时间：')
  await expect(details).toContainText('暂无任务历史。')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('显示已达成／已结束', { exact: true })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(card.getByRole('button', { name: '主线：健康', exact: true })).toBeFocused()
})
