import { test, expect } from './authenticated-test'
import { installLedgerDatabase, ledgerRequest, ledgerRpc } from '../support/ledger-database'
import { ledgerAccountReceiptSchema, ledgerAccountsSchema } from '../../src/shared/ledger'
import { writeFile } from 'node:fs/promises'

let restore: () => void
let owner: string
let loseNextSave: boolean
let writes: { method: string; body: Record<string, unknown> }[]
let pageErrors: string[]
const create = async (name = '银行卡', balanceCents = 100000) => {
  const response = await ledgerRequest(owner, '/api/ledger/accounts', { requestId: crypto.randomUUID(), name, balanceCents })
  expect(response.status).toBe(200)
  return ledgerAccountReceiptSchema.parse(await response.json()).accountId
}
const patch = (id: string, fields: Record<string, unknown>) => ledgerRequest(owner, `/api/ledger/accounts/${id}`, { requestId: crypto.randomUUID(), ...fields }, 'PATCH')
test.describe('正式财务页账户 → Worker → 隔离数据库', () => {
  test.setTimeout(40000)
  test.skip(!ledgerRpc, '须显式启动隔离数据库，跳过不计通过')
  test.beforeEach(async ({ context, page }) => {
    restore = installLedgerDatabase()
    owner = crypto.randomUUID()
    loseNextSave = false; writes = []; pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await context.route('**/api/ledger/**', async route => {
      const req = route.request(), url = new URL(req.url())
      const response = await ledgerRequest(owner, url.pathname + url.search, req.method() === 'GET' ? undefined : req.postDataJSON(), req.method())
      if (req.method() === 'POST' || req.method() === 'PATCH') {
        writes.push({ method: req.method(), body: req.postDataJSON() })
        if (loseNextSave) { loseNextSave = false; await route.abort('failed'); return }
      }
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => { try { expect(pageErrors).toEqual([]) } finally { restore?.() } })
  test('桌面从正式页面新增负余额账户，刷新后可改名并修正至零', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/finance')
    await page.getByRole('button', { name: '新增账户', exact: true }).first().click()
    const form = page.getByRole('dialog', { name: '新增账户', exact: true })
    await form.getByLabel('账户名称', { exact: true }).fill('  零钱  ')
    await form.getByLabel('初始余额', { exact: true }).fill('-12.34')
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form).toBeHidden()
    await page.reload()
    const accounts = page.getByRole('region', { name: '交易账户', exact: true })
    await expect(accounts).toContainText('零钱')
    await expect(accounts).toContainText('-12.34')
    await accounts.getByRole('button', { name: '修改零钱', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '修改账户', exact: true })
    await edit.getByLabel('账户名称', { exact: true }).fill('现金')
    await edit.getByLabel('当前余额', { exact: true }).fill('0')
    await edit.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(edit).toBeHidden()
    await page.reload()
    await expect(accounts).toContainText('现金')
    await expect(accounts).toContainText('0.00')
    await expect(page.getByRole('region', { name: '账单流水', exact: true })).toContainText('0 条流水')
  })

  test('修改余额冲突保留输入，重读最新金额后显式核对并重新提交', async ({ page }) => {
    const id = await create()
    await page.goto('/finance')
    await page.getByRole('button', { name: '修改银行卡', exact: true }).click()
    const form = page.getByRole('dialog', { name: '修改账户', exact: true })
    await form.getByLabel('当前余额', { exact: true }).fill('900')
    expect((await patch(id, { balanceCents: 80000, expectedBalanceCents: 100000 })).status).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(form.getByLabel('当前余额', { exact: true })).toHaveValue('900')
    await form.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('余额已变化')
    await expect(form.getByRole('status')).toContainText('800.00')
    await expect(form.getByLabel('当前余额', { exact: true })).toHaveValue('900')
    expect(writes[0].body).toMatchObject({ balanceCents: 90000, expectedBalanceCents: 100000 })
    await page.screenshot({ path: '.cache/ledger119-conflict.png' })
    await form.getByRole('button', { name: '核对后保存修改', exact: true }).click()
    await expect(form).toBeHidden()
    expect(writes[1].body).toMatchObject({ balanceCents: 90000, expectedBalanceCents: 80000 })
    expect(writes[0].body.requestId).not.toBe(writes[1].body.requestId)
    await page.reload()
    await expect(page.getByRole('region', { name: '交易账户', exact: true })).toContainText('900.00')
  })

  test('只改名不提交旧余额，成功写入与重新聚焦都刷新账户并保留表单', async ({ page }) => {
    const id = await create()
    await page.goto('/finance')
    await page.getByRole('button', { name: '修改银行卡', exact: true }).click()
    const form = page.getByRole('dialog', { name: '修改账户', exact: true })
    await form.getByLabel('账户名称', { exact: true }).fill('工资卡')
    expect((await patch(id, { balanceCents: 90000, expectedBalanceCents: 100000 })).status).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(form.getByLabel('账户名称', { exact: true })).toHaveValue('工资卡')
    await expect(form.getByLabel('当前余额', { exact: true })).toHaveValue('1000.00')
    await form.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(form).toBeHidden()
    expect(writes).toHaveLength(1)
    expect(Object.keys(writes[0].body).sort()).toEqual(['name', 'requestId'])
    await expect(page.getByRole('region', { name: '交易账户', exact: true })).toContainText('900.00')
    await expect(page.getByRole('button', { name: '修改工资卡', exact: true })).toBeVisible()
    await create('另一设备', -100)
    await page.getByRole('button', { name: '刷新数据', exact: true }).click()
    await expect(page.getByRole('region', { name: '交易账户', exact: true })).toContainText('另一设备')
  })

  for (const closed of [false, true]) test(`未知请求未入库${closed ? '且已关闭表单' : ''}时重试得到明确余额冲突，解除冻结并保留输入供重新核对`, async ({ page, context }) => {
    const id = await create()
    let drop = true
    // Simulate a transport failure before the request reaches the Worker.
    // The retry and competing write still execute the real business RPCs.
    await context.route(`**/api/ledger/accounts/${id}`, async route => {
      if (drop) { drop = false; await route.abort('failed') }
      else await route.fallback()
    })
    await page.goto('/finance')
    await page.getByRole('button', { name: '修改银行卡', exact: true }).click()
    const form = page.getByRole('dialog', { name: '修改账户', exact: true })
    await form.getByLabel('当前余额', { exact: true }).fill('900')
    await form.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('保存结果未确认')
    await expect(form.getByLabel('当前余额', { exact: true })).toBeDisabled()
    if (closed) await form.getByRole('button', { name: '取消', exact: true }).click()
    expect((await patch(id, { balanceCents: 80000, expectedBalanceCents: 100000 })).status).toBe(200)
    if (closed) await page.getByRole('button', { name: '重试原账户请求', exact: true }).click()
    else await form.getByRole('button', { name: '重试原请求', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('余额已变化')
    await expect(form.getByLabel('当前余额', { exact: true })).toBeEnabled()
    await expect(form.getByLabel('当前余额', { exact: true })).toHaveValue(/^900(?:\.00)?$/)
    await expect(form.getByRole('status')).toContainText('800.00')
    await form.getByRole('button', { name: '核对后保存修改', exact: true }).click()
    await expect(form).toBeHidden()
    await page.reload()
    await expect(page.getByRole('article', { name: '银行卡', exact: true })).toContainText('900.00')
  })

  test('保存响应丢失后原请求显式重试，开户和修正均不重复也不覆盖后续余额', async ({ page }) => {
    await page.goto('/finance')
    await page.getByRole('button', { name: '新增账户', exact: true }).first().click()
    const form = page.getByRole('dialog', { name: '新增账户', exact: true })
    await form.getByLabel('账户名称', { exact: true }).fill('零钱')
    await form.getByLabel('初始余额', { exact: true }).fill('1000')
    loseNextSave = true
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('保存结果未确认')
    await expect(form.getByLabel('账户名称', { exact: true })).toBeDisabled()
    await form.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新增账户', exact: true }).first().click()
    await form.getByLabel('账户名称', { exact: true }).fill('饭卡')
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form).toBeHidden()
    await page.getByRole('button', { name: '重试原账户请求', exact: true }).click()
    await expect.poll(() => writes.length).toBe(3)
    await expect(form).toBeHidden()
    expect(writes[0].body).toEqual(writes[2].body)
    const { accounts } = ledgerAccountsSchema.parse(await (await ledgerRequest(owner, '/api/ledger/accounts')).json())
    expect(accounts).toHaveLength(2)
    const id = accounts.find(account => account.name === '零钱')!.id
    await page.getByRole('button', { name: '修改零钱', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '修改账户', exact: true })
    await edit.getByLabel('当前余额', { exact: true }).fill('900')
    loseNextSave = true
    await edit.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(edit.getByRole('alert')).toContainText('保存结果未确认')
    expect((await patch(id, { balanceCents: 80000, expectedBalanceCents: 90000 })).status).toBe(200)
    await edit.getByRole('button', { name: '重试原请求', exact: true }).click()
    await expect(edit).toBeHidden()
    expect(writes[3].body).toEqual(writes[4].body)
    await page.reload()
    await expect(page.getByRole('article', { name: '零钱', exact: true })).toContainText('800.00')
  })

  for (const width of [390, 360]) test(`${width}px 手机保留无效输入、名称冲突提示，支持金额上下界与长名称`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await create('已有账户', 0)
    await page.goto('/finance')
    await page.getByRole('button', { name: '新增账户', exact: true }).first().click()
    const form = page.getByRole('dialog', { name: '新增账户', exact: true })
    const name = form.getByLabel('账户名称', { exact: true }), balance = form.getByLabel('初始余额', { exact: true })
    await name.fill('已有账户')
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('同名账户')
    await expect(name).toHaveValue('已有账户')
    await name.fill('😀'.repeat(51))
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('50')
    await name.fill('😀'.repeat(50))
    for (const [input, error] of [['1.001', '两位小数'], ['1e3', '两位小数'], ['1000000000', '999,999,999.99'], ['-1000000000', '999,999,999.99']]) {
      await balance.fill(input)
      await form.getByRole('button', { name: '保存账户', exact: true }).click()
      await expect(form.getByRole('alert')).toContainText(error)
      await expect(balance).toHaveValue(input)
    }
    await balance.fill('-999999999.99')
    await form.getByRole('button', { name: '保存账户', exact: true }).click()
    await expect(form).toBeHidden()
    await page.reload()
    const card = page.getByRole('article', { name: '😀'.repeat(50), exact: true })
    await expect(card).toContainText('-999,999,999.99')
    await card.getByRole('button', { name: `修改${'😀'.repeat(50)}`, exact: true }).click()
    const edit = page.getByRole('dialog', { name: '修改账户', exact: true })
    await edit.getByLabel('当前余额', { exact: true }).fill('999999999.99')
    await page.screenshot({ path: `.cache/ledger119-mobile-form-${width}.png` })
    await edit.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(edit).toBeHidden()
    await expect(card).toContainText('999,999,999.99')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `.cache/ledger119-mobile-boundary-${width}.png`, fullPage: true })
  })

  test('A 布局账户位于流水上方，桌面和手机可通过键盘修改且无调试或越界入口', async ({ page }) => {
    for (const [name, cents] of [['招商储蓄卡', 1865080], ['微信零钱', 28650], ['支付宝余额', 124000], ['饭卡', 12800], ['现金', -2500]] as const) await create(name, cents)
    await page.goto('/finance')
    const renders = []
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 })
      const accounts = page.getByRole('region', { name: '交易账户', exact: true })
      await expect(accounts.getByRole('article')).toHaveCount(5)
      const cards = await accounts.boundingBox(), ledger = await page.getByRole('region', { name: '账单流水', exact: true }).boundingBox()
      expect(cards && ledger && cards.y + cards.height <= ledger.y).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.cache/ledger119-layout-${width}.png`, fullPage: true })
      renders.push(await page.evaluate(() => {
        const card = document.querySelector('.la-account-card')!, title = card.querySelector('h3')!, balance = card.querySelector('.la-balance')!
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cardPadding: getComputedStyle(card).padding, cardGap: getComputedStyle(document.querySelector('.la-account-grid')!).gap,
          title: { fontSize: getComputedStyle(title).fontSize, color: getComputedStyle(title).color }, balance: { fontSize: getComputedStyle(balance).fontSize, color: getComputedStyle(balance).color, whiteSpace: getComputedStyle(balance).whiteSpace } }
      }))
    }
    await page.getByRole('button', { name: '修改现金', exact: true }).focus()
    await page.keyboard.press('Enter')
    const edit = page.getByRole('dialog', { name: '修改账户', exact: true })
    await expect(edit.getByLabel('账户名称', { exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(edit).toBeHidden()
    await expect(page.getByRole('button', { name: /停用|删除账户|重置演示|数据状态|修正记录/ })).toHaveCount(0)
    await writeFile('.cache/ledger119-render-check.json', JSON.stringify({ renders, pageErrors }, null, 2))
  })
})
