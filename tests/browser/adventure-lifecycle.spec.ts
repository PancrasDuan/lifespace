import { test, expect } from './authenticated-test'
import { allowed, withGoal } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'

const initial: PlanningPage = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, end: allowed } }] }

test('终态偏好按已验证账户读取，账户切换不沿用其他账户设置', async ({ page, context }) => {
  const first = '00000000-0000-4000-8000-000000000001'
  const second = '00000000-0000-4000-8000-000000000066'
  let owner = first
  await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: owner, email: 'demo@example.com' } } }))
  await context.route('**/api/adventure**', route => {
    const includeTerminal = new URL(route.request().url()).searchParams.get('includeTerminal') === 'true'
    return route.fulfill({ json: { ...initial, includeTerminal } })
  })
  await page.goto('/adventure?view=planning')
  const toggle = page.getByLabel('显示已达成／已结束', { exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await page.reload()
  await expect(toggle).toBeChecked()
  owner = second
  await page.evaluate(id => localStorage.setItem('test-auth-owner', id), second)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  owner = first
  await page.evaluate(id => localStorage.setItem('test-auth-owner', id), first)
  await page.reload()
  await expect(toggle).toBeChecked()
})

test('终态偏好存储不可用仍可读取和切换，明确提示刷新不保留', async ({ page, context }) => {
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('lifespace.adventure.terminal.')) throw new DOMException('Denied', 'SecurityError')
      return get.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('lifespace.adventure.terminal.')) throw new DOMException('Denied', 'SecurityError')
      return set.call(this, key, value)
    }
  })
  await context.route('**/api/adventure**', route => route.fulfill({ json: { ...initial,
    includeTerminal: new URL(route.request().url()).searchParams.get('includeTerminal') === 'true' } }))
  await page.goto('/adventure?view=planning')
  await page.getByLabel('显示已达成／已结束', { exact: true }).check()
  await expect(page.getByText('终态显示偏好未保存；本页仍可查看，刷新后使用默认设置。')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('显示已达成／已结束', { exact: true })).not.toBeChecked()
})
