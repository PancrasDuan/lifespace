import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal } from './adventure-fixture'

const initial = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: {
  ...withGoal.goals[0].capabilities, focus: allowed, reorder: allowed, moveUp: allowed, moveDown: allowed,
} }] }

test('聚焦结果未知仅用原封套重试，回读前不乐观改变事实', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3, goals: [{ ...initial.goals[0], focused: true }] })
  server.loseNextResponse()
  await page.goto('/adventure')
  const card = page.getByRole('article', { name: '目标卡：五公里' })
  await openRecordActions(card)
  await card.getByRole('button', { name: '聚焦', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作' })).toBeVisible()
  await expect(card).not.toContainText('聚焦中')
  await expect(card.getByRole('button', { name: '聚焦', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '安全重试同一次操作' }).click()
  await expect(card).toContainText('聚焦中')
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
})

test('排序版本冲突重读且等待用户再次操作，不自动重放', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  server.saved({ ...initial, version: 3 })
  server.conflictNext()
  await page.goto('/adventure')
  await openRecordActions(page.locator('.adventure-proto-goal').first())
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


test('搜索读取失败后的恢复保留本次关键词，不返回旧筛选', async ({ page, context }) => {
  const state = { ...initial, capabilities: { ...initial.capabilities, createTask: allowed } }
  const server = await planningFixture(context, state)
  await page.goto('/adventure')
  await page.getByLabel('搜索任务', { exact: true }).fill('跑步')
  server.failNextQuery()
  await page.getByLabel('搜索任务', { exact: true }).press('Enter')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取')
  server.show({ ...state, search: '跑步' })
  const retried = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/adventure')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  expect(new URL((await retried).url()).searchParams.get('search')).toBe('跑步')
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('搜索任务', { exact: true })).toHaveValue('跑步')
})
