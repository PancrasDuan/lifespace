import { test, expect, type Page } from './authenticated-test'
import { recurringFixture, today } from './adventure-recurring-fixture'

const probePath = '/tests/browser/task-date-disabled-fixture.tsx'
const owner = '00000000-0000-4000-8000-000000000001'
async function disableProbe(page: Page, blocked: boolean, denyEdit = false) {
  await page.evaluate(async ({ path, blocked, denyEdit }) => { const probe = await import(path); probe.disable(blocked, denyEdit) }, { path: probePath, blocked, denyEdit })
}

for (const mode of ['once', 'recurring', 'unstarted', 'legacy'] as const) test(`${mode} 真实表单禁用后撤下日历，解禁不重开或提交草稿`, async ({ page, context }) => {
  await recurringFixture(context)
  await page.goto('/adventure')
  await page.evaluate(async ({ path, mode }) => { const probe = await import(path); probe.mount(mode) }, { path: probePath, mode })
  const form = page.locator('dialog.recurring-dialog')
  if (mode === 'once') await form.getByRole('button', { name: '一次性任务', exact: true }).click()
  const label = mode === 'legacy' ? '执行日期' : mode === 'once' ? '计划日期' : '开始日期'
  const value = mode === 'unstarted' ? '2026-12-01' : today
  const draft = mode === 'unstarted' ? '2026-12-02' : '2026-11-17'
  const date = form.getByLabel(label, { exact: true }), trigger = form.getByRole('button', { name: `选择${label}`, exact: true })
  const picker = page.getByRole('dialog', { name: `选择${label}`, exact: true })
  const checkDisabled = async (denyEdit = false) => {
    await trigger.click()
    await picker.getByRole('button', { name: draft, exact: true }).click()
    await disableProbe(page, true, denyEdit)
    await expect(date).toBeDisabled()
    await expect(picker).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // The horizontal control is a div, so fieldset.disabled alone cannot block it.
    await form.locator('.lp-time-control').evaluate(element => (element as HTMLElement).click())
    await expect(picker).toHaveCount(0)
    await disableProbe(page, false, denyEdit)
    await expect(date).toBeEnabled()
    await expect(picker).toHaveCount(0)
    await expect(date).toHaveValue(value)
    await trigger.press('Enter')
    await expect(picker.getByRole('button', { name: value, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  }
  await checkDisabled()
  if (mode === 'unstarted') await checkDisabled(true)
  expect(await page.evaluate(async path => (await import(path)).commands, probePath)).toEqual([])
})

for (const legacy of [false, true]) test(`${legacy ? '旧编辑' : '统一新建'} 跨页pending关闭日历，恢复后保留原日期`, async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.goto('/adventure')
  if (legacy) await page.getByRole('article', { name: '任务：出门散步三十分钟', exact: true }).getByRole('button', { name: '编辑任务', exact: true }).click()
  else await page.getByRole('button', { name: '新建行动', exact: true }).click()
  const label = legacy ? '执行日期' : '开始日期'
  const date = page.getByLabel(label, { exact: true }), trigger = page.getByRole('button', { name: `选择${label}`, exact: true })
  const picker = page.getByRole('dialog', { name: `选择${label}`, exact: true })
  await trigger.click()
  await picker.getByRole('button', { name: '2026-11-17', exact: true }).click()
  const peer = await context.newPage()
  await peer.goto(`${new URL(page.url()).origin}/`)
  const envelope = { requestId: 'date-picker-peer-pending', expectedVersion: 20, command: { type: 'createTask', title: '另一页合成行动', description: '', plannedOn: today, destination: '' } }
  // Actual pending store and BroadcastChannel, from a second page in the same context.
  await peer.evaluate(async ({ owner, envelope }) => { const path = '/src/adventure/pending-command.ts'; const pending = await import(path); await pending.savePending(owner, envelope) }, { owner, envelope })
  await expect(date).toBeDisabled()
  await expect(picker).toHaveCount(0)
  await peer.evaluate(async ({ owner, envelope }) => { const path = '/src/adventure/pending-command.ts'; const pending = await import(path); await pending.clearPending(owner, envelope) }, { owner, envelope })
  await peer.close()
  const form = page.locator('.adventure-dialog').filter({ has: date })
  await form.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(date).toBeEnabled()
  await expect(date).toHaveValue(today)
  await expect(picker).toHaveCount(0)
  await trigger.click()
  await expect(picker.getByRole('button', { name: today, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  expect(fixture.envelopes).toEqual([])
})

for (const legacy of [false, true]) test(`${legacy ? '旧编辑' : '统一新建'} 提交期间关闭日历，日历Enter不提交外层表单`, async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await context.route('**/api/adventure/commands', async route => { await held; await route.fallback() })
  await page.goto('/adventure')
  if (legacy) await page.getByRole('article', { name: '任务：出门散步三十分钟', exact: true }).getByRole('button', { name: '编辑任务', exact: true }).click()
  else await page.getByRole('button', { name: '新建行动', exact: true }).click()
  const form = page.locator('.adventure-dialog').filter({ has: page.getByLabel('任务名称', { exact: true }) })
  if (!legacy) await form.getByLabel('任务名称', { exact: true }).fill('提交中合成行动')
  const label = legacy ? '执行日期' : '开始日期'
  const date = form.getByLabel(label, { exact: true }), trigger = form.getByRole('button', { name: `选择${label}`, exact: true })
  const picker = page.getByRole('dialog', { name: `选择${label}`, exact: true })
  await trigger.click()
  await picker.getByRole('button', { name: '2026-11-17', exact: true }).click()
  await picker.getByLabel('显示月份', { exact: true }).press('Enter')
  await expect(date).toBeEnabled()
  expect(fixture.envelopes).toEqual([])
  // Submit at the real form boundary while the calendar is still open.
  fixture.fail(409, 'VERSION_CONFLICT')
  try {
    await form.locator('form').evaluate((element: HTMLFormElement) => element.requestSubmit())
    await expect(date).toBeDisabled()
    await expect(picker).toHaveCount(0)
  } finally { release() }
  await expect(date).toBeEnabled()
  await expect(date).toHaveValue(today)
  await expect(picker).toHaveCount(0)
  await expect.poll(() => fixture.envelopes.length).toBe(1)
  expect(fixture.envelopes[0].command).toMatchObject(legacy ? { plannedOn: today } : { startOn: today })
})
