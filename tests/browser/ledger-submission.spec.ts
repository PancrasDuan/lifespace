import type { BrowserContext } from '@playwright/test'
import { test, expect, type Page } from './authenticated-test'
import type { LedgerEntry } from '../../src/shared/ledger'

const parent: LedgerEntry = {
  id: '00000000-0000-4000-8000-000000000112', direction: 'expense', amountCents: -10000,
  occurredAt: '2026-01-02T03:04:05.000Z', createdAt: '2026-01-02T03:04:05.000Z',
  accountName: '零钱', categoryCode: 'dining', note: '原支出', parentEntryId: null, status: 'completed',
}

// UI-only response control. Static read snapshots do not model persisted writes
// or prove database idempotency; the existing database suites retain that role.
async function responses(context: BrowserContext) {
  const writes: { path: string; input: unknown }[] = []
  let next: 'success' | 'unknown' | 'hold' | 'rejected' = 'success'
  let release: (() => void) | undefined
  let failReads = false
  await context.route('**/api/ledger/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() === 'GET') {
      if (failReads) return route.fulfill({ status: 503, json: { error: { code: 'LEDGER_UNAVAILABLE', message: '读取失败' } } })
      return route.fulfill({ json: path.endsWith(parent.id)
        ? { entry: parent, parentEntry: null, refunds: [], refundCount: 0, refundedCents: 0, refundPage: 1, refundPageSize: 30, version: 0 }
        : { items: [parent], total: 1, page: 1, pageSize: 30, version: 0 } })
    }
    writes.push({ path, input: req.postDataJSON() })
    const response = next
    next = 'success'
    if (response === 'unknown') return route.abort('failed')
    if (response === 'rejected') return route.fulfill({ status: 409, json: { error: { code: 'REFUND_LIMIT', message: '退款金额超过剩余可退额度，请查看最新流水' } } })
    if (response === 'hold') await new Promise<void>(done => { release = done })
    await route.fulfill({ json: { entryId: '00000000-0000-4000-8000-000000000113', version: 1, deleted: false } })
  })
  return {
    writes, next(value: typeof next) { next = value },
    failReads(value: boolean) { failReads = value },
    held: () => !!release,
    release() { release?.(); release = undefined },
  }
}
async function open(page: Page, kind: 'new' | 'refund') {
  if (kind === 'new') await page.getByRole('button', { name: '新建流水', exact: true }).first().click()
  else {
    await page.getByRole('table').getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '登记退款', exact: true }).click()
  }
  const form = page.getByRole('dialog', { name: kind === 'new' ? '新建流水' : '登记退款', exact: true })
  await form.getByLabel('交易金额').fill('3.21')
  if (kind === 'new') {
    await form.getByLabel('交易账户', { exact: true }).fill('零钱')
    await form.getByLabel('交易分类', { exact: true }).selectOption('transport')
  }
  return form
}

for (const width of [1440, 390]) for (const kind of ['new', 'refund'] as const) {
  test(`${width}px ${kind} 未知结果冻结输入、重试原内容，重试迟到不关闭后来表单`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 954 })
    const fixture = await responses(context)
    await page.goto('/finance')
    const form = await open(page, kind)
    fixture.next('unknown')
    await form.getByRole('button', { name: kind === 'new' ? '保存流水' : '保存退款', exact: true }).dblclick()
    await expect(form.getByRole('alert')).toContainText('保存结果未确认')
    await expect(form.getByLabel('交易金额')).toBeDisabled()
    await expect(form.getByLabel('交易备注')).toBeDisabled()
    await form.getByRole('button', { name: '重试原请求', exact: true }).click()
    await expect(form).toBeHidden()
    expect(fixture.writes).toHaveLength(2)
    expect(fixture.writes[1]).toEqual(fixture.writes[0])

    const another = await open(page, kind)
    fixture.next('unknown')
    await another.getByRole('button', { name: kind === 'new' ? '保存流水' : '保存退款', exact: true }).click()
    await expect(another.getByRole('alert')).toContainText('保存结果未确认')
    await another.getByRole('button', { name: '取消', exact: true }).click()
    fixture.next('hold')
    await page.getByRole('button', { name: '重试原请求', exact: true }).click()
    await expect.poll(fixture.held).toBe(true)
    const later = await open(page, 'new')
    await later.getByLabel('交易金额').fill('99.99')
    fixture.release()
    await expect(page.locator('.lp-unknown')).toHaveCount(0)
    await expect(later).toBeVisible()
    await expect(later.getByLabel('交易金额')).toHaveValue('99.99')
    await expect(later.getByLabel('交易金额')).toBeEnabled()
    expect(fixture.writes).toHaveLength(4)
    expect(fixture.writes[3]).toEqual(fixture.writes[2])
    expect(fixture.writes[2]).not.toEqual(fixture.writes[0])
  })
}

for (const kind of ['new', 'refund'] as const) test(`${kind} 保存成功后读取失败只重读，直接迟到成功保留新表单`, async ({ page, context }) => {
  const fixture = await responses(context)
  await page.goto('/finance')
  const form = await open(page, kind)
  fixture.next('hold')
  await form.getByRole('button', { name: kind === 'new' ? '保存流水' : '保存退款', exact: true }).click()
  await expect.poll(fixture.held).toBe(true)
  await form.getByRole('button', { name: '取消', exact: true }).click()
  const later = await open(page, 'new')
  await later.getByLabel('交易金额').fill('88.88')
  fixture.failReads(true)
  fixture.release()
  await expect(page.getByRole('status').filter({ hasText: '流水已记录' })).toBeVisible()
  await expect(later.getByLabel('交易金额')).toHaveValue('88.88')
  await later.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('region', { name: '账单流水', exact: true }).getByRole('alert')).toContainText('读取失败')
  fixture.failReads(false)
  await page.getByRole('button', { name: '重试读取', exact: true }).click()
  await expect(page.getByRole('table')).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
})

test('退款明确拒绝允许修正；未知提示在刷新后消失且不自动重发', async ({ page, context }) => {
  const fixture = await responses(context)
  await page.goto('/finance')
  const form = await open(page, 'refund')
  fixture.next('rejected')
  await form.getByRole('button', { name: '保存退款', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('退款金额超过剩余可退额度')
  await expect(form.getByLabel('交易金额')).toBeEnabled()
  await form.getByLabel('交易金额').fill('1.23')
  fixture.next('unknown')
  await form.getByRole('button', { name: '保存退款', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('保存结果未确认')
  await page.reload()
  await expect(page.getByRole('button', { name: '重试原请求', exact: true })).toHaveCount(0)
  expect(fixture.writes).toHaveLength(2)
})
