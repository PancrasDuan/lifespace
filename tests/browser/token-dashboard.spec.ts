import { test, expect } from './authenticated-test'
import { fixtureDevices, selectRows, summarize, fixedToday, fixtureRows } from '../fixtures/token-dashboard/fixture'
import { tokenDashboardSummarySchema } from '../../src/shared/token-backend-contract'
import { mkdir } from 'node:fs/promises'
import { captureTokenPage, captureTokenViewport } from '../support/capture-token-page'

test.beforeEach(async ({ page, context }) => {
  await page.clock.setFixedTime(new Date(`${fixedToday}T06:32:00Z`))
  await context.route('**/api/token/summary?*', async route => {
    const query = new URL(route.request().url()).searchParams
    const result = summarize(selectRows(query), query.has('modelKey'))
    await route.fulfill({ json: tokenDashboardSummarySchema.parse(result) })
  })
  await context.route('**/api/token/usage?*', async route => {
    const query = new URL(route.request().url()).searchParams, rows = selectRows(query)
    const offset = Number(query.get('after') ?? 0), limit = 13
    await route.fulfill({ json: { timeZone: 'Asia/Shanghai', scope: query.has('modelKey') ? 'model' : 'main', rows: rows.slice(offset, offset + limit), nextCursor: rows.length > offset + limit ? String(offset + limit) : null } })
  })
  await context.route('**/api/token/devices*', route => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill({ json: { devices: query.has('after') ? fixtureDevices.slice(1) : fixtureDevices.slice(0, 1), nextCursor: query.has('after') ? null : 'mac', serverTime: '2026-11-15T06:32:00Z' } })
  })
})

test('approved prototype: five widths, same data; no global overflow or runtime error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir('.impeccable/review/token-frontend', { recursive: true })
  await page.goto('/token')
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '51938778')
  await expect(page.locator('.device-text strong').filter({ hasText: 'studio-linux' })).toBeVisible()
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
    await expect(page.locator('.plot svg')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 320) await expect(page.locator('.plot .date-label')).toHaveCount(3)
    if (width === 390 || width === 1440) await expect(page.locator('.plot .date-label')).toHaveCount(5)
    const labels = await page.locator('.plot .date-label').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right } }))
    for (let index = 1; index < labels.length; index++) expect(labels[index].left - labels[index - 1].right).toBeGreaterThanOrEqual(4)
    if (width === 320) expect(labels).toHaveLength(3)
    if (width === 390 || width === 1440) expect(labels).toHaveLength(5)
    await captureTokenPage(page, `.impeccable/review/token-frontend/${width === 1440 ? 'desktop' : width === 390 ? 'mobile' : `width-${width}`}.png`)
  }
  expect(errors).toEqual([])
})

test('period/model/device filters, full pagination, independent year and chart controls', async ({ page }) => {
  const queries: URL[] = []
  page.on('request', request => { if (request.url().includes('/api/token/summary')) queries.push(new URL(request.url())) })
  await page.goto('/token')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '日统计明细' }).click()
  await expect(page.getByText('已读取 60 份设备日汇总', { exact: false })).toBeVisible()
  await captureTokenViewport(page, '.impeccable/review/token-frontend/daily-expanded.png')
  await page.getByRole('button', { name: '日统计明细' }).click()
  await expect(page.locator('#token-daily-details')).toHaveAttribute('hidden', 'until-found')
  await page.locator('#token-daily-details').dispatchEvent('beforematch')
  await expect(page.getByRole('button', { name: '日统计明细' })).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '模型堆叠', exact: true }).click()
  await expect(page.locator('.plot rect')).not.toHaveCount(0)
  await page.getByRole('button', { name: '费用', exact: true }).click()
  await page.getByRole('button', { name: '查看完整列表', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '完整模型列表' })
  await dialog.getByRole('button', { name: '筛选GPT-5 mini', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue(JSON.stringify('GPT-5 mini'))
  await page.getByRole('button', { name: '查看完整列表', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '取消筛选GPT-5 mini', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: '取消筛选GPT-5 mini', exact: true }).locator('.model-name i')).toHaveCSS('background-color', 'rgb(168, 121, 67)')
  await page.keyboard.press('Escape')
  await page.getByLabel('设备', { exact: true }).selectOption('linux')
  await expect(page.getByText('暂无用量', { exact: true })).toBeVisible()
  await expect(page.getByLabel('模型', { exact: true }).locator('option')).toHaveCount(5)
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await page.getByLabel('时间范围', { exact: true }).selectOption('week')
  await expect(page.getByTestId('token-total')).not.toHaveAttribute('data-value', '51938778')
  await expect.poll(() => queries.some(url => url.searchParams.get('startDate') === '2026-11-09')).toBe(true)
  expect(queries.some(url => url.searchParams.get('startDate') === '2026-11-02' && url.searchParams.get('endDate') === '2026-11-08')).toBe(true)
  expect(queries.some(url => url.searchParams.get('startDate') === '2026-01-01' && url.searchParams.get('endDate') === '2026-12-31' && url.searchParams.has('modelKey'))).toBe(true)
})

// Deliberately send ascending totals, so neither the preview nor the dialog can rely on API order.
function modelListRows(count: number) {
  if (!count) return []
  const source = fixtureRows.find(row => row.date === fixedToday)!
  const models = Array.from({ length: count }, (_, index) => {
    const total = (index + 1) * 1000
    return { modelId: index === 0 ? 'long-model-'.repeat(18) : `sample-model-${index + 1}`, providerId: null, metrics: { input: total, output: 0, total, cacheRead: 0 }, cost: { currency: 'USD', apiEstimate: index === 0 ? null : '0', coverage: index === 0 ? 'unknown' as const : 'unverified' as const } }
  })
  const total = models.reduce((sum, model) => sum + model.metrics.total, 0)
  return [{ ...source, models, metrics: { input: total, output: 0, total, cacheRead: 0 }, cost: { currency: 'USD', apiEstimate: null, coverage: 'unknown' as const } }]
}

for (const count of [0, 4, 10, 14]) {
  test(`model composition previews at most ten of ${count} models; dialog retains all`, async ({ page, context }) => {
    const rows = modelListRows(count)
    await context.route('**/api/token/summary?*', async route => {
      const query = new URL(route.request().url()).searchParams
      await route.fulfill({ json: tokenDashboardSummarySchema.parse(summarize(selectRows(query, rows), query.has('modelKey'))) })
    })
    await context.route('**/api/token/usage?*', async route => {
      const query = new URL(route.request().url()).searchParams
      await route.fulfill({ json: { timeZone: 'Asia/Shanghai', scope: query.has('modelKey') ? 'model' : 'main', rows: selectRows(query, rows), nextCursor: null } })
    })
    const expected = [...(rows[0]?.models ?? [])].reverse()
    const total = rows[0]?.metrics.total ?? 0
    const panel = page.locator('.model-panel'), opener = panel.getByRole('button', { name: '查看完整列表', exact: true })
    const dialog = page.getByRole('dialog', { name: '完整模型列表' })
    const close = dialog.getByRole('button', { name: '关闭完整模型列表' })
    const dropdown = page.getByLabel('模型', { exact: true })
    await page.goto('/token')
    await expect(panel.locator('.model-list-note')).toContainText(`共 ${count} 项`)
    await expect(panel.locator('.model-row')).toHaveCount(Math.min(count, 10))
    await expect(panel.locator('.model-name')).toHaveText(expected.slice(0, 10).map(model => model.modelId))
    await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', count ? String(total) : '')
    await expect(dropdown.locator('option')).toHaveCount(count + 1)
    if (!count) await expect(panel).toContainText('暂无模型数据')
    if (count) await panel.locator('.model-row').first().click()
    else await panel.locator('.chart-empty').click()
    await expect(dialog).toBeVisible()
    await expect(close).toBeFocused()
    await expect(dialog.locator('.model-row')).toHaveCount(count)
    await expect(dialog.locator('.model-name')).toHaveText(expected.map(model => model.modelId))
    if (count) {
      await page.keyboard.press('Tab')
      await expect(dialog.locator('.model-row').first()).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
    }
    if (!count) await expect(dialog).toContainText('暂无模型数据')
    if (count) {
      const shares = expected.map(model => `${(model.metrics.total / total * 100).toFixed(1)}%`)
      await expect(panel.locator('.model-share')).toHaveText(shares.slice(0, 10))
      await expect(dialog.locator('.model-share')).toHaveText(shares)
      await expect(dialog.locator('.model-row').last()).toContainText('费用未知')
      await expect(dialog.locator('.model-row').first()).toContainText('计价未核实')
    }
    await close.click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await opener.press('Enter')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await opener.press('Space')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    if (count !== 14) return
    await page.getByRole('button', { name: '模型堆叠', exact: true }).click()
    await expect(page.locator('.chart-legend .model-key')).toHaveCount(count)
    await expect(page.locator('.plot rect')).toHaveCount(count)
    await expect(page.locator('.inspection .detail-model')).toHaveCount(count)
    const last = expected.at(-1)!
    await expect(dropdown.locator('option', { hasText: last.modelId })).toHaveCount(1)
    await mkdir('.cache/issue238', { recursive: true })
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 520 : 1000 })
      await opener.scrollIntoViewIfNeeded()
      await captureTokenPage(page, `.cache/issue238/model-preview-${width}.png`)
      await opener.click()
      await expect(dialog.locator('.model-row')).toHaveCount(count)
      await expect(close).toBeInViewport()
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      const list = dialog.locator('.model-dialog-list')
      expect(await list.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
      await captureTokenViewport(page, `.cache/issue238/model-dialog-${width}.png`)
      const lastButton = dialog.getByRole('button', { name: `筛选${last.modelId}`, exact: true })
      await lastButton.scrollIntoViewIfNeeded()
      await expect(lastButton).toBeInViewport()
      expect(await lastButton.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await expect(close).toBeInViewport()
      await captureTokenViewport(page, `.cache/issue238/model-dialog-last-${width}.png`)
      await page.keyboard.press('Escape')
      await expect(opener).toBeFocused()
    }
    await opener.click()
    await dialog.getByRole('button', { name: `筛选${last.modelId}`, exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(dropdown).toHaveValue(JSON.stringify(last.modelId))
    await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '1000')
    await expect(panel.locator('.model-row')).toHaveCount(1)
    await opener.click()
    await expect(dialog.locator('.model-row')).toHaveCount(1)
    await dialog.getByRole('button', { name: `取消筛选${last.modelId}`, exact: true }).click()
    await expect(dropdown).toHaveValue('')
    await expect(panel.locator('.model-row')).toHaveCount(10)
    await dropdown.selectOption(JSON.stringify(last.modelId))
    await expect(panel.locator('.model-row')).toHaveCount(1)
    await panel.getByRole('button', { name: '清除模型筛选', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(dropdown).toHaveValue('')
    await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', String(total))
    await page.getByLabel('Agent', { exact: true }).selectOption(rows[0].agent)
    await page.getByLabel('设备', { exact: true }).selectOption(rows[0].deviceId)
    await page.getByLabel('时间范围', { exact: true }).selectOption('1')
    await expect(panel.locator('.model-row')).toHaveCount(10)
    await opener.click()
    await expect(dialog.locator('.model-row')).toHaveCount(count)
    await page.keyboard.press('Escape')
    await page.getByLabel('Agent', { exact: true }).selectOption(rows[0].agent === 'codex' ? 'claude' : 'codex')
    await expect(panel).toContainText('暂无模型数据')
    await opener.click()
    await expect(dialog).toContainText('暂无模型数据')
    await expect(dialog.locator('.model-row')).toHaveCount(0)
  })
}

test('agent options name all six sources and filter by client id', async ({ page }) => {
  const queries: URL[] = []
  page.on('request', request => { if (request.url().includes('/api/token/summary')) queries.push(new URL(request.url())) })
  await page.goto('/token')
  const agent = page.getByLabel('Agent', { exact: true })
  await expect(agent.locator('option')).toHaveText(['全部 Agent', 'Codex', 'Grok Build', 'Hermes Agent', 'Claude Code', 'WorkBuddy', 'Cursor'])
  await agent.selectOption('grok')
  await expect(page.locator('.scope-line')).toContainText('Grok Build')
  await expect.poll(() => queries.some(url => url.searchParams.get('agent') === 'grok')).toBe(true)
  await agent.selectOption('hermes')
  await expect(page.locator('.scope-line')).toContainText('Hermes Agent')
  await expect.poll(() => queries.some(url => url.searchParams.get('agent') === 'hermes')).toBe(true)
  for (const [value, label] of [['claude', 'Claude Code'], ['workbuddy', 'WorkBuddy'], ['cursor', 'Cursor']]) {
    await agent.selectOption(value)
    await expect(page.locator('.scope-line')).toContainText(label)
    await expect.poll(() => queries.some(url => url.searchParams.get('agent') === value)).toBe(true)
  }
  await agent.selectOption('')
  await expect(page.locator('.scope-line')).toContainText('全部 Agent')
})

test('calendar hover, persistence, focus, arrows, Escape and findable detail semantics', async ({ page }) => {
  await page.setViewportSize({ width: 952, height: 1000 })
  await page.goto('/token')
  const cell = page.locator('[data-date="2026-11-15"]'), hint = page.getByRole('tooltip')
  await expect(cell).toBeEnabled()
  await cell.hover()
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('1,242,583 Token')
  await captureTokenViewport(page, '.impeccable/review/token-frontend/calendar-hint.png')
  await hint.hover(); await expect(hint).toBeVisible()
  await page.keyboard.press('Escape'); await expect(hint).toBeHidden()
  await cell.focus(); await expect(hint).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-date="2026-11-14"]')).toBeFocused()
  await expect(hint).toContainText('2026/11/14')
  await expect(page.locator('[data-date="2026-11-16"]')).toBeDisabled()
  await page.getByRole('heading', { name: '使用日历', exact: true }).click()
  await expect(hint).toBeHidden()
  await expect(cell).toHaveAccessibleName(/2026-11-15.*Token/)
  await expect(cell).not.toHaveAttribute('aria-describedby')
})

test.describe('touch', () => {
 test.use({ hasTouch: true })
 test('model dialog opens by touch and reports loading before the response', async ({ page, context }) => {
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await context.route('**/api/token/summary?*', async route => {
    const query = new URL(route.request().url()).searchParams
    await pending
    await route.fulfill({ json: summarize(selectRows(query), query.has('modelKey')) })
  })
  await page.setViewportSize({ width: 390, height: 520 })
  await page.goto('/token')
  const panel = page.locator('.model-panel'), dialog = page.getByRole('dialog', { name: '完整模型列表' })
  try {
    await expect(panel).toContainText('正在读取模型…')
    await panel.locator('.chart-empty').tap()
    await expect(dialog).toContainText('正在读取模型…')
    await expect(dialog.locator('.model-row')).toHaveCount(0)
  } finally { release() }
  await expect(dialog.locator('.model-row')).toHaveCount(4)
  await dialog.getByRole('button', { name: '关闭完整模型列表' }).tap()
  await expect(dialog).toBeHidden()
  await expect(panel.getByRole('button', { name: '查看完整列表' })).toBeFocused()
 })

 test('phone tap tooltip, viewport placement and narrow-height navigation', async ({ page }) => {
  await page.goto('/token')
  await page.setViewportSize({ width: 390, height: 520 })
  await page.locator('[data-date="2026-11-15"]').tap()
  await expect(page.getByRole('tooltip')).toBeVisible()
  const box = await page.getByRole('tooltip').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y + box!.height).toBeLessThanOrEqual(520)
  await expect(page.getByRole('link', { name: 'Token', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '账户菜单', exact: true })).toBeInViewport()
  await captureTokenViewport(page, '.impeccable/review/token-frontend/touch-calendar.png')
})

})

test('failed query, too-broad range, empty/zero/unknown and retry', async ({ page, context }) => {
  let failing = true
  await context.route('**/api/token/summary?*', async route => {
    if (failing) return route.fulfill({ status: 400, json: { error: { code: 'TOKEN_QUERY_TOO_BROAD', message: '' } } })
    return route.fulfill({ json: summarize([]) })
  })
  await page.goto('/token')
  await expect(page.getByText('查询范围过大，请缩短时间或选择设备、Agent 后重试。').first()).toBeVisible()
  await page.getByRole('button', { name: '查看完整列表' }).click()
  const dialog = page.getByRole('dialog', { name: '完整模型列表' })
  await expect(dialog).toContainText('模型暂不可用')
  await expect(dialog.locator('.model-row')).toHaveCount(0)
  await page.keyboard.press('Escape')
  failing = false
  await page.getByRole('button', { name: '重试', exact: true }).first().click()
  await expect(page.getByText('暂无用量', { exact: true })).toBeVisible()
  await expect(page.getByTestId('token-total')).toHaveText('—')
})

test('out-of-order range responses cannot replace current data', async ({ page, context }) => {
  await context.route('**/api/token/summary?*', async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('startDate') === '2026-11-09') await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({ json: summarize(selectRows(query), query.has('modelKey')) }).catch(() => {})
  })
  await page.goto('/token')
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '51938778')
  await page.getByLabel('时间范围', { exact: true }).selectOption('week')
  await page.getByLabel('时间范围', { exact: true }).selectOption('1')
  const expected = summarize(fixtureRows.filter(row => row.date === fixedToday)).totals.metrics.total
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', String(expected))
  await page.waitForTimeout(350)
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', String(expected))
})

test('disable is explicitly confirmed; error stays recoverable; history remains', async ({ page, context }) => {
  let calls = 0
  await context.route('**/api/token/devices/disable', async route => {
    calls++
    expect(route.request().postDataJSON()).toEqual({ deviceId: 'mac' })
    await route.fulfill({ status: calls === 1 ? 503 : 200, json: calls === 1 ? { error: { code: 'TOKEN_UNAVAILABLE', message: '' } } : { deviceId: 'mac', disabled: true } })
  })
  await page.goto('/token')
  await page.setViewportSize({ width: 320, height: 844 })
  await page.getByRole('button', { name: '停用', exact: true }).first().click()
  await page.getByRole('button', { name: '确认停用', exact: true }).scrollIntoViewIfNeeded()
  await captureTokenViewport(page, '.impeccable/review/token-frontend/device-disable.png')
  expect(calls).toBe(0)
  await page.getByRole('button', { name: '取消', exact: true }).click(); expect(calls).toBe(0)
  await page.getByRole('button', { name: '停用', exact: true }).first().click()
  await page.getByRole('button', { name: '确认停用', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '结果未确认' })).toBeVisible()
  await page.getByRole('button', { name: '确认停用', exact: true }).click()
  await expect(page.getByText('设备已停用，历史用量保留。')).toBeVisible()
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '51938778')
})

test('device code survives refresh, rebind needs checkbox, conflict needs inspect', async ({ page, context }) => {
  let decisions = 0, conflict = true
  await context.route('**/api/token/registrations/inspect', route => route.fulfill({ json: { requestId: '00000000-0000-4000-8000-000000000217', deviceId: 'mac', hostname: 'atlas-macbook', platform: 'macos', status: 'pending', expiresAt: '2026-11-15T06:42:00Z', replacesExisting: true } }))
  await context.route('**/api/token/registrations/decide', async route => {
    decisions++; expect(route.request().postDataJSON().replaceExisting).toBe(true)
    await route.fulfill({ status: conflict ? 409 : 200, json: conflict ? { error: { code: 'TOKEN_REBIND_REQUIRED', message: '' } } : { status: 'approved' } })
  })
  await page.goto('/token/devices/confirm?code=ABCDEFGH')
  await expect(page).toHaveTitle('确认采集设备 · LifeSpace')
  await expect(page.getByLabel('设备码（8 位字母或数字）')).toHaveValue('ABCDEFGH')
  await page.reload()
  await expect(page).toHaveTitle('确认采集设备 · LifeSpace')
  await page.getByRole('button', { name: '核对设备', exact: true }).click()
  await expect(page.getByRole('button', { name: '批准连接' })).toBeDisabled()
  await captureTokenPage(page, '.impeccable/review/token-frontend/device-confirmation.png')
  expect(decisions).toBe(0)
  await page.getByRole('checkbox').check()
  await page.setViewportSize({ width: 320, height: 844 })
  await page.getByRole('button', { name: '批准连接' }).scrollIntoViewIfNeeded()
  await captureTokenViewport(page, '.impeccable/review/token-frontend/device-rebind.png')
  await page.getByRole('button', { name: '批准连接' }).click()
  await expect(page.getByRole('alert')).toContainText('重新核对')
  await expect(page.getByRole('button', { name: '批准连接' })).toHaveCount(0)
  conflict = false
  await page.getByRole('button', { name: '核对设备', exact: true }).click()
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '批准连接' }).click()
  await expect(page.getByRole('status')).toContainText('已批准，请返回终端继续领取')
  expect(await page.locator('body').textContent()).not.toMatch(/claimSecret|uploadToken/)
})

test('deep links, title, shared navigation and browser back', async ({ page }) => {
  await page.goto('/token')
  await expect(page).toHaveTitle(/Token 用量/)
  await page.getByRole('link', { name: '确认设备码', exact: true }).click()
  await expect(page).toHaveURL(/\/token\/devices\/confirm$/)
  await expect(page).toHaveTitle(/确认采集设备/)
  await page.goBack()
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '51938778')
})

for (const [status, text, superseded] of [['denied', '已拒绝', false], ['approved', '已批准', false], ['claimed', '已领取', false], ['claimed', '已停用或被新授权替换', true]] as const) {
  test(`registration terminal state ${status}/${superseded}`, async ({ page, context }) => {
    await context.route('**/api/token/registrations/inspect', route => route.fulfill({ json: { requestId: '00000000-0000-4000-8000-000000000217', deviceId: 'mac', hostname: 'atlas-macbook', platform: 'macos', status, expiresAt: '2026-11-15T06:42:00Z', replacesExisting: true, superseded } }))
    await page.goto('/token/devices/confirm?code=ABCDEFGH')
    await page.getByRole('button', { name: '核对设备', exact: true }).click()
    await expect(page.getByRole('status')).toContainText(text)
    await expect(page.getByRole('button', { name: '批准连接' })).toHaveCount(0)
  })
}

test('not found, explicit denial and expiry stay recoverable', async ({ page, context }) => {
  let state = 'not-found'
  await context.route('**/api/token/registrations/inspect', route => state === 'not-found' ? route.fulfill({ status: 404, json: { error: { code: 'TOKEN_NOT_FOUND', message: '' } } }) : route.fulfill({ json: { requestId: '00000000-0000-4000-8000-000000000217', deviceId: 'mac', hostname: 'atlas-macbook', platform: 'macos', status: 'pending', expiresAt: state === 'expired' ? '2026-11-15T06:31:00Z' : '2026-11-15T06:42:00Z', replacesExisting: false } }))
  await context.route('**/api/token/registrations/decide', route => {
    expect(route.request().postDataJSON()).toMatchObject({ approve: false, replaceExisting: false })
    return route.fulfill({ json: { status: 'denied' } })
  })
  await page.goto('/token/devices/confirm?code=ABCDEFGH')
  await page.getByRole('button', { name: '核对设备', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('未找到或已过期')
  state = 'expired'; await page.getByRole('button', { name: '核对设备', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('申请已过期')
  state = 'pending'; await page.getByRole('button', { name: '核对设备', exact: true }).click()
  await page.getByRole('button', { name: '拒绝连接' }).click()
  await expect(page.getByRole('status')).toContainText('已拒绝')
})

test('manual tooltip and expanded search fallback without browser APIs', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined, configurable: true })
    delete (HTMLElement.prototype as unknown as { onbeforematch?: unknown }).onbeforematch
  })
  await page.goto('/token')
  await expect(page.getByRole('button', { name: '日统计明细' })).toHaveAttribute('aria-expanded', 'true')
  const cell = page.locator('[data-date="2026-11-15"]')
  await expect(cell).toBeEnabled(); await cell.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('tooltip')).toBeInViewport()
  const hintBox = await page.getByRole('tooltip').boundingBox()
  const viewport = page.viewportSize()!
  expect(hintBox!.x).toBeGreaterThanOrEqual(0); expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(viewport.width)
  expect(hintBox!.y).toBeGreaterThanOrEqual(0); expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(viewport.height)
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toBeHidden()
})

test('long identities, large counts and tiny unverified fees remain readable', async ({ page, context }) => {
  const source = fixtureRows.find(row => row.date === fixedToday)!
  const metrics = { input: 9000000000000000, output: 0, total: 9000000000000000, cacheRead: 0 }
  const cost = { currency: 'USD', apiEstimate: '0.00000000001', coverage: 'unverified' as const }
  const row = { ...source, metrics, cost, models: [{ modelId: 'long-model-'.repeat(18), providerId: null, metrics, cost }] }
  await context.route('**/api/token/summary?*', route => route.fulfill({ json: summarize([row]) }))
  await context.route('**/api/token/usage?*', route => route.fulfill({ json: { timeZone: 'Asia/Shanghai', scope: 'main', rows: [row], nextCursor: null } }))
  await context.route('**/api/token/devices*', route => route.fulfill({ json: { devices: [{ ...fixtureDevices[0], hostname: 'workstation-'.repeat(20) }], nextCursor: null, serverTime: '2026-11-15T06:32:00Z' } }))
  await page.goto('/token')
  await expect(page.getByTestId('token-total')).toHaveAttribute('data-value', '9000000000000000')
  await expect(page.locator('.metric-band')).toContainText('<$0.01')
  await expect(page.locator('.metric-band')).toContainText('计价未核实')
  await page.getByRole('button', { name: '费用', exact: true }).click()
  await page.getByRole('button', { name: '模型堆叠', exact: true }).click()
  await page.locator('.plot').focus(); await page.keyboard.press('End')
  await expect(page.locator('.inspection .detail-model')).toContainText('<$0.01')
  await expect(page.locator('.inspection .detail-model')).toContainText('计价未核实')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('anonymous and unapproved accounts cannot query Token routes; safe code context stays', async ({ context }) => {
  let tokenCalls = 0
  await context.route('**/api/token/**', route => { tokenCalls++; return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: '' } } }) })
  await context.route('**/api/auth/me', route => route.fulfill({ status: 403, json: { error: { code: 'AUTH_DENIED', message: '' } } }))
  const denied = await context.newPage()
  await denied.goto('/token/devices/confirm?code=ABCDEFGH')
  await expect(denied.getByText('此账户暂未获准访问 LifeSpace。')).toBeVisible()
  expect(tokenCalls).toBe(0)
  await denied.close()
  await context.addInitScript(() => localStorage.removeItem('sb-auth-test-auth-token'))
  const anonymous = await context.newPage()
  await anonymous.goto('/token/devices/confirm?code=ABCDEFGH')
  await expect(anonymous.getByRole('button', { name: '登录 LifeSpace', exact: true })).toBeVisible()
  await expect(anonymous).toHaveURL(/code=ABCDEFGH$/)
  expect(tokenCalls).toBe(0)
  await anonymous.close()
})

test('known zero retains its amount independently of unverified coverage', async ({ page, context }) => {
  const source = fixtureRows.find(row => row.date === fixedToday)!
  const cost = { currency: 'USD', apiEstimate: '0', coverage: 'unverified' as const }
  const row = { ...source, cost, models: [{ ...source.models[0], cost }] }
  await context.route('**/api/token/summary?*', route => route.fulfill({ json: summarize([row]) }))
  await page.goto('/token')
  await expect(page.locator('.model-row-values')).toContainText('$0.00')
  await expect(page.locator('.model-row-values')).toContainText('计价未核实')
  await expect(page.locator('.model-row-values')).not.toContainText('费用未知')
})

test('mounted Beijing new-year rollover keeps a keyboard calendar entry', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-31T15:59:59Z'))
  await page.goto('/token')
  await expect(page.locator('[data-date="2026-12-31"]')).toHaveAttribute('tabindex', '0')
  await page.clock.setFixedTime(new Date('2026-12-31T16:00:01Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const first = page.locator('[data-date="2027-01-01"]')
  await expect(first).toBeEnabled()
  await expect(first).toHaveAttribute('tabindex', '0')
  await first.focus(); await page.keyboard.press('End')
  await expect(first).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('2027/01/01')
})

test('email auth callback restores only the safe device context, including a new tab', async ({ page, context }) => {
  await page.goto('/token/devices/confirm?code=ABCDEFGH')
  await page.goto('/auth/callback')
  await expect(page).toHaveURL('/token/devices/confirm?code=ABCDEFGH')
  await expect(page.getByLabel('设备码（8 位字母或数字）')).toHaveValue('ABCDEFGH')
  const second = await context.newPage()
  await second.goto('/auth/callback?deviceCode=ABCDEFGH')
  await expect(second).toHaveURL('/token/devices/confirm?code=ABCDEFGH')
  await expect(second.getByRole('heading', { name: '确认采集设备', exact: true })).toBeVisible()
  await second.close()
  await page.evaluate(() => sessionStorage.clear())
  await page.goto('/auth/callback?deviceCode=https%3A%2F%2Fevil.invalid&returnTo=https%3A%2F%2Fevil.invalid')
  await expect(page).toHaveURL('/')
})

test('expired browser return context is discarded', async ({ page }) => {
  await page.goto('/token/devices/confirm?code=ABCDEFGH')
  await page.clock.setFixedTime(new Date('2026-11-15T06:43:00Z'))
  await page.goto('/auth/callback')
  await expect(page).toHaveURL('/')
})

test('design contracts are unavailable as static development assets', async ({ request }) => {
  for (const path of ['/DESIGN.md', '/.impeccable/design.json']) {
    const response = await request.get(path)
    expect([403, 404]).toContain(response.status())
  }
})

test('native text-fragment search reveals the hidden daily table', async ({ page }) => {
  await page.goto('/token')
  await expect(page.locator('#token-daily-details tbody tr')).toHaveCount(30)
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = '/token#:~:text=1%2C242%2C583'
    link.textContent = 'Native daily search'
    document.querySelector<HTMLElement>('main')!.appendChild(link)
  })
  await page.getByRole('link', { name: 'Native daily search', exact: true }).click()
  await expect(page.getByRole('button', { name: '日统计明细' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#token-daily-details')).not.toHaveAttribute('hidden')
})


test('empty device enrollment command wraps at both phone widths', async ({ page }) => {
  await page.route('**/api/token/devices*', route => route.fulfill({ json: { devices: [], nextCursor: null, serverTime: '2026-11-15T06:32:00Z' } }))
  await page.goto('/token')
  const message = page.locator('.device-empty')
  await expect(message).toContainText('lifespace-usage init --server')
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await message.scrollIntoViewIfNeeded()
    expect(await message.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await captureTokenViewport(page, `.impeccable/review/token-frontend/device-empty-${width}.png`)
  }
})
