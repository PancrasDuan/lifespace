import { test, expect } from '@playwright/test'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-10-11', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' }

test('启动时配置先于主应用下载，并发鉴权只发送一次，重新聚焦仍在线检查', async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  let startedConfig = false, identityChecks = 0, allowed = true
  let releaseApplication: () => void = () => {}
  const application = new Promise<void>(resolve => { releaseApplication = resolve })
  await page.route('**/src/main.tsx', async route => { await application; await route.continue() })
  await page.route('**/api/auth/config', route => { startedConfig = true; return route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }) })
  await page.route('**/api/auth/me', async route => { identityChecks++; await new Promise(resolve => setTimeout(resolve, 200)); await route.fulfill({ status: allowed ? 200 : 403, json: allowed ? { user: { id: user.id, email: user.email } } : {} }) })
  await page.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '模拟' } } }))
  await page.goto('/', { waitUntil: 'commit' })
  try { await expect.poll(() => startedConfig).toBe(true) } finally { releaseApplication() }
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  expect(identityChecks).toBe(1)
  allowed = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => identityChecks).toBe(2)
  await expect(page.getByRole('heading', { name: '暂时无法进入' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('退出取消进行中的准入检查，迟到成功响应不能重新显示首页', async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  await page.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
  await page.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => route.fulfill({ status: 204 }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '模拟' } } }))
  let hold = false, held = false, settled = false
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/auth/me', async route => {
    if (hold) { held = true; await pending }
    await route.fulfill({ json: { user: { id: user.id, email: user.email } } }).catch(() => {})
    if (hold) settled = true
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  hold = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => held).toBe(true)
  try {
    await page.getByRole('button', { name: '账户菜单' }).click()
    await page.getByRole('menuitem', { name: '退出登录' }).click()
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  } finally { release() }
  await expect.poll(() => settled).toBe(true)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})
