import { test, expect } from './authenticated-test'
import { allowed, later, planningFixture, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'

// UI recovery fixture only; persistence is covered by adventure-growth-database.spec.ts.
const id = '00000000-0000-4000-8000-000000000062'
const initial: PlanningPage = { ...withGoal, totalTasks: 1, capabilities: { ...withGoal.capabilities, createTask: allowed },
  tasks: [{ id, title: '待提交行动', description: '', plannedOn: withGoal.today, status: 'pending', completedOn: null,
    completionId: null, reward: null, completionOrigin: null, arrangements: [], totalArrangements: 0,
    goalId: null, goalTitle: null, mainlineName: '独立区', independent: true, overdue: false,
    progress: { completed: 0, total: 1, ratio: 0 }, capabilities: { complete: allowed, cancel: later } }] }

test('提交尚未完成时，所有成长入口禁用，不会提前读取旧流水', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3 })
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const seen = new Promise<void>(resolve => { started = resolve })
  await context.route('**/api/adventure/commands', async route => { started(); await held; await route.fallback() })
  await page.goto('/adventure')
  await page.getByRole('article', { name: '任务：待提交行动', exact: true }).getByRole('button', { name: '完成', exact: true }).click()
  await seen
  try {
    expect(await page.getByRole('button', { name: '成长记录', exact: true }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: '查看全部成就与流水', exact: true }).isDisabled()).toBe(true)
  } finally { release() }
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(1)
})

test('结果未知时侧栏不能隐藏安全重试，重试保持原封套', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3 })
  await page.goto('/adventure')
  server.loseNextResponse()
  await page.getByRole('article', { name: '任务：待提交行动', exact: true }).getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  expect(await page.getByRole('button', { name: '查看全部成就与流水', exact: true }).isDisabled()).toBe(true)
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
})
