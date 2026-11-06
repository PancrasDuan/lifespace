import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'
import type { GrowthPage } from '../../src/shared/adventure-growth'

const achievements = [1, 10, 40, 100, 1, 3, 10].map((threshold, index) => ({
  id: `${index < 4 ? 'actions' : 'goals'}_${threshold}`,
  label: `成就 ${index + 1}`, threshold, count: 0, remaining: threshold, unlocked: false,
}))
const state = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed } }
const growth: GrowthPage = { version: state.version, growth: { ...state.growth, achievements }, items: [], total: 0, pageSize: 10, nextCursor: null }
const entries = [
  { button: '新建主线', dialog: '创建主线', tab: '成长记录', url: '/adventure?view=growth' },
  { button: '新建目标', dialog: '创建目标', tab: '成长记录', url: '/adventure?view=growth' },
  { button: '新建行动', dialog: '创建任务', tab: '成长记录', url: '/adventure?view=growth' },
]

for (const direct of [false, true]) for (const entry of entries) {
  test(`${direct ? '直接打开' : '切换到'}成长记录后${entry.button}直接打开表单`, async ({ page, context }) => {
    await planningFixture(context, state)
    await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
    let planningRequests = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/adventure') planningRequests++
    })
    await page.goto(direct ? '/adventure?view=growth' : '/adventure')
    if (!direct) await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await expect(page.getByRole('region', { name: '经验概览' })).toBeVisible()
    if (direct) expect(planningRequests).toBe(0)
    const create = page.getByRole('button', { name: entry.button, exact: true })
    await expect(create).toBeEnabled()
    await create.click()
    const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page).toHaveURL(entry.url)
    await expect(page.getByRole('button', { name: entry.tab, exact: true })).toHaveAttribute('aria-current', 'page')
    if (direct) expect(planningRequests).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(create).toBeFocused()
    await expect(page).toHaveURL(entry.url)
  })
}

test('成长页首次读取创建数据失败后可重试并打开原表单', async ({ page, context }) => {
  const server = await planningFixture(context, state)
  server.failNextQuery()
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await page.goto('/adventure?view=growth')
  await page.getByRole('button', { name: '新建目标', exact: true }).click()
  const recovery = page.getByRole('alert').filter({ hasText: '暂时无法读取人生冒险' })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '创建目标', exact: true })).toBeVisible()
  await expect(page).toHaveURL('/adventure?view=growth')
})

test('取消失败的新建请求后，稍后重新读取不会意外打开表单', async ({ page, context }) => {
  const server = await planningFixture(context, state)
  server.failNextQuery()
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await page.goto('/adventure?view=growth')
  await page.getByRole('button', { name: '新建目标', exact: true }).click()
  const recovery = page.getByRole('alert').filter({ hasText: '暂时无法读取人生冒险' })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '今日聚焦', exact: true }).click()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('成长页首次读取后，受限的创建操作显示原因而不打开表单', async ({ page, context }) => {
  await planningFixture(context, { ...state, capabilities: { ...state.capabilities, createGoal: { allowed: false, reason: '暂不能创建目标' } } })
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await page.goto('/adventure?view=growth')
  await page.getByRole('button', { name: '新建目标', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('暂不能创建目标')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  await expect(page).toHaveURL('/adventure?view=growth')
})

for (const entry of [
  { button: '新建主线', dialog: '创建主线', name: '主线名称' },
  { button: '新建目标', dialog: '创建目标', name: '目标名称' },
]) for (const start of ['overview', 'growth'] as const) {
  test(`${start} 页${entry.button}失败后留在原页，成功后进入规划`, async ({ page, context }) => {
    const server = await planningFixture(context, state)
    await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
    const initialUrl = start === 'growth' ? '/adventure?view=growth' : '/adventure'
    const initialTab = start === 'growth' ? '成长记录' : '今日聚焦'
    await page.goto(initialUrl)
    await page.getByRole('button', { name: entry.button, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true })
    await dialog.getByLabel(entry.name).fill('新内容')
    if (entry.name === '目标名称') await dialog.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('完成')
    server.conflictNext()
    await dialog.getByRole('button', { name: entry.dialog, exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('数据已更新')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(initialUrl)
    await expect(page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: initialTab, exact: true })).toHaveAttribute('aria-current', 'page')
    await dialog.getByRole('button', { name: entry.dialog, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL('/adventure?view=planning')
    await expect(page.getByRole('button', { name: '主线与目标', exact: true })).toHaveAttribute('aria-current', 'page')
  })
}

for (const entry of [
  { button: '新建主线', dialog: '创建主线', name: '主线名称' },
  { button: '新建目标', dialog: '创建目标', name: '目标名称' },
]) test(`${entry.button}结果未知时安全重试成功后进入规划`, async ({ page, context }) => {
  const server = await planningFixture(context, state)
  await page.goto('/adventure')
  await page.getByRole('button', { name: entry.button, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true })
  await dialog.getByLabel(entry.name).fill('新内容')
  if (entry.name === '目标名称') await dialog.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('完成')
  server.loseNextResponse()
  await dialog.getByRole('button', { name: entry.dialog, exact: true }).click()
  await expect(page).toHaveURL('/adventure')
  await page.getByRole('button', { name: '安全重试同一次操作' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL('/adventure?view=planning')
  expect(server.envelopes[0].requestId).toBe(server.envelopes[1].requestId)
})

for (const entry of [
  { button: '新建主线', dialog: '创建主线', name: '主线名称' },
  { button: '新建目标', dialog: '创建目标', name: '目标名称' },
]) test(`成长页${entry.button}结果未知并关闭弹窗后仍可安全重试`, async ({ page, context }) => {
  const server = await planningFixture(context, state)
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await page.goto('/adventure?view=growth')
  await page.getByRole('button', { name: entry.button, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true })
  await dialog.getByLabel(entry.name).fill('新内容')
  if (entry.name === '目标名称') await dialog.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('完成')
  server.loseNextResponse()
  await dialog.getByRole('button', { name: entry.dialog, exact: true }).click()
  await expect(dialog.getByRole('button', { name: '安全重试同一次操作' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL('/adventure?view=growth')
  await page.getByRole('button', { name: '安全重试同一次操作' }).click()
  await expect(page).toHaveURL('/adventure?view=planning')
  expect(server.envelopes[0].requestId).toBe(server.envelopes[1].requestId)
})
