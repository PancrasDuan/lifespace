import { test, expect } from './authenticated-test'
import type { LedgerEntry } from '../../src/shared/ledger'

// Chromium's en-US native segments are month, day, year, hour, minute, second.
test.use({ locale: 'en-US' })

for (const [segment, digits, expected] of [
  [0, '12', '2025-12-02T03:04:05'],
  [0, '10', '2025-10-02T03:04:05'],
  [1, '21', '2025-01-21T03:04:05'],
  [3, '11', '2025-01-02T11:04:05'],
  [4, '34', '2025-01-02T03:34:05'],
  [5, '56', '2025-01-02T03:04:56'],
] as const) test(`转账交易时间第 ${segment} 段支持逐键输入 ${digits}`, async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'))
  const date = '2025-01-02T03:04:05.000Z'
  await context.route('**/api/ledger/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/accounts')
    ? { version: 0, accounts: ['银行卡', '零钱'].map((name, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 4}`, name, balanceCents: 10000, createdAt: date, updatedAt: date })) }
    : { items: [], total: 0, page: 1, pageSize: 30, version: 0 } }))
  await page.goto('/finance')
  await page.getByRole('button', { name: '账户转账', exact: true }).click()
  const time = page.getByRole('dialog', { name: '账户转账', exact: true }).getByLabel('交易时间', { exact: true })
  await time.fill('2025-01-02T03:04:05')
  await time.focus()
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowLeft')
  for (let index = 0; index < segment; index++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Backspace')
  await page.clock.setFixedTime(new Date('2026-11-08T12:00:01Z'))
  await page.keyboard.type(digits[0])
  await page.clock.setFixedTime(new Date('2026-11-08T12:00:02Z'))
  await page.keyboard.type(digits[1])
  await expect(time).toHaveValue(expected)
})

for (const kind of ['新建流水', '登记退款'] as const) test(`${kind}的键盘与时间选择器同步，提交仍拒绝未来时间`, async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'))
  const date = '2025-01-01T03:04:05.000Z'
  const accountId = '00000000-0000-4000-8000-000000000004'
  const parent: LedgerEntry = { id: '00000000-0000-4000-8000-000000000010', accountId, accountName: '银行卡', direction: 'expense', amountCents: -10000, occurredAt: date, createdAt: date, categoryCode: 'dining', note: '', parentEntryId: null, transferId: null, status: 'completed' }
  const writes: { occurredAt: string }[] = []
  await context.route('**/api/ledger/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON())
      return route.fulfill({ json: { entryId: parent.id, version: 1, deleted: false } })
    }
    if (path.endsWith('/accounts')) return route.fulfill({ json: { version: 0, accounts: [{ id: accountId, name: '银行卡', balanceCents: 10000, createdAt: date, updatedAt: date }] } })
    if (path.endsWith(parent.id)) return route.fulfill({ json: { entry: parent, parentEntry: null, transferEntry: null, refunds: [], refundCount: 0, refundedCents: 0, refundPage: 1, refundPageSize: 30, version: 0 } })
    return route.fulfill({ json: { items: [parent], total: 1, page: 1, pageSize: 30, version: 0 } })
  })
  await page.goto('/finance')
  if (kind === '登记退款') {
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '登记退款', exact: true }).click()
  } else await page.getByRole('button', { name: '新建流水', exact: true }).click()
  const form = page.getByRole('dialog', { name: kind, exact: true })
  await form.getByLabel('交易金额', { exact: true }).fill('2')
  if (kind === '新建流水') {
    await form.getByLabel('交易账户', { exact: true }).selectOption(accountId)
    await form.getByLabel('交易分类', { exact: true }).selectOption('dining')
  }
  const time = form.getByLabel('交易时间', { exact: true })
  await time.fill('2099-01-01T00:00:01')
  await form.getByRole('button', { name: kind === '登记退款' ? '保存退款' : '保存流水', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('交易时间不能晚于当前北京时间')
  expect(writes).toHaveLength(0)
  await time.fill('2025-01-02T03:04:05')
  await form.getByRole('button', { name: '选择交易时间', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择交易时间', exact: true })
  await picker.getByRole('button', { name: '2025-01-03', exact: true }).click()
  const minutes = picker.getByRole('listbox', { name: '分钟', exact: true })
  await minutes.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await expect(minutes.getByRole('option', { selected: true })).toHaveText('59')
  await picker.getByRole('button', { name: '确认时间', exact: true }).click()
  await expect(time).toHaveValue('2025-01-03T03:59:05')
  await form.getByRole('button', { name: '选择交易时间', exact: true }).click()
  await picker.getByRole('button', { name: '2025-01-04', exact: true }).click()
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(time).toHaveValue('2025-01-03T03:59:05')
  await form.getByRole('button', { name: kind === '登记退款' ? '保存退款' : '保存流水', exact: true }).click()
  await expect(form).toBeHidden()
  expect(writes).toEqual([expect.objectContaining({ occurredAt: '2025-01-02T19:59:05.000Z' })])
})
