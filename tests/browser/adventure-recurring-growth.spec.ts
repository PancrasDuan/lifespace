import { test, expect } from './authenticated-test'
import { recurringFixture, children, workspace } from './adventure-recurring-fixture'

// Actual source facts carry no one-time planned date. Current parent/goal names
// must never be substituted for this occurrence's frozen attribution.
test('成长周期来源保留快照并正确处理null计划日，不读取一次性安排链', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  const child = children[0], snapshot = { ...child.snapshot, goalTitle: '完成时旧目标', title: '完成时旧名称' }
  const event = { id: child.completionId, kind: 'task_completed', entityId: child.id, title: snapshot.title, occurredAt: snapshot.occurredAt, occurredOn: snapshot.occurredOn, amount: 1, goalId: snapshot.goalId, goalTitle: snapshot.goalTitle, categoryLabel: null, recurring: snapshot, calculation: child.reward.calculation }
  const achievements = [1, 10, 40, 100, 1, 3, 10].map((threshold, index) => ({ id: `${index < 4 ? 'actions' : 'goals'}_${threshold}`, label: `成就 ${index + 1}`, threshold, count: 0, remaining: threshold, unlocked: false }))
  await context.route('**/api/adventure/growth**', route => route.fulfill({ json: { version: workspace.version, growth: { ...workspace.growth, achievements }, pageSize: 10, total: 1, items: [event], nextCursor: null } }))
  await context.route('**/api/adventure/reward-source**', route => route.fulfill({ json: { version: workspace.version, event, description: snapshot.description, plannedOn: null, standards: [], reflection: null, page: 1, pageSize: 5, totalSources: 1,
    actionSources: [{ taskId: child.id, completionId: child.completionId, occurredOn: snapshot.occurredOn, title: snapshot.title, description: snapshot.description, plannedOn: null, goalId: snapshot.goalId, goalTitle: snapshot.goalTitle, categoryLabel: null, recurring: snapshot }] } }))
  await page.goto('/adventure?view=growth')
  await page.getByRole('button', { name: /查看来源：完成时旧名称/ }).click()
  const source = page.getByRole('region', { name: '完成时旧名称的奖励来源' })
  await expect(source.getByText('周期完成 · 第 2 期 · 每周 5 次', { exact: true })).toBeVisible()
  await expect(source.getByText('完成时旧目标', { exact: true }).first()).toBeVisible()
  await expect(source).not.toContainText('原安排 null')
  await expect(source).not.toContainText('发生时安排')
  expect(fixture.requests.some(request => request.path.endsWith('/task-history'))).toBe(false)
})
