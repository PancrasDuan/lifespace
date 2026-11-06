import { test, expect } from './authenticated-test'

const ids = ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005']
const date = '2026-01-02T03:04:05.000Z'

for (const width of [1440, 360]) test(`${width}px 账户余额切换覆盖卡片、编辑和转账，刷新恢复默认`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 })
  const writes: unknown[] = []
  await context.route('**/api/ledger/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'PATCH') {
      writes.push(request.postDataJSON())
      return route.fulfill({ json: { accountId: ids[0], version: 1 } })
    }
    if (path.endsWith('/accounts')) return route.fulfill({ json: { version: 0, accounts: [
      { id: ids[0], name: '银行卡', balanceCents: 123456, createdAt: date, updatedAt: date },
      { id: ids[1], name: '零钱', balanceCents: -2200, createdAt: date, updatedAt: date },
    ] } })
    return route.fulfill({ json: { items: [{ id: '00000000-0000-4000-8000-000000000010', accountId: ids[0], transferId: null, direction: 'expense', amountCents: -500, occurredAt: date, createdAt: date, accountName: '银行卡', categoryCode: 'dining', note: '', parentEntryId: null, status: 'completed' }], total: 1, page: 1, pageSize: 30, version: 0 } })
  })
  await page.goto('/finance')
  const accounts = page.getByRole('region', { name: '交易账户' })
  const first = accounts.getByRole('article', { name: '银行卡' })
  const second = accounts.getByRole('article', { name: '零钱' })
  await expect(first).toContainText('1,234.56')
  await expect(second).toContainText('-22.00')
  await accounts.getByRole('button', { name: '隐藏账户余额' }).focus()
  await page.keyboard.press('Enter')
  await expect(first).not.toContainText('1,234.56')
  await expect(second).not.toContainText('-22.00')
  await expect(accounts.getByLabel('余额已隐藏')).toHaveCount(2)
  await expect(page.getByRole('region', { name: '账单流水' })).toContainText('5.00')
  await page.screenshot({ path: `.cache/balance-visibility-${width}.png` })
  await first.getByRole('button', { name: '修改银行卡' }).click()
  const edit = page.getByRole('dialog', { name: '修改账户' })
  const balance = edit.getByLabel('当前余额', { exact: true })
  await expect(balance).toHaveAttribute('type', 'password')
  await edit.getByLabel('账户名称').fill('工资卡')
  await edit.getByRole('button', { name: '保存修改' }).click()
  await expect(edit).toBeHidden()
  expect(writes[0]).toMatchObject({ name: '工资卡' })
  expect(writes[0]).not.toHaveProperty('balanceCents')
  await accounts.getByRole('button', { name: '账户转账' }).click()
  const transfer = page.getByRole('dialog', { name: '账户转账' })
  await transfer.getByLabel('转出账户', { exact: true }).selectOption(ids[0])
  await transfer.getByLabel('转入账户', { exact: true }).selectOption(ids[1])
  await transfer.getByLabel('转账金额').fill('10')
  await expect(transfer).not.toContainText('1,234.56')
  await expect(transfer.getByLabel('转账后余额')).not.toContainText('1,224.56')
  await transfer.getByRole('button', { name: '显示账户余额' }).click()
  await expect(transfer).toContainText('1,234.56')
  await expect(transfer.getByLabel('转账后余额')).toContainText('1,224.56')
  await transfer.getByRole('button', { name: '取消' }).click()
  await accounts.getByRole('button', { name: '隐藏账户余额' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.reload()
  await expect(first).toContainText('1,234.56')
  await expect(accounts.getByRole('button', { name: '隐藏账户余额' })).toBeVisible()
})

test('隐藏状态下余额冲突不显示最新金额，可切换显示后核对', async ({ page, context }) => {
  let changed = false
  await context.route('**/api/ledger/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'PATCH') {
      changed = true
      return route.fulfill({ status: 409, json: { error: { code: 'BALANCE_CHANGED', message: '余额已变化，请核对最新余额后再次保存' } } })
    }
    if (path.endsWith('/accounts')) return route.fulfill({ json: { version: 0, accounts: [{ id: ids[0], name: '银行卡', balanceCents: changed ? 88800 : 123456, createdAt: date, updatedAt: date }] } })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 30, version: 0 } })
  })
  await page.goto('/finance')
  await page.getByRole('button', { name: '隐藏账户余额' }).click()
  await page.getByRole('button', { name: '修改银行卡' }).click()
  const edit = page.getByRole('dialog', { name: '修改账户' })
  await edit.getByLabel('当前余额', { exact: true }).fill('900')
  await edit.getByRole('button', { name: '保存修改' }).click()
  const status = edit.getByRole('status')
  await expect(status).toContainText('最新余额为 ••••••')
  await expect(status).not.toContainText('888.00')
  await edit.getByRole('button', { name: '显示账户余额' }).click()
  await expect(status).toContainText('888.00')
  await expect(edit.getByLabel('当前余额', { exact: true })).toHaveValue('900.00')
})
