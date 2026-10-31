import { test, expect } from './authenticated-test'
import { ledgerReceiptSchema } from '../../src/shared/ledger'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

let restore: () => void, owner: string
let loseDelete = false, holdDelete = false, failReads = false
let releaseDelete: (() => void) | undefined
let deletes = 0
test.describe('删除正式财务页 → Worker → PostgreSQL（受控身份）', () => {
  test.skip(!ledgerRpc, '须显式启动隔离数据库，跳过不计通过')
  test.beforeEach(async ({ context }) => {
    restore = installLedgerDatabase(); owner = crypto.randomUUID()
    loseDelete = false; holdDelete = false; failReads = false; releaseDelete = undefined; deletes = 0
    await context.route('**/api/ledger/**', async route => {
      const req = route.request(), url = new URL(req.url())
      if (req.method() === 'GET' && failReads) { await route.fulfill({ status: 503, json: { error: { code: 'LEDGER_UNAVAILABLE', message: '暂时无法读取账单' } } }); return }
      const response = await ledgerRequest(owner, url.pathname + url.search, req.method() === 'GET' ? undefined : req.postDataJSON(), req.method())
      if (url.pathname.endsWith('/delete')) {
        deletes++
        if (loseDelete) { loseDelete = false; await route.abort('failed'); return }
        if (holdDelete) { holdDelete = false; await new Promise<void>(resolve => { releaseDelete = resolve }) }
      }
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => restore?.())
  const create = async (input = ordinaryEntry({ amountCents: -10000, categoryCode: 'dining' })) => {
    const res = await ledgerRequest(owner, '/api/ledger/entries', input)
    expect(res.status).toBe(200)
    return ledgerReceiptSchema.parse(await res.json()).entryId
  }
  const refund = async (id: string, amountCents: number) => {
    const res = await ledgerRequest(owner, `/api/ledger/entries/${id}/refunds`, { requestId: crypto.randomUUID(), amountCents, occurredAt: '2026-10-01T00:00:00.000Z', note: '' })
    expect(res.status).toBe(200)
    return ledgerReceiptSchema.parse(await res.json()).entryId
  }
  for (const [width, height] of [[1440, 900], [390, 640], [360, 568]]) test(`${width}px 单删退款恢复状态，删父联动，取消回列表`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const parent = await create()
    await refund(parent, 3000); await refund(parent, 7000)
    await page.goto('/finance')
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    const openDelete = async (amount: string) => {
      await page.getByRole('table').locator('tbody tr').filter({ hasText: amount }).getByRole('button', { name: '餐饮', exact: true }).click()
      await page.getByRole('dialog', { name: '流水详情', exact: true }).getByRole('button', { name: '删除流水', exact: true }).click()
      await expect(confirm.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled()
    }
    for (const dismiss of ['取消', '关闭', 'Escape', '遮罩']) {
      await openDelete('-¥100.00')
      await expect(confirm).toContainText('不可恢复')
      await expect(confirm).toContainText('2 笔退款')
      const box = await confirm.boundingBox()
      expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height).toBe(true)
      if (dismiss === 'Escape') await page.keyboard.press('Escape')
      else if (dismiss === '遮罩') await page.mouse.click(2, 2)
      else await confirm.getByRole('button', { name: dismiss, exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(deletes).toBe(0)
    }
    for (const [amount, status] of [['+¥70.00', '部分退款'], ['+¥30.00', '已完成']]) {
      await openDelete(amount)
      await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
      await expect(confirm).toBeHidden()
      await expect(page.getByRole('table').locator('tbody tr').filter({ hasText: '-¥100.00' })).toContainText(status)
    }
    await refund(parent, 1000)
    await page.getByRole('button', { name: '刷新数据', exact: true }).click()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await openDelete('-¥100.00')
    await expect(confirm).toContainText('1 笔退款')
    await page.screenshot({ path: `.cache/ledger94-delete-${width}.png` })
    await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
  })
  for (const change of ['新增', '移除', '等数量替换', '无关新建']) test(`预览后${change}：比较具体范围并等待再次确认`, async ({ page }) => {
    const parent = await create(), first = await refund(parent, 1000)
    await page.goto('/finance')
    await page.getByRole('table').locator('tbody tr').filter({ hasText: '-¥100.00' }).getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    await expect(confirm).toContainText('1 笔退款')
    if (change === '移除' || change === '等数量替换') {
      const preview = await (await ledgerRequest(owner, `/api/ledger/entries/${first}/delete-preview`)).json() as { scope: string }
      expect((await ledgerRequest(owner, `/api/ledger/entries/${first}/delete`, { scope: preview.scope })).status).toBe(200)
    }
    if (change === '新增' || change === '等数量替换') await refund(parent, 2000)
    if (change === '无关新建') await create(ordinaryEntry({ direction: 'income', amountCents: 800, categoryCode: 'salary' }))
    await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    if (change !== '无关新建') {
      await expect(confirm.getByRole('alert')).toContainText('范围已变化')
      await expect(confirm).toContainText(`${change === '新增' ? 2 : change === '移除' ? 0 : 1} 笔退款`)
      expect((await ledgerRequest(owner, `/api/ledger/entries/${parent}`)).status).toBe(200)
      expect(deletes).toBe(1)
      await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    }
    await expect(confirm).toBeHidden()
    expect((await ledgerRequest(owner, `/api/ledger/entries/${parent}`)).status).toBe(404)
    if (change === '无关新建') await expect(page.getByRole('table')).toContainText('+¥8.00')
    else await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
  })

  test('删除未知结果关闭后仍能重试，其他新建不受阻，重载不恢复旧命令', async ({ page }) => {
    await create()
    await page.goto('/finance')
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    loseDelete = true
    await confirm.getByRole('button', { name: '确认删除', exact: true }).dblclick()
    await expect(confirm.getByRole('alert')).toContainText('删除结果未确认')
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '重试删除', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '新建流水', exact: true }).first().click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    await form.getByRole('button', { name: '收入', exact: true }).click()
    await form.getByLabel('交易金额').fill('8')
    await form.getByLabel('交易账户', { exact: true }).fill('新交易')
    await form.getByLabel('交易分类', { exact: true }).selectOption('salary')
    await form.getByLabel('交易时间', { exact: true }).fill('2026-01-02T11:04:05')
    await form.getByRole('button', { name: '保存流水', exact: true }).click()
    await expect(form).toBeHidden()
    await page.getByRole('button', { name: '重试删除', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '删除结果未确认' })).toBeHidden()
    await expect(page.getByRole('table')).toContainText('+¥8.00')
    expect(deletes).toBe(2)
    await page.getByRole('button', { name: '工资', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    loseDelete = true
    await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(confirm.getByRole('alert')).toContainText('删除结果未确认')
    await page.reload()
    await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '重试删除', exact: true })).toBeHidden()
    expect(deletes).toBe(3)
  })

  test('删除迟到成功保留新表单，成功后读取失败只重读', async ({ page }) => {
    await create()
    await page.goto('/finance')
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    holdDelete = true
    await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect.poll(() => !!releaseDelete).toBe(true)
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新建流水', exact: true }).first().click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    await form.getByLabel('交易金额').fill('9.99')
    failReads = true; releaseDelete!()
    await expect(page.getByText('读取失败，请重试。', { exact: false })).toBeVisible()
    await expect(form.getByLabel('交易金额')).toHaveValue('9.99')
    await form.getByRole('button', { name: '取消', exact: true }).click()
    failReads = false
    await page.getByRole('button', { name: '重试读取', exact: true }).click()
    await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
    expect(deletes).toBe(1)
  })
  test('筛选内删空末页回最近有效页，再删除保持当前有效页', async ({ page }) => {
    test.setTimeout(30000)
    await Promise.all(Array.from({ length: 61 }, (_, n) => create(ordinaryEntry({ direction: 'income', amountCents: n + 1, categoryCode: 'salary' }))))
    await create(ordinaryEntry({ occurredAt: '2025-01-02T03:04:05Z' }))
    await page.goto('/finance')
    await page.getByRole('button', { name: '自定义', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '自定义日期范围' })
    for (const title of ['开始日期', '结束日期']) {
      await picker.getByLabel(`${title}的显示月份`).fill('2026-01')
      await picker.getByRole('button', { name: `${title} 2026-01-02`, exact: true }).click()
    }
    await picker.getByRole('button', { name: '应用', exact: true }).click()
    for (let n = 0; n < 2; n++) {
      await page.getByRole('button', { name: '下一页', exact: true }).click()
      await expect(page.locator('.lp-pagination')).toContainText(n ? '61–61 / 61' : '31–60 / 61')
    }
    const removeFirst = async () => {
      await page.getByRole('button', { name: '工资', exact: true }).first().click()
      await page.getByRole('button', { name: '删除流水', exact: true }).click()
      await page.getByRole('button', { name: '确认删除', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    await removeFirst()
    await expect(page.locator('.lp-pagination')).toContainText('31–60 / 60')
    await expect(page.getByText('2026-01-02 — 2026-01-02', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '列表已更新' })).toHaveCount(0)
    await removeFirst()
    await expect(page.locator('.lp-pagination')).toContainText('31–59 / 59')
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(29)
  })

  test('9月父支出与10月退款按自身时间筛选，范围外关联、退款复原和删父清空筛选', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const parent = await create(ordinaryEntry({ amountCents: -10000, categoryCode: 'dining', occurredAt: '2026-09-01T00:00:00Z' }))
    await refund(parent, 3000); await refund(parent, 7000)
    await page.goto('/finance')
    const selectOctober = async () => {
      await page.getByRole('button', { name: '自定义', exact: true }).click()
      const picker = page.getByRole('dialog', { name: '自定义日期范围' })
      for (const title of ['开始日期', '结束日期']) {
        await picker.getByLabel(`${title}的显示月份`).fill('2026-10')
        await picker.getByRole('button', { name: `${title} 2026-10-01`, exact: true }).click()
      }
      await picker.getByRole('button', { name: '应用', exact: true }).click()
    }
    await selectOctober()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await expect(page.getByRole('table')).not.toContainText('-¥100.00')
    await page.getByRole('table').locator('tbody tr').filter({ hasText: '+¥70.00' }).getByRole('button', { name: '餐饮', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '流水详情', exact: true })
    await detail.getByRole('button', { name: '查看父流水', exact: true }).click()
    await expect(detail).toContainText('全部退款')
    await expect(detail).toContainText('-¥100.00')
    await detail.getByRole('button', { name: /查看退款.*70/ }).click()
    await detail.getByRole('button', { name: '删除流水', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
    await expect(page.getByText('2026-10-01 — 2026-10-01', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await detail.getByRole('button', { name: '查看父流水', exact: true }).click()
    await expect(detail).toContainText('部分退款')
    await detail.getByRole('button', { name: '登记退款', exact: true }).click()
    const form = page.getByRole('dialog', { name: '登记退款', exact: true })
    await form.getByLabel('交易金额').fill('70')
    await form.getByLabel('交易时间', { exact: true }).fill('2026-10-01T08:00:01')
    await form.getByRole('button', { name: '保存退款', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(page.getByRole('button', { name: '全部时间', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('table')).toContainText('全部退款')
    await selectOctober()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await page.getByRole('button', { name: '餐饮', exact: true }).first().click()
    await detail.getByRole('button', { name: '查看父流水', exact: true }).click()
    await detail.getByRole('button', { name: '删除流水', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByText('没有匹配的流水', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-10-01 — 2026-10-01', { exact: true })).toBeVisible()
    await expect(page.locator('.lp-pagination')).toContainText('1 / 1')
  })
  test('其他设备退款及删除引发版本提示，保留筛选和新表单；已删除关联不显示旧正文', async ({ page }) => {
    test.setTimeout(30000)
    const parent = await create()
    await Promise.all(Array.from({ length: 31 }, () => create(ordinaryEntry({ categoryCode: 'salary', direction: 'income', amountCents: 1000 }))))
    await page.goto('/finance')
    await page.getByRole('button', { name: '自定义', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '自定义日期范围' })
    for (const title of ['开始日期', '结束日期']) {
      await picker.getByLabel(`${title}的显示月份`).fill('2026-01')
      await picker.getByRole('button', { name: `${title} 2026-01-02`, exact: true }).click()
    }
    await picker.getByRole('button', { name: '应用', exact: true }).click()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.locator('.lp-pagination')).toContainText('31–32 / 32')
    await page.getByRole('button', { name: '新建流水', exact: true }).click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    await form.getByLabel('交易金额').fill('18.88')
    await refund(parent, 1000)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 32')
    await expect(page.getByRole('status').filter({ hasText: '列表已更新' })).toBeVisible()
    await expect(form.getByLabel('交易金额')).toHaveValue('18.88')
    const preview = await (await ledgerRequest(owner, `/api/ledger/entries/${parent}/delete-preview`)).json() as { scope: string }
    expect((await ledgerRequest(owner, `/api/ledger/entries/${parent}/delete`, { scope: preview.scope })).status).toBe(200)
    await page.getByRole('button', { name: '刷新数据', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 31')
    await expect(form.getByLabel('交易金额')).toHaveValue('18.88')
    await expect(page.getByText('2026-01-02 — 2026-01-02', { exact: true })).toBeVisible()
    await form.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '全部时间', exact: true }).click()
    const nextParent = await create(), child = await refund(nextParent, 1000)
    await page.getByRole('button', { name: '刷新数据', exact: true }).click()
    await page.getByRole('table').locator('tbody tr').filter({ hasText: '+¥10.00' }).filter({ hasText: '退款' }).getByRole('button', { name: '餐饮', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '流水详情', exact: true })
    await expect(detail.getByRole('button', { name: '查看父流水', exact: true })).toBeVisible()
    const current = await (await ledgerRequest(owner, `/api/ledger/entries/${nextParent}/delete-preview`)).json() as { scope: string }
    expect((await ledgerRequest(owner, `/api/ledger/entries/${nextParent}/delete`, { scope: current.scope })).status).toBe(200)
    await detail.getByRole('button', { name: '查看父流水', exact: true }).click()
    await expect(detail.getByRole('alert')).toContainText('流水已删除或不可访问')
    await expect(detail).not.toContainText('-¥100.00')
    expect((await ledgerRequest(owner, `/api/ledger/entries/${child}`)).status).toBe(404)
  })
  test('页面删父与另一设备追加退款竞争，重确认后无可见孤儿', async ({ page }) => {
    const parent = await create()
    await page.goto('/finance')
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    await expect(confirm.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled()
    const [addition] = await Promise.all([
      ledgerRequest(owner, `/api/ledger/entries/${parent}/refunds`, { requestId: crypto.randomUUID(), amountCents: 3000, occurredAt: '2026-10-01T00:00:00Z', note: '' }),
      confirm.getByRole('button', { name: '确认删除', exact: true }).click(),
    ])
    if (addition.status === 200) {
      await expect(confirm.getByRole('alert')).toContainText('范围已变化')
      await expect(confirm).toContainText('1 笔退款')
      await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    } else expect(addition.status).toBe(404)
    await expect(page.getByText('暂无流水', { exact: true })).toBeVisible()
  })
  test('真实数据库删父子后提交故障回滚，错误反馈与原父子回读一致', async ({ page }) => {
    const parent = await create(ordinaryEntry({ amountCents: -10000, categoryCode: 'dining', note: 'ledger94-delete-rollback' }))
    await refund(parent, 3000)
    await page.goto('/finance')
    await page.getByRole('table').locator('tbody tr').filter({ hasText: '-¥100.00' }).getByRole('button', { name: '餐饮', exact: true }).click()
    await page.getByRole('button', { name: '删除流水', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除流水', exact: true })
    await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(confirm.getByRole('alert')).toContainText('删除结果未确认')
    await page.reload()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await expect(page.getByRole('table').locator('tbody tr').filter({ hasText: '-¥100.00' })).toContainText('部分退款')
    await expect(page.getByRole('table')).toContainText('+¥30.00')
  })

})
