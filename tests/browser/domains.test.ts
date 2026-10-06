import { expect, test } from '@playwright/test'

const domains = [
  { name: 'onepeace.cc.cd', status: 'registered', expiresOn: '2026-10-20', neverExpires: false },
  { name: 'permanent.cc.cd', status: 'active', expiresOn: null, neverExpires: true },
  { name: 'unknown.cc.cd', status: 'suspended', expiresOn: null, neverExpires: false },
  { name: 'expired.cc.cd', status: 'expired', expiresOn: '2026-10-01', neverExpires: false },
]
const result = { fetchedAt: '2026-10-06T00:00:00Z', domains }

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T00:00:00Z') })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'NOT_CONFIGURED', message: '来源尚未配置' } } }))
})

test('登录页独立跳转，摘要显示数量，无提醒且详情完整只读', async ({ page, context }) => {
  await page.route('**/api/domains', route => route.fulfill({ json: result }))
  await context.route('https://my.dnshe.com/clientarea.php', route => route.fulfill({ body: 'DNSHE 登录' }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看DNSHE 域名详情' })
  await expect(card).toContainText('04')
  await expect(card).not.toContainText('需关注到期')
  await expect(card).toContainText('剩余 14 天')
  await expect(card).toContainText('已注册')
  await expect(card).toContainText('永久有效')
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'DNSHE 登录' }).click()
  const popup = await popupPromise
  await popup.waitForURL('https://my.dnshe.com/clientarea.php')
  await popup.close()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await card.click()
  const dialog = page.getByRole('dialog', { name: 'DNSHE 域名' })
  await expect(dialog).toContainText('unknown.cc.cd')
  await expect(dialog).toContainText('已暂停')
  await expect(dialog).toContainText('到期日期未知')
  await expect(dialog).toContainText('2026-10-20')
  await expect(dialog).not.toContainText('提示关注')
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: 'DNSHE 登录' })).toHaveAttribute('href', 'https://my.dnshe.com/clientarea.php')
})

test('未配置与空列表不同，登录入口始终可用', async ({ page }) => {
  await page.route('**/api/domains', route => route.fulfill({ status: 503, json: { error: { code: 'DOMAINS_NOT_CONFIGURED', message: 'DNSHE 信息尚未接入' } } }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看DNSHE 域名详情' })
  await expect(card).toContainText('DNSHE 信息尚未接入')
  await expect(page.getByRole('link', { name: 'DNSHE 登录' })).toHaveAttribute('href', 'https://my.dnshe.com/clientarea.php')
  await page.route('**/api/domains', route => route.fulfill({ json: { ...result, domains: [] } }))
  await page.getByRole('button', { name: '刷新DNSHE 域名' }).click()
  await expect(card).toContainText('暂无域名')
})

test('刷新失败保留旧数据，跨午夜更新剩余天数', async ({ page }) => {
  let failed = false
  await page.route('**/api/domains', route => route.fulfill(failed ? { status: 502, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '域名获取失败' } } } : { json: result }))
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看DNSHE 域名详情' })
  await expect(card).toContainText('剩余 14 天')
  failed = true
  await page.getByRole('button', { name: '刷新DNSHE 域名' }).click()
  await expect(card).toContainText('上次结果')
  await expect(card).toContainText('剩余 14 天')
  await page.clock.fastForward(24 * 3600000)
  await expect(card).toContainText('剩余 13 天')
  await page.getByRole('button', { name: '查看世界时间详情' }).click()
  await expect(page.getByRole('dialog')).toContainText('UTC+8')
})

test('电脑和手机的长域名摘要与详情无横向溢出', async ({ page }) => {
  const longDomain = { ...domains[0], name: `${'a'.repeat(63)}.cc.cd` }
  await page.route('**/api/domains', route => route.fulfill({ json: { ...result, domains: [longDomain, ...domains] } }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: '查看DNSHE 域名详情' })).toContainText(longDomain.name)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.getByRole('button', { name: '查看DNSHE 域名详情' }).click()
    expect(await page.getByRole('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
    await page.getByRole('button', { name: '关闭详情' }).click()
  }
})
