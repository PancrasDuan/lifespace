import { test, expect } from '@playwright/test'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-10-11', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' }

test('远端退出成功但本地清理失败时，重试只完成清理，不重复撤销旧会话', async ({ page }) => {
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user }))
    const remove = Storage.prototype.removeItem
    let failOnce = true
    Storage.prototype.removeItem = function(key) {
      if (key === 'sb-auth-test-auth-token' && failOnce) { failOnce = false; throw new DOMException('Storage unavailable', 'SecurityError') }
      return remove.call(this, key)
    }
  }, { user })
  await page.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '模拟' } } }))
  await page.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  let remoteLogouts = 0
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => {
    remoteLogouts++
    return remoteLogouts === 1 ? route.fulfill({ status: 204 }) : route.fulfill({ status: 401, json: { error_code: 'session_not_found', msg: 'Revoked session' } })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('服务端已退出，但浏览器清理失败，请重试')
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(remoteLogouts).toBe(1)
})

test('旧退出响应晚到时不能清理另一标签刚登录的新会话', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addInitScript(({ user }) => {
    if (!localStorage.getItem('sb-auth-test-auth-token')) localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'old-session', refresh_token: 'old-refresh', expires_at: 4102444800, token_type: 'bearer', user }))
  }, { user })
  await context.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
  await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await context.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '模拟' } } }))
  await context.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  let release: () => void = () => {}, held = false, calls = 0, settled = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await context.route('https://auth-test.supabase.co/auth/v1/logout**', async route => {
    calls++
    if (calls === 1) { held = true; await pending; await route.fulfill({ status: 204 }); settled = true }
    else await route.fulfill({ status: 204 })
  })
  await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: { access_token: 'new-session', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer', user } }))
  const first = await context.newPage(), second = await context.newPage()
  let oldCleanupFinished = false
  first.on('console', message => { if (message.text().includes('"event":"auth_logout_failed"') && message.text().includes('"phase":"changed"')) oldCleanupFinished = true })
  try {
    for (const page of [first, second]) { await page.goto('/'); await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible() }
    await first.getByRole('button', { name: '账户菜单' }).click()
    await first.getByRole('menuitem', { name: '退出登录' }).click()
    await expect.poll(() => held).toBe(true)
    await second.getByRole('button', { name: '账户菜单' }).click()
    await second.getByRole('menuitem', { name: '退出登录' }).click()
    await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    await second.getByLabel('邮箱', { exact: true }).fill(user.email)
    await second.getByLabel('密码', { exact: true }).fill('test-password')
    await second.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
    await expect(second.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    release()
    await expect.poll(() => settled).toBe(true)
    await expect.poll(() => oldCleanupFinished).toBe(true)
    // Verify after the old operation has reported the session change.
    await expect.poll(() => first.evaluate(() => JSON.parse(localStorage.getItem('sb-auth-test-auth-token') ?? '{}').access_token)).toBe('new-session')
    await second.reload()
    await expect(second.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    expect(calls).toBe(2)
  } finally { release(); await context.close() }
})
