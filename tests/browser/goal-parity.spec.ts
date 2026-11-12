import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'

for (const width of [1440, 390]) test(`${width}px 目标控制台和关系卡与已确认布局一致`, async ({ page, context }) => {
  const goal = { ...withGoal.goals[0], title: '完成一项目标', categoryLabel: '健康', standards: ['第一条完成标准', '第二条完成标准'], progress: { completed: 1, total: 3, ratio: 1 / 3 }, capabilities: { ...withGoal.goals[0].capabilities, achieve: { allowed: false, reason: '请先处理未完成任务' }, end: { allowed: false, reason: '请先删除未完成任务，或移到其他目标' } } }
  const tasks = [
    { id: '00000000-0000-4000-8000-000000000101', title: '已经完成的行动', plannedOn: '2026-11-02', completedAt: '2026-11-02T04:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000102', title: '下一步行动', plannedOn: '2026-11-13', completedAt: null },
    { id: '00000000-0000-4000-8000-000000000103', title: '最后一步行动', plannedOn: '2026-11-15', completedAt: null },
  ]
  await planningFixture(context, { ...withGoal, goals: [goal], goalDetail: { goal, tasks: [], taskPage: 1, totalTasks: 3, relatedTasks: tasks, totalRelatedTasks: 3 } })
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/adventure?view=planning')
  await expect(page.getByRole('row', { name: /完成一项目标/ })).toBeVisible()
  await page.screenshot({ path: `.cache/scope-correction/final-${width}-list.png`, fullPage: true })
  await page.getByRole('button', { name: '关系卡片' }).click()
  const dialog = page.getByRole('dialog', { name: '目标详情' })
  await expect(dialog).toContainText('第一条完成标准')
  await expect(dialog.locator('.goal-relation-front .goal-relation-hint')).toHaveCount(1)
  await expect(dialog.locator('.goal-relation-front .goal-relation-hint')).toContainText('还有 2 项未完成任务，处理后才能达成或结束。')
  await page.screenshot({ path: `.cache/scope-correction/final-${width}-detail.png` })
  await dialog.getByRole('button', { name: '相关任务' }).click()
  await expect(dialog.locator('.goal-relation')).toHaveClass(/is-tasks/)
  await expect(dialog.locator('.goal-relation-front')).toHaveAttribute('inert', '')
  await expect(dialog.getByRole('button', { name: '返回目标详情' })).toBeFocused()
  await expect(dialog).toContainText('下一步行动')
  await expect(dialog.getByRole('listitem').first()).toContainText('已完成')
  await expect(dialog.getByRole('listitem').nth(1)).toContainText('待完成')
  await expect(dialog.getByText('下一步行动')).toHaveCSS('font-size', '11px')
  await expect(dialog.getByText('计划 2026-11-13')).toHaveCSS('font-size', '10px')
  await expect(dialog.getByText('RELATED TASKS', { exact: true })).toBeVisible()
  await expect.poll(() => dialog.locator('.goal-relation-turn').evaluate(element => getComputedStyle(element).transform)).toBe('matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)')
  await page.screenshot({ path: `.cache/scope-correction/final-${width}-tasks.png` })
  await page.keyboard.press('Escape')
  const metrics = await page.evaluate(() => {
    const get = (selector: string) => { const e = document.querySelector<HTMLElement>(selector); if (!e) return null; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), background: s.backgroundColor, borderRadius: s.borderRadius, font: s.fontSize, display: s.display } }
    return { toolbar: get('.adventure-toolbar'), section: get('.adventure-proto-goal-section'), head: get('.goal-console-head'), row: get('.goal-console-row'), category: get('.goal-console-category'), view: get('.view-tabs') }
  })
  console.log(`PARITY ${width}`, JSON.stringify(metrics))
  const category = page.getByRole('row', { name: /完成一项目标/ }).getByText('健康', { exact: true })
  await expect.poll(() => category.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(8)
  await expect.poll(() => category.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.getByText('阶段成果')).toBeVisible()
  await expect(page.locator('.goal-console-status-cell')).toContainText('进行中')
  await expect(page.locator('.goal-console-heading')).toContainText('查看目标及其关联任务的进度')
  await expect(page.locator('.adventure-proto-goal-section > .planning-pagination')).toContainText('共 1 个目标 · 第 1 / 1 页')
  await expect(page.locator('.adventure-proto-goal-section > .planning-pagination').getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(metrics.section?.width).toBe(metrics.view?.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const width of [1440, 390]) test(`${width}px 多目标、长标签和空态不溢出`, async ({ page, context }) => {
  const goals = [
    { ...withGoal.goals[0], title: '一项有分类的目标', categoryLabel: '健康', progress: { completed: 1, total: 3, ratio: 1 / 3 } },
    { ...withGoal.goals[0], id: '00000000-0000-4000-8000-000000000056', title: '一项没有分类的目标', categoryLabel: null, progress: { completed: 0, total: 0, ratio: null } },
    { ...withGoal.goals[0], id: '00000000-0000-4000-8000-000000000057', title: '较长目标名称用于验证内容换行和操作控件', categoryLabel: '很长的分类标签用于验证不会遮挡相邻列和操作按钮', progress: { completed: 3, total: 3, ratio: 1 } },
  ]
  const fixture = await planningFixture(context, { ...withGoal, goals, totalGoals: 5, pageSize: 3 })
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/adventure?view=planning')
  await expect(page.getByRole('row', { name: /较长目标名称/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `.cache/scope-correction/final-${width}-multiple.png`, fullPage: true })
  fixture.show({ ...withGoal, goals: [], totalGoals: 0 })
  await page.reload()
  await expect(page.getByText('还没有目标。先创建一个目标，再为它添加任务。')).toBeVisible()
  await page.screenshot({ path: `.cache/scope-correction/final-${width}-empty.png`, fullPage: true })
})

test('手机目标页保留侧栏和唯一的新建入口，切换页签后仍可使用', async ({ page, context }) => {
  await planningFixture(context, { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed } })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/adventure?view=planning')
  await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开导航' })).toHaveCount(0)
  for (const name of ['新建目标', '新建行动']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
  const opener = page.getByRole('button', { name: '新建目标', exact: true })
  await opener.click()
  await expect(page.getByRole('dialog', { name: '创建目标' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await page.getByRole('button', { name: '今日聚焦', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeVisible()
})

test('窄屏长内容与关系卡可滚动，完整标题和操作保持可达', async ({ page, context }) => {
  const goal = { ...withGoal.goals[0], title: '长目标'.repeat(35), categoryLabel: '标签'.repeat(70), standards: Array.from({ length: 15 }, (_, index) => `完成标准 ${index + 1}：${'验证较长内容'.repeat(4)}`) }
  await planningFixture(context, { ...withGoal, goals: [goal], goalDetail: { goal, tasks: [], taskPage: 1, totalTasks: 0, relatedTasks: [], totalRelatedTasks: 0 } })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/adventure?view=planning')
  const row = page.getByRole('row', { name: /长目标/ })
  await expect(row).toContainText(goal.title)
  await expect(row).toContainText(goal.categoryLabel)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await row.getByRole('button', { name: '关系卡片' }).click()
  const dialog = page.getByRole('dialog', { name: '目标详情' })
  await expect(dialog).toContainText(goal.standards.at(-1)!)
  expect((await dialog.locator('header').boundingBox())!.height).toBeLessThan(125)
  const content = dialog.locator('.goal-relation-front .goal-relation-content')
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(content).toHaveCSS('scrollbar-width', 'none')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(dialog.getByRole('button', { name: '相关任务' })).toBeVisible()
  await page.screenshot({ path: '.cache/scope-correction/final-320-long-dialog.png' })
})
