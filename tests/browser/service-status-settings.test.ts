import { expect, test } from './authenticated-test'
import { serviceStatusOptions, serviceStatusStorageKey } from '../../src/home/service-status-settings'

const checkedAt = '2026-10-15T02:00:00Z'
const result = { checkedAt, status: 'abnormal', providers: serviceStatusOptions.map(option => ({
  id: option.id, name: option.name, statusUrl: option.url, checkedAt,
  status: option.id === 'tencent' ? 'abnormal' : 'normal', statusBasis: option.id === 'xai' ? 'official-events' : 'official-components',
  description: '官方状态', incidents: [], affectedServices: [], error: null, subStatusError: null, subStatuses: [],
})) }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ json: result }))
})

test('默认仅 OpenAI 与 xAI，隐藏服务异常不影响汇总，设置入口不误开详情', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.locator('.service-status-row')).toHaveCount(2)
  await expect(card.locator('.ai-overall')).toHaveText('正常')
  await expect(card).not.toContainText('腾讯云')
  await page.getByRole('button', { name: '设置服务', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置服务', exact: true })
  await expect(settings).toBeVisible()
  await expect(page.getByRole('dialog', { name: '服务状态', exact: true })).toHaveCount(0)
  await expect(settings.getByRole('switch')).toHaveCount(9)
  await expect(settings.getByRole('switch', { name: 'OpenAI', exact: true })).toBeChecked()
  await expect(settings.getByRole('switch', { name: 'xAI', exact: true })).toBeChecked()
  await expect(settings.getByRole('switch', { name: 'Tailscale', exact: true })).not.toBeChecked()
  await settings.getByRole('button', { name: '关闭详情' }).click()
  await card.click()
  const detail = page.getByRole('dialog', { name: '服务状态', exact: true })
  await expect(detail.locator('.service-provider-card')).toHaveCount(2)
  await expect(detail).not.toContainText('腾讯云')
})

test('勾选同时控制一级与二级、仅汇总可见服务，并在刷新后保留', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '设置服务', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置服务', exact: true })
  await settings.getByRole('switch', { name: '腾讯云', exact: true }).check()
  await settings.getByRole('switch', { name: 'OpenAI', exact: true }).uncheck()
  await settings.getByRole('button', { name: '关闭详情' }).click()
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card.locator('.service-status-row')).toHaveCount(2)
  await expect(card).not.toContainText('OpenAI')
  await expect(card).toContainText('腾讯云')
  await expect(card.locator('.ai-overall')).toHaveText('存在异常')
  await card.click()
  const detail = page.getByRole('dialog', { name: '服务状态', exact: true })
  await expect(detail.locator('.service-provider-card')).toHaveCount(2)
  await expect(detail).not.toContainText('OpenAI')
  await expect(detail).toContainText('腾讯云')
  await page.reload()
  await expect(card).toContainText('腾讯云')
  await expect(card).not.toContainText('OpenAI')
})

test('全部取消显示可恢复空态、刷新不回到默认且不再请求状态', async ({ page }) => {
  let requests = 0
  await page.route('**/api/ai-status', route => { requests++; return route.fulfill({ json: result }) })
  await page.goto('/')
  await expect(page.locator('.service-status-row')).toHaveCount(2)
  await page.getByRole('button', { name: '设置服务', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置服务', exact: true })
  await settings.getByRole('switch', { name: 'OpenAI', exact: true }).uncheck()
  await settings.getByRole('switch', { name: 'xAI', exact: true }).uncheck()
  await settings.getByRole('button', { name: '关闭详情' }).click()
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).toContainText('尚未选择服务')
  const beforeReload = requests
  await page.reload()
  await expect(card).toContainText('尚未选择服务')
  expect(requests).toBe(beforeReload)
  await page.getByRole('button', { name: '设置服务', exact: true }).click()
  await settings.getByRole('switch', { name: 'Tailscale', exact: true }).check()
  await settings.getByRole('button', { name: '关闭详情' }).click()
  await expect(card.locator('.service-status-row')).toHaveCount(1)
  await expect(card).toContainText('Tailscale')
})

test('存储失败明确提示、本页仍生效，刷新回到未保存前的选择', async ({ page, context }) => {
  await context.addInitScript(key => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('blocked', 'QuotaExceededError'); return original.call(this, name, value) }
  }, serviceStatusStorageKey)
  await page.goto('/')
  await page.getByRole('button', { name: '设置服务', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置服务', exact: true })
  await settings.getByRole('switch', { name: 'Tailscale', exact: true }).check()
  await expect(settings.getByRole('alert')).toContainText('未保存')
  await settings.getByRole('button', { name: '关闭详情' }).click()
  const card = page.getByRole('button', { name: '查看服务状态详情' })
  await expect(card).toContainText('Tailscale')
  await page.reload()
  await expect(card.locator('.service-status-row')).toHaveCount(2)
  await expect(card).not.toContainText('Tailscale')
})

test('请求失败时二级官方链接也只展示已选择服务', async ({ page }) => {
  await page.route('**/api/ai-status', route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '暂不可用' } } }))
  await page.goto('/')
  await page.getByRole('button', { name: '查看服务状态详情' }).click()
  const detail = page.getByRole('dialog', { name: '服务状态', exact: true })
  await expect(detail.getByRole('link', { name: 'OpenAI 官方状态页' })).toBeVisible()
  await expect(detail.getByRole('link', { name: 'xAI 官方状态页' })).toBeVisible()
  await expect(detail.getByRole('link', { name: 'Tailscale 官方状态页' })).toHaveCount(0)
})

test('手机设置可键盘切换，关闭后焦点返回设置按钮，无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const button = page.getByRole('button', { name: '设置服务', exact: true })
  await button.click()
  const settings = page.getByRole('dialog', { name: '设置服务', exact: true })
  await settings.getByRole('switch', { name: 'Tailscale', exact: true }).press('Space')
  await expect(settings.getByRole('switch', { name: 'Tailscale', exact: true })).toBeChecked()
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(page.getByRole('button', { name: '查看服务状态详情' })).toContainText('Tailscale')
})
