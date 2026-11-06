import { test, expect } from './authenticated-test'
import { ledgerAccountReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

let restore: () => void, owner: string
test.describe('账户筛选页面与真实数据库', () => {
  test.skip(!ledgerRpc, '须显式启动隔离数据库，跳过不计通过')
  test.beforeEach(async ({ context }) => {
    restore = installLedgerDatabase(); owner = crypto.randomUUID()
    await context.route('**/api/ledger/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const response = await ledgerRequest(owner, url.pathname + url.search, request.method() === 'GET' ? undefined : request.postDataJSON(), request.method())
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => restore?.())
  for (const width of [1440, 390]) test(`${width}px 账户、日期、空结果和恢复全部`, async ({ page }) => {
    const account = async (name: string) => ledgerAccountReceiptSchema.parse(await (await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents: 0 })).json()).accountId
    const a = await account('银行卡'), b = await account('饭卡'), empty = await account('空账户')
    await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: a, note: '银行卡流水' }))
    await ledgerRequest(owner, '/api/ledger/entries', await ordinaryEntry(owner, { accountId: b, note: '饭卡流水' }))
    await ledgerRequest(owner, '/api/ledger/transfers', { requestId: crypto.randomUUID(), fromAccountId: a, toAccountId: b, amountCents: 500, occurredAt: '2026-01-02T03:04:05Z', note: '转账测试' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/finance')
    const region = page.getByRole('region', { name: '账单流水' }), filter = region.getByLabel('筛选账户')
    await expect(region.locator('tbody tr')).toHaveCount(4)
    await filter.selectOption(a)
    await expect(region.locator('tbody tr')).toHaveCount(2)
    await expect(region.getByRole('table')).toContainText('银行卡流水')
    await expect(region.getByRole('table')).toContainText('转出')
    await filter.selectOption(b)
    await expect(region.locator('tbody tr')).toHaveCount(2)
    await expect(region.getByRole('table')).toContainText('转入')
    await region.getByRole('button', { name: '今天', exact: true }).click()
    await expect(region.getByText('没有匹配的流水')).toBeVisible()
    await region.getByRole('button', { name: '全部时间', exact: true }).click()
    await expect(region.locator('tbody tr')).toHaveCount(2)
    await filter.selectOption(empty)
    await expect(region.getByText('没有匹配的流水')).toBeVisible()
    await filter.selectOption('')
    await expect(region.locator('tbody tr')).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/ledger134-${width}.png` })
  })
})
