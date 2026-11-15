import { mkdir } from 'node:fs/promises'
import { test, expect, type Page } from './authenticated-test'
import { initial, parent, children, workspace, future, uuid, makeChild, recurringFixture, type RecurringFixture } from './adventure-recurring-fixture'

const output = 'docs/evidence/200-recurring-frontend'
const modal = (page: Page) => page.getByRole('dialog')
const after = (patch: Partial<RecurringFixture>): RecurringFixture => ({ ...structuredClone(initial), ...patch })
const version = () => ({ ...structuredClone(workspace), version: 21 })
async function capture(page: Page, name: string) {
  await mkdir(output, { recursive: true })
  const inDialog = !!(await modal(page).count())
  // The reference initializes dialog states at the top of the underlying page.
  if (inDialog) {
    await page.evaluate(() => window.scrollTo(0, 0))
    const toastClose = modal(page).getByRole('button', { name: '关闭成功提示' })
    if (await toastClose.count()) await toastClose.click()
  }
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: !inDialog, animations: 'disabled' })
}
async function openParent(page: Page) { await page.getByRole('button', { name: '刷 LeetCode', exact: true }).click(); await expect(modal(page).getByRole('heading', { name: '关联子任务' })).toBeVisible() }
async function choose(page: Page, date: string) {
  while (!await page.getByRole('button', { name: `选择日期 ${date}`, exact: true }).count()) await page.getByRole('button', { name: '下一周', exact: true }).click()
  await page.getByRole('button', { name: `选择日期 ${date}`, exact: true }).click()
}
for (const mobile of [false, true]) {
  test(`approved-v1 ${mobile ? '手机' : '桌面'} 视觉/交互与范围捕获`, async ({ page, context }) => {
    test.setTimeout(90000)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    const fixture = await recurringFixture(context)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const suffix = mobile ? 'mobile-390' : 'desktop-1440'
    await page.goto('/adventure')
    await expect(page.getByRole('button', { name: '记录一次', exact: true })).toBeEnabled()
    await capture(page, `today-${suffix}`)
    await openParent(page); await capture(page, `parent-${suffix}`)
    await modal(page).getByRole('button', { name: /查看子任务.*11月15日 09:42/ }).click()
    await expect(modal(page).getByText('完成时归属')).toBeVisible(); await capture(page, `child-${suffix}`)
    await modal(page).getByRole('button', { name: /父任务/ }).click()
    await expect(modal(page).getByText('3 项', { exact: true })).toBeVisible()
    await modal(page).getByRole('button', { name: '编辑任务', exact: true }).click()
    await expect(modal(page).getByLabel('开始日期不可修改')).toBeVisible()
    await expect(modal(page).locator('input[type=date]')).toHaveCount(0)
    await capture(page, `edit-${suffix}`)
    await page.keyboard.press('Escape'); await expect(modal(page)).toHaveCount(0)
    await openParent(page); await modal(page).getByRole('button', { name: '结束任务', exact: true }).click()
    await expect(modal(page).getByRole('button', { name: '确认结束' })).toBeEnabled()
    await expect(modal(page).getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await capture(page, `end-${suffix}`); await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    await expect(modal(page).getByLabel('任务名称')).toBeFocused()
    await capture(page, `create-${suffix}`); await page.keyboard.press('Escape')
    await choose(page, '2026-12-01')
    await expect(page.getByRole('button', { name: '季度作品复盘', exact: true })).toBeVisible()
    await capture(page, `unstarted-date-${suffix}`)
    if (!mobile) {
      await page.getByRole('button', { name: '季度作品复盘', exact: true }).click(); await expect(modal(page).getByText('暂无关联子任务')).toBeVisible(); await capture(page, 'unstarted-detail-desktop-1440')
      await modal(page).getByRole('button', { name: '删除任务', exact: true }).click(); await expect(modal(page).getByRole('button', { name: '确认删除' })).toBeEnabled(); await capture(page, 'delete-desktop-1440'); await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: '回到今天', exact: true }).click(); await page.getByRole('button', { name: '选择日期 2026-11-14', exact: true }).click()
    await expect(page.getByRole('button', { name: '写一篇读书笔记', exact: true })).toBeVisible(); await capture(page, `ended-date-${suffix}`)
    if (!mobile) {
      await page.getByRole('button', { name: '写一篇读书笔记', exact: true }).click(); await expect(modal(page).getByText('结束日期')).toBeVisible(); await capture(page, 'ended-detail-desktop-1440'); await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '选择日期 2026-11-12', exact: true }).click(); await expect(page.getByRole('button', { name: '查看子任务详情 写一篇读书笔记' })).toBeVisible(); await capture(page, 'completed-date-desktop-1440')
    }
    await page.getByRole('button', { name: '目标', exact: true }).click(); await expect(page.getByRole('table', { name: '目标列表' })).toBeVisible(); await capture(page, `goals-${suffix}`)
    await expect(page.getByRole('row').filter({ hasText: '提升编程能力' }).getByText('3 项', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '关系卡片' }).first()).toBeEnabled()
    expect(errors).toEqual([])
    expect(fixture.envelopes).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  })
}

test('记录直接提交、重复点击拦截、成功toast及回读失败只重读', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/adventure'); await expect(page.getByRole('button', { name: '记录一次', exact: true })).toBeEnabled()
  fixture.saved(after({ workspace: { ...version(), growth: { ...workspace.growth, totalXp: 233, actions: 127, progress: 73, remaining: 27 }, todayTaskProgress: { completed: 5, total: 6, ratio: 5 / 6 } }, parents: [{ ...parent, currentPeriod: { ...parent.currentPeriod!, completed: 4, ratio: .8 }, effectiveChildren: 4 }, ...initial.parents.slice(1)], children: [makeChild(104, parent, workspace.today, '14:36', true), ...children] }))
  fixture.delay(150)
  await page.getByRole('button', { name: '记录一次', exact: true }).dblclick()
  await expect(modal(page)).toHaveCount(0); await expect(page.getByRole('status').filter({ hasText: '已完成，获得 1 点经验' })).toBeVisible()
  expect(fixture.envelopes).toHaveLength(1)
  expect(fixture.envelopes[0]).toMatchObject({ expectedVersion: 20, command: { type: 'recordRecurringCompletion', id: parent.id, today: workspace.today } })
  await capture(page, 'record-toast-desktop-1440')
  await page.getByRole('button', { name: '关闭成功提示' }).click(); await expect(page.locator('.planning-toast')).toHaveCount(0)
  fixture.saved(after({ workspace: { ...version(), version: 22 } })); fixture.failRead()
  await page.getByRole('button', { name: '记录一次', exact: true }).click()
  await expect(page.getByText('操作已成功，页面更新失败。请重新读取。')).toBeVisible()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '记录一次', exact: true })).toBeEnabled()
  expect(fixture.envelopes).toHaveLength(2)
})

test('合法撤销返回同父、过滤关联、最后一项为空且toast在dialog内', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/adventure'); await openParent(page)
  await modal(page).getByRole('button', { name: /查看子任务.*11月15日 09:42/ }).click()
  fixture.saved(after({ workspace: version(), parents: [{ ...parent, effectiveChildren: 2, currentPeriod: { ...parent.currentPeriod!, completed: 2, ratio: .4 } }, ...initial.parents.slice(1)], children: children.filter(child => child.id !== uuid(103)) }))
  await modal(page).getByRole('button', { name: '撤销本次完成' }).click()
  await expect(modal(page).getByText('2 项', { exact: true })).toBeVisible(); await expect(modal(page).getByRole('button', { name: /查看子任务.*11月15日 09:42/ })).toHaveCount(0)
  await expect(modal(page).locator('.planning-toast')).toBeVisible(); await modal(page).getByRole('button', { name: '关闭成功提示' }).click(); await capture(page, 'revoked-filtered-desktop-1440')
  const single = after({ workspace: { ...version(), version: 22 }, parents: [{ ...parent, effectiveChildren: 1, currentPeriod: { ...parent.currentPeriod!, completed: 1, ratio: .2 } }, ...initial.parents.slice(1)], children: [children[0], ...children.filter(child => child.parentId !== parent.id)] })
  fixture.show(single); await page.reload(); await openParent(page)
  await modal(page).getByRole('button', { name: /查看子任务.*11月15日 09:42/ }).click()
  fixture.saved(after({ workspace: { ...version(), version: 23 }, parents: [{ ...parent, effectiveChildren: 0, currentPeriod: { ...parent.currentPeriod!, completed: 0, ratio: 0 } }, ...initial.parents.slice(1)], children: children.filter(child => child.parentId !== parent.id) }))
  await modal(page).getByRole('button', { name: '撤销本次完成' }).click()
  await expect(modal(page).getByText('0 项', { exact: true })).toBeVisible(); await expect(modal(page).getByText('暂无关联子任务')).toBeVisible()
})

test('要求降到4/3保留实际数与固定快照，不提交周期/已开始日期', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/adventure'); await openParent(page)
  await modal(page).getByRole('button', { name: '编辑任务', exact: true }).click(); await modal(page).getByLabel('每期次数').fill('3')
  const lowered = { ...parent, requiredCount: 3, completedPeriods: 2, currentPeriod: { ...parent.currentPeriod!, completed: 4, required: 3, ratio: 1, satisfied: true }, capabilities: { ...parent.capabilities, recordRecurringCompletion: { allowed: false } } }
  fixture.saved(after({ workspace: version(), parents: [{ ...lowered, effectiveChildren: 4 }, ...initial.parents.slice(1)], children: [makeChild(104, parent, workspace.today, '14:36', true), ...children] }))
  await modal(page).getByRole('button', { name: '保存任务' }).click(); await expect(modal(page)).toHaveCount(0)
  expect(fixture.envelopes[0].command).toEqual({ type: 'editRecurringTask', id: parent.id, title: parent.title, description: parent.description, requiredCount: 3, destination: parent.goalId, today: workspace.today })
  await openParent(page); await expect(modal(page).getByText('4 / 3', { exact: true })).toBeVisible(); await capture(page, 'lowered-requirement-desktop-1440')
  await modal(page).getByRole('button', { name: /查看子任务.*11月15日 09:42/ }).click(); await expect(modal(page).getByText('每周 5 次', { exact: true })).toBeVisible()
})

test('跨天明确409只刷新日期能力，主动刷新后不自动补交', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/adventure')
  fixture.saved(after({ workspace: { ...workspace, today: '2026-11-16' } })); fixture.fail(409, 'PLANNING_DATE_CHANGED')
  await page.getByRole('button', { name: '记录一次', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新日期', exact: true })).toBeVisible(); expect(fixture.envelopes).toHaveLength(1)
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  await capture(page, 'crossday-desktop-1440')
  await page.getByRole('button', { name: '刷新日期', exact: true }).click(); await expect(page.getByRole('button', { name: '刷新日期', exact: true })).toHaveCount(0)
  expect(fixture.envelopes).toHaveLength(1)
})

test('未知响应保留封套，只读回执确认不再次发送', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.goto('/adventure'); fixture.loseResponse(); await page.getByRole('button', { name: '记录一次', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认上次操作结果', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认上次操作结果', exact: true }).click()
  await expect.poll(() => fixture.lookups.length).toBe(1)
  expect(fixture.envelopes).toHaveLength(1)
  expect(fixture.lookups[0]).toMatchObject(fixture.envelopes[0])
})

test('未激活能力不开放周期写，保持旧一次性创建', async ({ page, context }) => {
  const { planningFixture } = await import('./adventure-fixture')
  await planningFixture(context, { ...workspace, recurring: undefined })
  await page.goto('/adventure'); await page.getByRole('button', { name: '新建行动', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '周期任务', exact: true })).toHaveCount(0)
  await expect(modal(page).getByLabel('任务名称')).toBeVisible()
})

test('新建类型切换、真实目标ID、正整数校验及键盘操作', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.goto('/adventure'); await page.getByRole('button', { name: '新建行动', exact: true }).click()
  await modal(page).getByLabel('任务名称').fill('每季复盘')
  await modal(page).getByLabel('周期', { exact: true }).selectOption('quarter')
  await modal(page).getByLabel('任务归属').selectOption(uuid(11))
  await modal(page).getByLabel('每期次数').fill('1.5')
  await modal(page).getByRole('button', { name: '创建任务' }).click()
  expect(fixture.envelopes).toHaveLength(0)
  await modal(page).getByLabel('每期次数').fill('3')
  await modal(page).getByLabel('开始日期').fill('2026-12-01')
  await modal(page).getByRole('button', { name: '创建任务' }).click(); await expect(modal(page)).toHaveCount(0)
  expect(fixture.envelopes[0].command).toMatchObject({ type: 'createRecurringTask', periodType: 'quarter', requiredCount: 3, destination: uuid(11), startOn: '2026-12-01', today: workspace.today })
  await page.getByRole('button', { name: '新建行动', exact: true }).click(); await modal(page).getByRole('button', { name: '一次性任务', exact: true }).click()
  await modal(page).getByLabel('任务名称').fill('一次完整行动')
  await modal(page).getByRole('button', { name: '创建任务' }).click(); await expect(modal(page)).toHaveCount(0)
  expect(fixture.envelopes[1].command).toEqual({ type: 'createTask', title: '一次完整行动', description: '', destination: '', plannedOn: workspace.today })
  await page.getByRole('button', { name: '新建行动', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(modal(page).getByLabel('任务名称')).toBeFocused()
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog'))).toBe(true) }
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '新建行动', exact: true })).toBeFocused()
})

test('父/子/行动独立服务端分页，共用搜索且全量进度不按本页计算', async ({ page, context }) => {
  const manyChildren = Array.from({ length: 12 }, (_, i) => ({ ...children[0], id: uuid(400 + i), completionId: uuid(1400 + i), snapshot: { ...children[0].snapshot, childId: uuid(400 + i), title: `快照${i}` }, reward: { ...children[0].reward, calculation: { ...children[0].reward.calculation, completionId: uuid(1400 + i) } } }))
  const manyParents = Array.from({ length: 12 }, (_, i) => ({ ...parent, id: uuid(500 + i), title: `父任务${i}`, effectiveChildren: i === 0 ? 12 : 0 }))
  manyChildren.forEach(child => { child.parentId = uuid(500); child.snapshot.parentId = uuid(500) })
  const fixture = await recurringFixture(context, { workspace, parents: manyParents, children: manyChildren })
  await page.goto('/adventure')
  await expect(page.getByRole('group', { name: '今日任务进度', exact: true })).toHaveText('今日进度4 / 5')
  await page.getByRole('button', { name: '下一页周期任务', exact: true }).click(); await expect(page.getByRole('button', { name: '父任务11', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页任务', exact: true }).click(); await expect(page.getByText('共 15 项 · 第 2 页', { exact: true })).toBeVisible()
  await page.getByLabel('搜索任务', { exact: true }).fill('父任务0'); await expect(page.getByRole('button', { name: '父任务0', exact: true })).toBeVisible()
  expect(fixture.requests.filter(request => request.path.endsWith('/list')).every(request => (request.body as { today: string }).today === workspace.today)).toBe(true)
  await page.getByRole('button', { name: '父任务0', exact: true }).click(); await expect(modal(page).getByText('12 项', { exact: true })).toBeVisible()
  await modal(page).getByRole('button', { name: '下一页子任务' }).click(); await expect(modal(page).getByRole('button', { name: /查看子任务/ })).toHaveCount(2)
  await expect(modal(page).getByText('12 项', { exact: true })).toBeVisible()
})

test('未开始改日后入口移动、删除与结束保留确认，无历史/未来运行中预测', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.goto('/adventure'); await choose(page, '2026-12-01'); await page.getByRole('button', { name: '季度作品复盘', exact: true }).click()
  await modal(page).getByRole('button', { name: '编辑任务', exact: true }).click(); await modal(page).getByLabel('开始日期').fill('2026-12-02')
  fixture.saved(after({ workspace: version(), parents: [parent, ...initial.parents.slice(1, 2), { ...future, startOn: '2026-12-02' }, initial.parents[3]] }))
  await modal(page).getByRole('button', { name: '保存任务' }).click(); await expect(page.getByRole('button', { name: '季度作品复盘', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '选择日期 2026-12-02', exact: true }).click(); await page.getByRole('button', { name: '季度作品复盘', exact: true }).click()
  await modal(page).getByRole('button', { name: '删除任务', exact: true }).click(); await expect(modal(page).getByRole('button', { name: '确认删除' })).toBeEnabled()
  await modal(page).getByRole('button', { name: '确认删除' }).click(); await expect(modal(page)).toHaveCount(0)
  expect(fixture.envelopes[1].command).toEqual({ type: 'deleteRecurringTask', id: future.id, today: workspace.today })
  await page.getByRole('button', { name: '回到今天', exact: true }).click(); await openParent(page); await modal(page).getByRole('button', { name: '结束任务', exact: true }).click()
  await modal(page).getByRole('button', { name: '确认结束' }).click(); await expect(modal(page)).toHaveCount(0)
  expect(fixture.envelopes[2].command).toEqual({ type: 'endRecurringTask', id: parent.id, today: workspace.today })
})
