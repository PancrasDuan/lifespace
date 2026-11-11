import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'

const initial = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: {
  ...withGoal.goals[0].capabilities, focus: allowed, reorder: allowed, moveUp: allowed, moveDown: allowed,
} }] }

test('目标列表不提供聚焦操作，排序不会按聚焦分组', async ({ page, context }) => {
  const server = await planningFixture(context, { ...initial, goals: [{ ...initial.goals[0], focused: true }] })
  await page.goto('/adventure?view=planning')
  const row = page.getByRole('row', { name: /五公里/ })
  await expect(row).not.toContainText('聚焦中')
  await expect(page.getByRole('button', { name: '聚焦', exact: true })).toHaveCount(0)
  expect(server.envelopes).toHaveLength(0)
})

test('排序版本冲突重读且等待用户再次操作，不自动重放', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.goto('/adventure?view=planning')
  const move = page.getByRole('button', { name: '上移目标 五公里', exact: true })
  await move.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('再次确认')
  expect(server.envelopes).toHaveLength(1)
  await move.click()
  await expect.poll(() => server.envelopes.length).toBe(2)
  expect(server.envelopes[1].expectedVersion).toBe(3)
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})


test('日期读取失败后的恢复保留本次关键词，不返回旧筛选', async ({ page, context }) => {
  const state = { ...initial, capabilities: { ...initial.capabilities, createTask: allowed } }
  const server = await planningFixture(context, state)
  await page.goto('/adventure')
  await page.getByLabel('搜索任务', { exact: true }).fill('跑步')
  server.failNextTaskQuery()
  await page.getByRole('button', { name: '下一周', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('暂时无法读取')
  const retried = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/adventure/tasks/list')
  await page.getByRole('button', { name: '重新读取任务', exact: true }).click()
  expect(new URL((await retried).url()).search).toBe('')
  await expect(page.getByRole('button', { name: '重新读取任务', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('搜索任务', { exact: true })).toHaveValue('跑步')
})
