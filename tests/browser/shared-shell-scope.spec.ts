import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'

const output = process.env.SCOPE_CAPTURE_DIR
const reference = process.env.SCOPE_BASELINE_DIR
const achievements = [1, 10, 40, 100, 1, 3, 10].map((threshold, index) => ({
  id: `${index < 4 ? 'actions' : 'goals'}_${threshold}`, label: `成就 ${index + 1}`, threshold, count: 0, remaining: threshold, unlocked: false,
}))
const state = { ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed }, growth: { ...withGoal.growth, level: 4, totalXp: 79, actions: 12, achievedGoals: 2, remaining: 14, achievements } }
const growth = { version: state.version + 1, growth: state.growth, items: [], total: 0, pageSize: 10, nextCursor: null }

for (const width of [1440, 390]) test(`${width}px 三个页签共享页面上方区域与 0b14 基线一致`, async ({ page, context }) => {
  await planningFixture(context, state)
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: growth }))
  await page.setViewportSize({ width, height: 844 })
  const snapshots: Record<string, unknown> = {}
  for (const view of ['overview', 'planning', 'growth']) {
    await page.goto(`/adventure?view=${view}`)
    await expect(page.getByRole('navigation', { name: '冒险页面' }).getByRole('button', { name: view === 'overview' ? '今日聚焦' : view === 'planning' ? '目标' : '成长记录', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: '新建目标', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '新建行动', exact: true })).toHaveCount(1)
    await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
    await expect(page.locator('.page-heading')).toHaveCSS('text-align', 'center')
    await expect(page.locator('.adventure-toolbar')).toBeVisible()
    await expect(page.getByRole('region', { name: '经验概览' })).toBeVisible()
    await expect(page.locator('.sidebar')).toHaveCSS('width', width === 390 ? '54px' : '76px')
    await expect(page.getByRole('button', { name: '打开导航' })).toHaveCount(0)
    if (view === 'growth') await expect(page.getByRole('region', { name: '经验概览' })).toContainText('累计经验79')
    else await expect(page.getByRole('button', { name: '新建行动', exact: true }).first()).toBeEnabled()
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: `${output}/${width}-${view}.png` }) }
    snapshots[view] = await page.evaluate(() => {
      const measure = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) return null
        const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
        return { text: element.innerText.replace(/\s+/g, ' ').trim(), visible: bounds.width > 0 && bounds.height > 0 && style.display !== 'none', x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height), font: style.fontSize, align: style.textAlign }
      }
      return { heading: measure('.page-heading'), title: measure('.page-heading h1'), intro: measure('.page-heading p'), toolbar: measure('.adventure-toolbar'), growth: measure('.adventure-growth-bar'), tabs: measure('.view-tabs'), sidebar: measure('.sidebar'), newGoal: measure('.heading-actions .new-button'), mobileNavigation: measure('.goal-mobile-navigation') }
    })
  }
  expect(snapshots.planning).toEqual(snapshots.overview)
  expect(snapshots.growth).toEqual(snapshots.overview)
  if (output) writeFileSync(`${output}/${width}.json`, JSON.stringify(snapshots, null, 2))
  if (reference) expect(snapshots).toEqual(JSON.parse(readFileSync(`${reference}/${width}.json`, 'utf8')))
})
