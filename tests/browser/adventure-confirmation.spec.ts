import { test, expect, type Page } from './authenticated-test'
import { openRecordActions } from './adventure-record-helpers'
import { allowed, later, planningFixture, withGoal, goalId } from './adventure-fixture'
import type { PlanningPage, PlanningPreview } from '../../src/shared/adventure-planning'

const taskId = '00000000-0000-4000-8000-000000000061'
const completionId = '00000000-0000-4000-8000-000000000062'
const reward = { amount: 1, calculation: { type: 'fixed_task' as const, completionId, count: 1, coefficient: 1 } }
const initial: PlanningPage = {
  ...withGoal, capabilities: { ...withGoal.capabilities, createTask: allowed }, totalTasks: 1,
  goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, achieve: allowed, end: allowed } }],
  tasks: [{ id: taskId, title: '确认流程行动', description: '', plannedOn: withGoal.today, rescheduleMin: withGoal.today,
    arrangements: [], totalArrangements: 0, status: 'pending', completedOn: null, completionId: null, reward: null, completionOrigin: null,
    goalId: null, goalTitle: null, mainlineName: '独立区', independent: true, overdue: false,
    progress: { completed: 0, total: 1, ratio: 0 }, capabilities: { reschedule: allowed } }],
}
const goalReward = (coefficient: number, count = 0) => ({ amount: count === 0 ? 1 : coefficient,
  calculation: { type: 'goal_actions' as const, actionIds: count === 0 ? [] : [taskId], count, coefficient, fallback: count === 0 } })
const lifecyclePreview: PlanningPreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true,
  operation: 'endGoal', entityId: goalId, title: '五公里', message: '已有完成及奖励保留',
  stoppingGoals: [], stoppingTasks: [], preservedCompletedTasks: 0, preservedAchievedGoals: 0 }
const achievementPreview: PlanningPreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true,
  operation: 'achieveGoal', goalId, title: '五公里', standards: ['连续跑完五公里'], message: '达成后只读',
  stoppingTasks: [], rewards: [goalReward(1), goalReward(2), goalReward(3)] }
const reschedulePreview: PlanningPreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true,
  operation: 'rescheduleTask', taskId, title: '确认流程行动', oldPlannedOn: initial.today, newPlannedOn: '2099-01-01', sourceEventId: taskId, message: '保留原安排' }
const completed: PlanningPage = { ...initial, tasks: [{ ...initial.tasks[0], status: 'completed', completedOn: initial.today, completionId, reward,
  capabilities: { reschedule: later, cancel: allowed } }], growth: { ...initial.growth, totalXp: 1, progress: 1, remaining: 19, actions: 1 } }
const cancelPreview: PlanningPreview = { version: 2, today: initial.today, allowed: true, requiresConfirmation: true,
  completionId, reward, growthBefore: completed.growth, growthAfter: initial.growth, message: '移除本次完成与经验' }
const achieved: PlanningPage = { ...initial, goals: [], totalGoals: 0,
  goalDetail: { goal: { ...initial.goals[0], status: 'achieved', focused: false, terminatedAt: '2026-10-22T00:00:00Z',
    achievement: { id: goalId, occurredOn: initial.today, reflection: '完成了', reward: goalReward(2) },
    capabilities: { edit: later, createTask: later, achieve: later, focus: later } }, tasks: [], taskPage: 1, totalTasks: 0 },
  growth: { ...initial.growth, totalXp: 1, progress: 1, remaining: 19, achievedGoals: 1 } }

async function openGoal(page: Page, action: string, menu = false) {
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  if (menu) await openRecordActions(page.locator('.adventure-proto-goal').first())
  await page.getByRole('button', { name: action, exact: true }).click()
}
async function openTask(page: Page, action: string) {
  await page.goto('/adventure')
  await openRecordActions(page.locator('.adventure-proto-task').first())
  await page.getByRole('button', { name: action, exact: true }).click()
}
type Scenario = {
  name: string; initial: PlanningPage; preview: PlanningPreview; changedPreview: PlanningPreview; saved: PlanningPage;
  confirm: string; repreview: string; open: (page: Page) => Promise<void>;
  inspectChanged?: (page: Page) => Promise<void>;
}
const scenarios: Scenario[] = [
  { name: '结束', initial, preview: lifecyclePreview,
    changedPreview: { ...lifecyclePreview, stoppingTasks: [{ id: taskId, title: '新增待停任务', plannedOn: initial.today }] },
    saved: { ...initial, goals: [], totalGoals: 0 }, confirm: '确认结束目标', repreview: '重新预览',
    open: page => openGoal(page, '结束目标', true),
    inspectChanged: async page => { await expect(page.getByRole('dialog')).toContainText('新增待停任务') } },
  { name: '达成', initial, preview: achievementPreview,
    changedPreview: { ...achievementPreview, rewards: [goalReward(1, 1), goalReward(2, 1), goalReward(3, 1)] },
    saved: achieved, confirm: '确认达成并入账', repreview: '重新预览达成',
    open: async page => {
      await openGoal(page, '确认达成')
      await page.getByLabel('成就感评价', { exact: true }).selectOption('2')
      await page.getByLabel('达成感想（可选）', { exact: true }).fill('完成了')
    },
    inspectChanged: async page => {
      await expect(page.getByLabel('成就感评价', { exact: true })).toHaveValue('2')
      await expect(page.getByLabel('达成感想（可选）', { exact: true })).toHaveValue('完成了')
      await expect(page.getByRole('dialog')).toContainText('目标奖励：2 点经验')
    } },
  { name: '改期', initial, preview: reschedulePreview, changedPreview: reschedulePreview,
    saved: { ...initial, tasks: [], totalTasks: 0 }, confirm: '确认改期', repreview: '预览改期',
    open: async page => {
      await openTask(page, '改期')
      await page.getByLabel('新的执行日期').fill('2099-01-01')
      await page.getByRole('button', { name: '预览改期', exact: true }).click()
    } },
  { name: '取消完成', initial: completed, preview: cancelPreview, changedPreview: cancelPreview,
    saved: initial, confirm: '确认取消完成', repreview: '重新预览', open: page => openTask(page, '取消完成') },
]

// Exercise the shared confirmation interface through its real UI callers and HTTP seam.
// These snapshots assert UI coordination; they do not prove database transactions.
for (const scenario of scenarios) {
  test(`${scenario.name}：未知重试沿用原封套，保存成功后回读失败只重新读取`, async ({ page, context }) => {
    const server = await planningFixture(context, scenario.initial)
    server.preview(scenario.preview)
    server.saved({ ...scenario.saved, version: 3 })
    await scenario.open(page)
    server.loseNextResponse()
    await page.getByRole('button', { name: scenario.confirm, exact: true }).click()
    await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: scenario.confirm, exact: true })).toBeDisabled()
    server.failNextQuery()
    await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(server.envelopes).toHaveLength(2)
    expect(server.envelopes[1]).toEqual(server.envelopes[0])
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
    expect(server.envelopes).toHaveLength(2)
    if (scenario.name === '达成') {
      await page.getByRole('button', { name: '查看达成结果', exact: true }).click()
      await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
    }
  })

  test(`${scenario.name}：409 后旧预览不能提交，重新预览并确认才生成新封套`, async ({ page, context }) => {
    const server = await planningFixture(context, scenario.initial)
    server.preview(scenario.preview)
    await scenario.open(page)
    server.saved({ ...scenario.initial, version: 3 })
    server.conflictNext()
    const confirm = page.getByRole('button', { name: scenario.confirm, exact: true })
    await confirm.click()
    await expect(confirm).toBeDisabled()
    // Even a programmatic event must pass the session's preview validity check.
    await confirm.evaluate(button => {
      const form = button.closest('form')
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      else button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(server.envelopes).toHaveLength(1)
    server.preview({ ...scenario.changedPreview, version: 3 })
    await page.getByRole('button', { name: scenario.repreview, exact: true }).click()
    await expect(confirm).toBeEnabled()
    await scenario.inspectChanged?.(page)
    server.saved({ ...scenario.saved, version: 4 })
    await confirm.click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(server.envelopes).toHaveLength(2)
    expect(server.envelopes[1].expectedVersion).toBe(3)
    expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
    if (scenario.name === '达成') {
      expect(server.envelopes[1].command).toMatchObject({ type: 'achieveGoal', coefficient: 2, reflection: '完成了' })
      await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
    }
  })
}

// The goal's More row has a baseline 390px layout issue recorded in #111.
// Exercise the same lifecycle confirmation through the task-ending entry on mobile.
const mobileScenarios = [
  { ...scenarios[0], name: '结束任务',
    initial: { ...initial, tasks: [{ ...initial.tasks[0], capabilities: { ...initial.tasks[0].capabilities, end: allowed } }] },
    preview: { ...lifecyclePreview, operation: 'endTask' as const, entityId: taskId, title: '确认流程行动' },
    saved: { ...initial, tasks: [], totalTasks: 0 }, confirm: '确认结束任务', open: (page: Page) => openTask(page, '结束任务') },
  ...scenarios.slice(1),
]
for (const scenario of mobileScenarios) {
  test(`${scenario.name}：手机视口正常确认保留成功去向`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const server = await planningFixture(context, scenario.initial)
    server.preview(scenario.preview)
    server.saved({ ...scenario.saved, version: 3 })
    await scenario.open(page)
    const confirm = page.getByRole('button', { name: scenario.confirm, exact: true })
    await expect(confirm).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await confirm.click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(server.envelopes).toHaveLength(1)
    expect(server.envelopes[0].expectedVersion).toBe(2)
    if (scenario.name === '达成') await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
  })

}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('关闭详情后迟到的首次预览不能重新打开确认弹窗', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(achievementPreview)
  const held = deferred(), release = deferred()
  await context.route('**/api/adventure/preview', async route => {
    held.resolve()
    await release.promise
    await route.fulfill({ json: achievementPreview })
  })
  try {
    await openGoal(page, '确认达成')
    await held.promise
    await page.keyboard.press('Escape')
    release.resolve()
    await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('region', { name: '目标详情', exact: true })).toBeHidden()
    expect(server.envelopes).toHaveLength(0)
  } finally { release.resolve() }
})

test('关闭确认后迟到的重新预览不能复用到下一次改期', async ({ page, context }) => {
  const scenario = scenarios[2]
  const server = await planningFixture(context, initial)
  server.preview(reschedulePreview)
  await scenario.open(page)
  const held = deferred(), release = deferred()
  await context.route('**/api/adventure/preview', async route => {
    held.resolve()
    await release.promise
    await route.fulfill({ json: reschedulePreview })
  })
  try {
    await page.getByRole('button', { name: '预览改期', exact: true }).click()
    await held.promise
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    release.resolve()
    await expect(page.getByRole('button', { name: '新建主线', exact: true })).toBeEnabled()
    await openRecordActions(page.locator('.adventure-proto-task').first())
    await page.getByRole('button', { name: '改期', exact: true }).click()
    await expect(page.getByLabel('新的执行日期')).toHaveValue('')
    await expect(page.getByRole('region', { name: '改期预览', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeDisabled()
    expect(server.envelopes).toHaveLength(0)
  } finally { release.resolve() }
})

test('关闭达成确认后迟到的成功回执只更新数据，不重新展开详情', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(achievementPreview)
  server.saved({ ...achieved, version: 3 })
  await scenarios[1].open(page)
  const held = deferred(), release = deferred()
  await context.route('**/api/adventure/commands', async route => {
    held.resolve()
    await release.promise
    await route.fallback()
  })
  try {
    await page.getByRole('button', { name: '确认达成并入账', exact: true }).click()
    await held.promise
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    release.resolve()
    await expect(page.getByRole('button', { name: '查看达成结果', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('region', { name: '目标详情', exact: true })).toBeHidden()
    expect(server.envelopes).toHaveLength(1)
    await page.getByRole('button', { name: '查看达成结果', exact: true }).click()
    await expect(page.getByRole('region', { name: '目标详情', exact: true })).toContainText('已达成 · 结果已冻结')
  } finally { release.resolve() }
})

test('不同操作或日期的预览不能作为当前确认依据', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.preview(achievementPreview)
  await openGoal(page, '结束目标', true)
  await expect(page.getByRole('alert')).toContainText('预览内容与当前操作不符')
  await expect(page.getByRole('dialog')).toBeHidden()
  server.preview({ ...reschedulePreview, newPlannedOn: '2099-02-01' })
  await scenarios[2].open(page)
  await expect(page.getByRole('alert')).toContainText('预览内容与当前操作不符')
  await expect(page.getByRole('button', { name: '确认改期', exact: true })).toBeDisabled()
  expect(server.envelopes).toHaveLength(0)
})
