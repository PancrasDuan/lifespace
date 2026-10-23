import { expect, type Locator } from '@playwright/test'

// Test-only compatibility adapter: open one production record and reveal quiet actions.
export async function openRecordActions(record: Locator) {
  // Prefer the current page's direct summary. If a navigation is still completing,
  // wait for the specific record rather than clicking a stale element from another page.
  const summary = record.locator(':scope > .record-summary, :scope > .planning-record-summary').first()
  const exists = async () => await summary.count() > 0
  if (!await exists()) {
    await record.waitFor({ state: 'attached' })
    if (!await exists()) throw new Error('记录摘要尚未出现在当前页面')
  }
  await expect(summary).toBeVisible()
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const more = record.getByRole('button', { name: /^更多/ }).first()
  if (await more.count()) {
    if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
  }
}
