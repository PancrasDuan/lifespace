import { test, expect } from './authenticated-test'
import { planningFixture, withGoal } from './adventure-fixture'

test('终态偏好在延迟读取期间不能因重复切换与列表分离', async ({ page, context }) => {
  await planningFixture(context, withGoal)
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const seen = new Promise<void>(resolve => { started = resolve })
  await context.route('**/api/adventure?**', async route => {
    if (new URL(route.request().url()).searchParams.get('includeTerminal') !== 'true') return route.fallback()
    started()
    await held
    await route.fulfill({ json: { ...withGoal, includeTerminal: true } })
  })
  await page.goto('/adventure?view=planning')
  const toggle = page.getByLabel('显示已达成／已结束')
  await expect(toggle).toBeEnabled()
  // Two events before the disabled render can expose an in-flight guard race.
  await toggle.evaluate(input => { const el = input as HTMLInputElement; el.click(); el.click() })
  await seen
  await expect(toggle).toBeDisabled()
  // Simulate a second event arriving before the disabled state is reflected.
  await toggle.evaluate(input => { const el = input as HTMLInputElement; el.disabled = false; el.click() })
  release()
  await expect(toggle).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('lifespace.adventure.terminal.00000000-0000-4000-8000-000000000001'))).toBe('true')
  await page.reload()
  await expect(toggle).toBeChecked()
})
