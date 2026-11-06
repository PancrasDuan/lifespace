import { test, expect, type Page } from './authenticated-test'
import type { BrowserContext } from '@playwright/test'

const accountId = '00000000-0000-4000-8000-000000000004'
const date = '2026-01-02T03:04:05.000Z'

async function fixture(context: BrowserContext) {
  const counts = { accounts: 0, entries: 0 }, aborted: string[] = []
  let hold = false, failAccounts = false
  const releases: (() => void)[] = []
  await context.addInitScript(() => {
    const now = Date.now
    Object.assign(window, { advanceLedgerClock: (ms: number) => { Date.now = () => now() + ms } })
  })
  await context.route('**/api/ledger/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') return route.fulfill({ json: { accountId, version: 1 } })
    const kind = path.endsWith('/accounts') ? 'accounts' : 'entries'
    counts[kind]++
    if (hold) await new Promise<void>(resolve => releases.push(resolve))
    if (failAccounts && kind === 'accounts') return route.fulfill({ status: 503, json: { error: { code: 'LEDGER_UNAVAILABLE', message: '读取失败' } } }).catch(() => { aborted.push(kind) })
    await route.fulfill({ json: kind === 'accounts'
      ? { version: 0, accounts: [{ id: accountId, name: '银行卡', balanceCents: 100, createdAt: date, updatedAt: date }] }
      : { items: [], total: 0, page: 1, pageSize: 30, version: 0 } }).catch(() => { aborted.push(kind) })
  })
  return { counts, aborted, hold(value: boolean) { hold = value }, fail(value: boolean) { failAccounts = value }, release() { hold = false; releases.splice(0).forEach(resolve => resolve()) } }
}
async function advance(page: Page, ms: number) {
  await page.evaluate(ms => (window as unknown as { advanceLedgerClock: (ms: number) => void }).advanceLedgerClock(ms), ms)
}
async function visibility(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

for (const width of [1440, 390]) test(`${width}px 公共刷新入口与可见性策略`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 })
  const server = await fixture(context)
  await page.goto('/finance')
  await expect(page.getByText('暂无流水')).toBeVisible()
  await expect(page.getByRole('article', { name: '银行卡' })).toBeVisible()
  const button = page.getByRole('button', { name: '刷新数据', exact: true })
  await expect(page.locator('.lp-page-header').getByRole('button', { name: '刷新数据' })).toBeVisible()
  const box = await button.boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= width && box.width >= 44 && box.height >= 40).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await visibility(page)
  await page.waitForTimeout(150)
  expect(server.counts).toEqual({ accounts: 1, entries: 1 })
  await button.click()
  await expect.poll(() => server.counts).toEqual({ accounts: 2, entries: 2 })
  await advance(page, 61_000)
  await visibility(page)
  await expect.poll(() => server.counts).toEqual({ accounts: 3, entries: 3 })
  await page.screenshot({ path: `.cache/ledger138-${width}.png` })
})

test('首次加载及过期自动刷新与手动刷新重叠复用请求', async ({ page, context }) => {
  const server = await fixture(context)
  server.hold(true)
  await page.goto('/finance')
  await expect.poll(() => server.counts).toEqual({ accounts: 1, entries: 1 })
  await page.getByRole('button', { name: '刷新数据' }).click()
  await visibility(page)
  await page.waitForTimeout(150)
  expect(server.counts).toEqual({ accounts: 1, entries: 1 })
  server.release()
  await expect(page.getByText('暂无流水')).toBeVisible()
  await advance(page, 61_000)
  server.hold(true)
  await visibility(page)
  await expect.poll(() => server.counts).toEqual({ accounts: 2, entries: 2 })
  await page.getByRole('button', { name: '刷新数据' }).click()
  await page.waitForTimeout(150)
  expect(server.counts).toEqual({ accounts: 2, entries: 2 })
  server.release()
  await expect(page.getByRole('article', { name: '银行卡' })).toBeVisible()
  expect(server.aborted).toEqual([])
})

test('失败后恢复可见重试失败查询，按各查询成功时间判断', async ({ page, context }) => {
  const server = await fixture(context)
  server.fail(true)
  await page.goto('/finance')
  await expect(page.getByText('账户读取失败，请重试。')).toBeVisible()
  await expect(page.getByText('暂无流水')).toBeVisible()
  server.fail(false)
  await visibility(page)
  await expect(page.getByRole('article', { name: '银行卡' })).toBeVisible()
  expect(server.counts).toEqual({ accounts: 2, entries: 1 })
  await advance(page, 61_000)
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await expect.poll(() => server.counts.entries).toBe(2)
  await expect(page.getByText('没有匹配的流水')).toBeVisible()
  await visibility(page)
  await expect.poll(() => server.counts.accounts).toBe(3)
  await page.waitForTimeout(150)
  expect(server.counts.entries).toBe(2)
})

test('已有数据的刷新失败后立即恢复可见仍重试，成功的查询不重复读取', async ({ page, context }) => {
  const server = await fixture(context)
  await page.goto('/finance')
  await expect(page.getByRole('article', { name: '银行卡' })).toBeVisible()
  await expect(page.getByText('暂无流水')).toBeVisible()
  server.fail(true)
  await page.getByRole('button', { name: '刷新数据' }).click()
  await expect(page.getByText('账户读取失败，请重试。')).toBeVisible()
  await expect.poll(() => server.counts).toEqual({ accounts: 2, entries: 2 })
  server.fail(false)
  await visibility(page)
  await expect(page.getByRole('article', { name: '银行卡' })).toBeVisible()
  expect(server.counts).toEqual({ accounts: 3, entries: 2 })
})
