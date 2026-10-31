import { test, expect } from './authenticated-test'
import { installLedgerDatabase, ledgerRequest, ledgerRpc, ordinaryEntry } from '../support/ledger-database'

let owner: string
let restore: () => void
let holdDate: string | undefined
let releaseRead: (() => void) | undefined
let failReads = false
test.describe('北京时间筛选 → 正式 Worker → 隔离数据库', () => {
  test.use({ timezoneId: 'America/Los_Angeles', locale: 'zh-CN' })
  test.skip(!ledgerRpc, '须显式启动隔离数据库，跳过不计通过')
  test.beforeEach(async ({ context, page }) => {
    restore = installLedgerDatabase()
    owner = crypto.randomUUID()
    holdDate = undefined; releaseRead = undefined; failReads = false
    await page.clock.setFixedTime(new Date('2026-10-01T16:00:01Z'))
    await context.route('**/api/ledger/**', async route => {
      const req = route.request(), url = new URL(req.url())
      if (failReads && req.method() === 'GET') { await route.fulfill({ status: 503, json: { error: { code: 'LEDGER_UNAVAILABLE', message: '暂时无法读取账单' } } }); return }
      const response = await ledgerRequest(owner, url.pathname + url.search, req.method() === 'GET' ? undefined : req.postDataJSON(), req.method())
      if (holdDate && url.searchParams.get('startDate') === holdDate) {
        holdDate = undefined
        await new Promise<void>(resolve => { releaseRead = resolve })
      }
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => restore?.())

  test('历史缺失时刻在浮窗保留候选并禁止确认，不静默跳回今天', async ({ page }) => {
    await page.goto('/finance')
    await page.getByRole('button', { name: '新建流水' }).first().click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    const time = form.getByLabel('交易时间', { exact: true })
    await time.fill('1988-04-17T01:30')
    await form.getByRole('button', { name: '选择交易时间', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择交易时间', exact: true })
    await picker.getByRole('listbox', { name: '小时', exact: true }).getByRole('option', { name: '02', exact: true }).click()
    await expect(picker.locator('footer strong')).toHaveText('1988-04-17 02:30:00')
    await expect(picker.getByRole('alert')).toContainText('历史时区规则')
    await expect(picker.getByRole('button', { name: '确认时间', exact: true })).toBeDisabled()
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await expect(time).toHaveValue('1988-04-17T01:30')
    await time.fill('1988-04-17T02:30')
    await form.getByRole('button', { name: '选择交易时间', exact: true }).click()
    await expect(picker.locator('footer strong')).toHaveText('1988-04-17 02:30:00')
    await expect(picker.getByRole('button', { name: '确认时间', exact: true })).toBeDisabled()
    await picker.getByRole('listbox', { name: '小时', exact: true }).getByRole('option', { name: '03', exact: true }).click()
    await picker.getByRole('button', { name: '确认时间', exact: true }).click()
    await expect(time).toHaveValue('1988-04-17T03:30')
  })

  test('历史上海夏令时的显示、补录和自然日筛选一致', async ({ page }) => {
    expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt: '1988-05-31T15:30:00.000Z', accountName: '历史上海' }))).status).toBe(200)
    await page.goto('/finance')
    await expect(page.getByRole('table')).toContainText('1988-06-01')
    await expect(page.getByRole('table')).toContainText('00:30:00')
    await page.getByRole('button', { name: '新建流水' }).first().click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    await form.getByLabel('交易金额').fill('2.34')
    await form.getByLabel('交易账户', { exact: true }).fill('历史补录')
    await form.getByLabel('交易分类', { exact: true }).selectOption('dining')
    await form.getByLabel('交易时间', { exact: true }).fill('1988-06-01T00:30')
    await form.getByRole('button', { name: '保存流水' }).click()
    await expect(form).toBeHidden()
    const result = await (await ledgerRequest(owner, '/api/ledger/entries?startDate=1988-06-01&endDate=1988-06-01')).json() as { items: { accountName: string; occurredAt: string }[] }
    expect(result.items.find(item => item.accountName === '历史补录')?.occurredAt).toBe('1988-05-31T15:30:00.000Z')
    await page.getByRole('button', { name: '自定义', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '自定义日期范围' })
    for (const title of ['开始日期', '结束日期']) {
      await picker.getByLabel(`${title}的显示月份`).fill('1988-06')
      await picker.getByRole('button', { name: `${title} 1988-06-01`, exact: true }).click()
    }
    await picker.getByRole('button', { name: '应用', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    for (const row of await page.locator('tbody tr').all()) await expect(row).toContainText('1988-06-01')
    await page.getByRole('button', { name: '餐饮', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '流水详情', exact: true })).toContainText('1988-06-01 00:30:00')
    await page.getByRole('dialog', { name: '流水详情', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    expect(await (await ledgerRequest(owner, '/api/ledger/entries?startDate=1988-05-31&endDate=1988-05-31')).json()).toMatchObject({ total: 0 })
    for (const [local, instant] of [['1988-01-01T08:30', '1988-01-01T00:30:00.000Z'], ['1988-09-11T01:30', '1988-09-10T17:30:00.000Z']]) {
      await page.getByRole('button', { name: '新建流水' }).first().click()
      await form.getByLabel('交易金额').fill('1.00')
      await form.getByLabel('交易账户', { exact: true }).fill(local)
      await form.getByLabel('交易分类', { exact: true }).selectOption('dining')
      await form.getByLabel('交易时间', { exact: true }).fill(local)
      await form.getByRole('button', { name: '保存流水' }).click()
      await expect(form).toBeHidden()
      const data = await (await ledgerRequest(owner)).json() as { items: { accountName: string; occurredAt: string }[] }
      expect(data.items.find(item => item.accountName === local)?.occurredAt).toBe(instant)
    }
    await page.getByRole('button', { name: '新建流水' }).first().click()
    await form.getByLabel('交易金额').fill('1.00')
    await form.getByLabel('交易账户', { exact: true }).fill('不存在的本地时刻')
    await form.getByLabel('交易分类', { exact: true }).selectOption('dining')
    await form.getByLabel('交易时间', { exact: true }).fill('1988-04-17T02:30')
    await form.getByRole('button', { name: '保存流水' }).click()
    await expect(form.getByRole('alert')).toContainText('历史时区规则')
    await expect(form.getByLabel('交易时间', { exact: true })).toHaveValue('1988-04-17T02:30')
  })

  test('快速切换忽略迟到范围，加载、无匹配、失败及重试清晰区分', async ({ page }) => {
    for (const occurredAt of ['2026-10-01T16:00:00Z', '2026-09-25T16:00:00Z', '2026-09-02T16:00:00Z'])
      expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt }))).status).toBe(200)
    await page.goto('/finance')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    holdDate = '2026-10-02'
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect.poll(() => !!releaseRead).toBe(true)
    await expect(page.getByRole('status')).toContainText('正在读取流水')
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    releaseRead!()
    await expect(page.getByText('2026-09-26 — 2026-10-02', { exact: true })).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    await page.clock.setFixedTime(new Date('2026-11-01T01:00:00Z'))
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.getByText('没有匹配的流水', { exact: true })).toBeVisible()
    failReads = true
    await page.getByRole('button', { name: '刷新数据', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('读取失败')
    await expect(page.getByText('没有匹配的流水', { exact: true })).toBeHidden()
    failReads = false
    await page.getByRole('button', { name: '重试读取', exact: true }).click()
    await expect(page.getByText('没有匹配的流水', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '首页', exact: true }).click()
    await page.getByRole('link', { name: '财务', exact: true }).click()
    await expect(page.getByRole('button', { name: '全部时间', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('tbody tr')).toHaveCount(3)
  })

  test('61条同秒筛选完整翻页，其他设备写入后拒绝旧版本并保留范围、表单回第一页', async ({ page }) => {
    test.setTimeout(30000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const receipts = await Promise.all(Array.from({ length: 61 }, async (_, index) => {
      const accountName = `筛选${String(index).padStart(2, '0')}`
      const response = await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ accountName }))
      expect(response.status).toBe(200)
      return { ...await response.json() as { entryId: string }, accountName }
    }))
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt: '2025-01-02T03:04:05Z', accountName: '范围外' }))
    await page.goto('/finance')
    await page.getByRole('button', { name: '自定义', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '自定义日期范围' })
    for (const title of ['开始日期', '结束日期']) {
      await picker.getByLabel(`${title}的显示月份`).fill('2026-01')
      await picker.getByRole('button', { name: `${title} 2026-01-02`, exact: true }).click()
    }
    await picker.getByRole('button', { name: '应用', exact: true }).click()
    const expected = receipts.sort((a, b) => a.entryId < b.entryId ? 1 : -1).map(item => item.accountName)
    const seen: string[] = []
    for (const [index, count] of [30, 30, 1].entries()) {
      await expect(page.locator('tbody tr')).toHaveCount(count)
      await expect(page.locator('tbody tr').first()).toContainText(expected[index * 30])
      for (const row of await page.locator('tbody tr').all()) seen.push((await row.getByRole('cell').nth(2).innerText()).trim())
      if (index < 2) await page.getByRole('button', { name: '下一页', exact: true }).click()
    }
    expect(seen).toEqual(expected)
    await page.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(page.locator('tbody tr').first()).toContainText(expected[30])
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ accountName: '新设备' }))
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '列表已更新' })).toBeVisible()
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 62')
    await expect(page.getByText('2026-01-02 — 2026-01-02', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.locator('.lp-pagination')).toContainText('31–60 / 62')
    await page.getByRole('button', { name: '新建流水' }).first().click()
    const form = page.getByRole('dialog', { name: '新建流水', exact: true })
    await form.getByLabel('交易金额').fill('45.67')
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ accountName: '聚焦更新' }))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 63')
    await expect(form.getByLabel('交易金额')).toHaveValue('45.67')
    await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ accountName: '手动更新' }))
    await page.getByRole('button', { name: '刷新数据', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 64')
    await expect(form.getByLabel('交易金额')).toHaveValue('45.67')
    await form.getByLabel('交易账户', { exact: true }).fill('补录旧账')
    await form.getByLabel('交易分类', { exact: true }).selectOption('dining')
    await form.getByLabel('交易时间', { exact: true }).fill('2024-01-02T03:04:05')
    await form.getByRole('button', { name: '保存流水', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(page.getByRole('button', { name: '全部时间', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.lp-pagination')).toContainText('1–30 / 66')
    await expect(page.getByRole('table')).not.toContainText('补录旧账')
  })

  test('非北京设备的今天、近7天、固定30天包含首尾，跨午夜与跨月', async ({ page }) => {
    for (const [occurredAt, accountName] of [
      ['2026-09-02T15:59:59Z', '范围外'], ['2026-09-02T16:00:00Z', '30天首秒'],
      ['2026-09-25T16:00:00Z', '7天首秒'], ['2026-10-01T15:59:59Z', '昨天末秒'],
      ['2026-10-01T16:00:00Z', '今天首秒'], ['2026-10-02T15:59:59Z', '今天末秒'],
      ['2026-10-02T16:00:00Z', '明天首秒'],
    ]) expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt, accountName }))).status).toBe(200)
    await page.goto('/finance')
    await expect(page.locator('tbody tr')).toHaveCount(7)
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    await expect(page.getByRole('table')).toContainText('今天首秒')
    await expect(page.getByRole('table')).toContainText('今天末秒')
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page.getByRole('table')).toContainText('7天首秒')
    await page.getByRole('button', { name: '近 1 个月', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(5)
    await expect(page.getByRole('table')).toContainText('30天首秒')
    await page.getByRole('button', { name: '全部时间', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(7)
  })
  for (const width of [1440, 390]) test(`${width}px 双日历草稿、快捷填写、闰日应用及关闭撤销`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    for (const [occurredAt, accountName] of [
      ['2024-02-28T15:59:59Z', '闰日前'], ['2024-02-28T16:00:00Z', '闰日首秒'],
      ['2024-02-29T15:59:59Z', '闰日末秒'], ['2024-02-29T16:00:00Z', '闰日后'],
    ]) expect((await ledgerRequest(owner, '/api/ledger/entries', ordinaryEntry({ occurredAt, accountName }))).status).toBe(200)
    await page.goto('/finance')
    await expect(page.locator('tbody tr')).toHaveCount(4)
    const trigger = page.getByRole('button', { name: '自定义', exact: true })
    const picker = page.getByRole('dialog', { name: '自定义日期范围' })
    await trigger.click()
    const entryBox = await trigger.boundingBox(), popupBox = await picker.boundingBox()
    expect(entryBox && popupBox && (popupBox.y >= entryBox.y + entryBox.height || popupBox.y + popupBox.height <= entryBox.y)).toBe(true)
    const left = await picker.getByRole('region', { name: '开始日期日历' }).boundingBox()
    const right = await picker.getByRole('region', { name: '结束日期日历' }).boundingBox()
    expect(left && right && (width > 500 ? left.y === right.y : right.y >= left.y + left.height)).toBe(true)
    await page.screenshot({ path: `.cache/ledger92-calendar-${width}.png` })
    await picker.getByRole('button', { name: '本周', exact: true }).click()
    await expect(picker).toContainText('2026-09-28 — 2026-10-04')
    await picker.getByRole('button', { name: '本月', exact: true }).click()
    await expect(picker).toContainText('2026-10-01 — 2026-10-31')
    await expect(page.locator('tbody tr')).toHaveCount(4)
    for (const title of ['开始日期', '结束日期']) {
      await picker.getByLabel(`${title}的显示月份`).fill('2024-02')
      await picker.getByRole('button', { name: `${title} 2024-02-29`, exact: true }).click()
    }
    await picker.getByRole('button', { name: '应用', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    await expect(page.getByRole('table')).toContainText('闰日首秒')
    await expect(page.getByRole('table')).toContainText('闰日末秒')
    for (const close of ['再次点击', '取消', 'Escape', '外点']) {
      await trigger.click()
      await expect(picker).toContainText('2024-02-29 — 2024-02-29')
      await picker.getByRole('button', { name: '本月', exact: true }).click()
      if (close === '再次点击') await trigger.click()
      if (close === '取消') await picker.getByRole('button', { name: '取消', exact: true }).click()
      if (close === 'Escape') await page.keyboard.press('Escape')
      if (close === '外点') await page.getByRole('heading', { name: '账单流水' }).click()
      await expect(picker).toBeHidden()
      await expect(page.locator('tbody tr')).toHaveCount(2)
    }
    await trigger.click()
    await picker.getByRole('button', { name: '开始日期 2024-02-29', exact: true }).click()
    await picker.getByRole('button', { name: '结束日期 2024-02-28', exact: true }).click()
    await expect(picker.getByRole('button', { name: '应用', exact: true })).toBeDisabled()
    await expect(picker.getByRole('alert')).toContainText('开始日期不能晚于结束日期')
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.reload()
    await expect(page.getByRole('button', { name: '全部时间', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('tbody tr')).toHaveCount(4)
  })
})
