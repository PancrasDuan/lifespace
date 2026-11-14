import { expect, test } from '@playwright/test'
import { mcpScopes } from '../../src/shared/mcp-oauth'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-10-11', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' }
const details = { clientName: 'Codex', clientDomain: 'client.example.invalid', redirectHost: '127.0.0.1', redirectIsLoopback: true, scope: [mcpScopes[0]] }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: 4102444800, user })), { user })
  await page.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route('**/api/oauth/consent/start', route => route.fulfill({ json: { handle: 'synthetic-consent-handle', details } }))
})

for (const width of [1440, 390]) {
  test(`${width}px 同意页逐项权限、键盘焦点、校验与明确提交`, async ({ page }) => {
    await page.setViewportSize({ width, height: 980 })
    let submitted: { decision: string; scopes: string[] } | undefined
    let submissions = 0
    await page.route('**/api/oauth/consent/finish', async route => {
      submitted = route.request().postDataJSON()
      submissions++
      await route.fulfill({ json: { redirectTo: 'https://client.example.invalid/callback?code=synthetic-code' } })
    })
    await page.route('https://client.example.invalid/callback**', route => route.fulfill({ body: '已返回合成客户端' }))
    await page.goto('/oauth/authorize?client_id=synthetic')
    await expect(page.getByRole('heading', { name: '授权访问账单' })).toBeVisible()
    await expect(page).toHaveTitle('客户端授权 · LifeSpace')
    const authorization = page.locator('.mcp-authorization')
    await expect(authorization).not.toContainText('Codex')
    await expect(authorization).not.toContainText('client.example.invalid')
    await expect(authorization).not.toContainText('127.0.0.1')
    await expect(authorization.locator('a')).toHaveCount(0)
    await expect(page.getByText('已选 1 项权限', { exact: true })).toBeVisible()
    const read = page.getByRole('checkbox', { name: '读取交易账户' })
    await expect(read).toBeChecked()
    await read.focus()
    await page.keyboard.press('Space')
    await expect(page.getByText('已选 0 项权限', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '授权所选权限' }).click()
    await expect(page.getByRole('alert')).toContainText('至少选择一项权限')
    await expect(page.getByRole('alert')).toBeFocused()
    expect(submissions).toBe(0)
    await page.getByRole('checkbox', { name: '新建收支流水' }).check()
    await page.screenshot({ path: `.cache/mcp-consent-${width}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '授权所选权限' }).dblclick()
    await expect(page).toHaveURL(/client\.example\.invalid\/callback/)
    expect(submitted).toMatchObject({ decision: 'approve', scopes: [mcpScopes[1]] })
    expect(submissions).toBe(1)
  })
}

test('拒绝可独立提交；客户端资料不出现在授权表单', async ({ page }) => {
  await page.route('**/api/oauth/consent/start', route => route.fulfill({ json: { handle: 'synthetic', details: { ...details, clientName: '<img src=x onerror=alert(1)>', clientDomain: undefined } } }))
  let decision = ''
  await page.route('**/api/oauth/consent/finish', route => { decision = route.request().postDataJSON().decision; return route.fulfill({ status: 400, json: { error: { message: '授权页面已失效，请从客户端重新连接' } } }) })
  await page.goto('/oauth/authorize')
  await expect(page.locator('.mcp-authorization')).not.toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('.mcp-authorization img')).toHaveCount(0)
  await page.getByRole('button', { name: '拒绝授权' }).click()
  await expect(page.getByRole('alert')).toContainText('授权页面已失效')
  await expect(page.getByRole('alert')).toBeFocused()
  expect(decision).toBe('deny')
})

test('授权管理展示独立连接，确认撤销并提供结果与在途边界', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const grant = { id: '00000000-0000-4000-8000-000000000002', clientId: 'https://client.example.invalid/metadata.json', clientName: 'Codex', scopes: mcpScopes, createdAt: '2026-11-14T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }
  const second = { ...grant, id: '00000000-0000-4000-8000-000000000003', clientName: '另一个 MCP 客户端' }
  await page.route('**/api/oauth/grants', route => route.fulfill({ json: { grants: [grant, second], nextCursor: null } }))
  let revoked = ''
  await page.route('**/api/oauth/grants/revoke', route => { revoked = route.request().postDataJSON().id; return route.fulfill({ json: { revoked: true } }) })
  await page.goto('/oauth/grants')
  await expect(page.getByRole('heading', { name: '已授权的客户端' })).toBeVisible()
  const revokeFirst = page.getByRole('button', { name: /^撤销 Codex / })
  await revokeFirst.click()
  await expect(page.getByText('此连接需要重新征得你的同意', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认撤销' })).toBeFocused()
  await page.getByRole('button', { name: '保留授权' }).click()
  await expect(revokeFirst).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '确认撤销' })).toBeFocused()
  await page.getByRole('button', { name: '确认撤销' }).click()
  await expect(page.getByRole('status')).toContainText('后续调用和续期将被拒绝')
  await expect(page.getByRole('status')).toBeFocused()
  expect(revoked).toBe(grant.id)
  await expect(revokeFirst).toHaveCount(0)
  const revokeSecond = page.getByRole('button', { name: /^撤销 另一个 MCP 客户端 / })
  await revokeSecond.click()
  await page.getByRole('button', { name: '保留授权' }).click()
  await expect(revokeSecond).toBeFocused()
  await page.screenshot({ path: '.cache/mcp-grants-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('授权管理空状态、加载失败和撤销失败均可恢复', async ({ page }) => {
  let failed = true
  await page.route('**/api/oauth/grants', route => route.fulfill(failed ? { status: 503, json: {} } : { json: { grants: [], nextCursor: null } }))
  await page.goto('/oauth/grants')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取授权')
  failed = false
  await page.getByRole('button', { name: '刷新授权' }).click()
  await expect(page.getByText('还没有授权客户端', { exact: false })).toBeVisible()
  await page.route('**/api/oauth/grants', route => route.fulfill({ json: { grants: [{ id: '00000000-0000-4000-8000-000000000002', clientId: 'client-test', clientName: 'Codex', scopes: [mcpScopes[0]], createdAt: '2026-11-14T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }], nextCursor: null } }))
  let revokeFails = true
  await page.route('**/api/oauth/grants/revoke', route => route.fulfill(revokeFails ? { status: 503, json: {} } : { json: { revoked: true } }))
  await page.reload()
  await page.getByRole('button', { name: /^撤销 / }).click()
  await page.getByRole('button', { name: '确认撤销' }).click()
  await expect(page.getByRole('alert')).toContainText('撤销结果未确认')
  await expect(page.getByRole('alert')).toBeFocused()
  revokeFails = false
  await page.getByRole('button', { name: '确认撤销' }).click()
  await expect(page.getByRole('status')).toBeFocused()
  await expect(page.getByRole('status')).toContainText('授权已撤销')
})

for (const decision of ['授权所选权限', '拒绝授权']) test(`手机异步${decision}失败后聚焦可见错误并允许重新操作`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/oauth/consent/finish', async route => {
    await new Promise(resolve => setTimeout(resolve, 100))
    await route.fulfill({ status: 400, json: { error: { message: '授权页面已失效，请从客户端重新连接' } } })
  })
  await page.goto('/oauth/authorize')
  await page.getByRole('button', { name: decision }).click()
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('alert')).toBeInViewport()
  await expect(page.getByRole('button', { name: decision })).toBeEnabled()
})
