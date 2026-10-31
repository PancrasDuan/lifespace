import { expect, test } from '@playwright/test'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-10-11', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' }
const session = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user }
const storageKey = 'sb-auth-test-auth-token'
declare global {
  interface Window { authStorageBarrier: { holding: boolean; reads: number } }
}

test('受控时序：新登录通知先读空，存储可见后仍在线重验且旧续期不覆盖新会话', async ({ browser }) => {
  const context = await browser.newContext()
  // Inject only first-tab storage visibility, not SDK events or auth methods.
  // This reproduces the observed read-empty interleaving; it does not assert
  // how native Chromium orders BroadcastChannel and storage propagation.
  await context.addInitScript(({ storageKey }) => {
    window.authStorageBarrier = { holding: false, reads: 0 }
    const getItem = Storage.prototype.getItem
    Storage.prototype.getItem = function(key) {
      const value = getItem.call(this, key)
      if (this === localStorage && key === storageKey && window.authStorageBarrier.holding) {
        window.authStorageBarrier.reads++
        return null
      }
      return value
    }
  }, { storageKey })
  let logins = 0, expireTasks = false, refreshing = false, admissionAllowed = true
  let releaseRefresh: () => void = () => {}
  const held = new Promise<void>(resolve => { releaseRefresh = resolve })
  const active = new Set<string>(), identityTokens: string[] = []
  try {
    await context.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
    await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => {
      const token = logins++ ? 'new-browser-session' : session.access_token
      active.add(token)
      return route.fulfill({ json: { ...session, access_token: token, refresh_token: `${token}-refresh` } })
    })
    await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=refresh_token', async route => {
      refreshing = true; await held
      await route.fulfill({ json: { ...session, access_token: 'late-access-token' } })
    })
    await context.route('https://auth-test.supabase.co/auth/v1/logout**', route => { active.delete(session.access_token); return route.fulfill({ status: 204 }) })
    await context.route('**/api/auth/me', route => {
      const token = route.request().headers().authorization?.replace('Bearer ', '') ?? ''
      identityTokens.push(token)
      return route.fulfill(!active.has(token)
        ? { status: 401, json: { error: { code: 'AUTH_INVALID', message: '登录失效' } } }
        : admissionAllowed ? { json: { user: { id: user.id, email: user.email } } }
          : { status: 403, json: { error: { code: 'AUTH_DENIED', message: '不再允许访问' } } })
    })
    await context.route(/\/api\/(?!auth\/)/, route => {
      const expired = expireTasks && route.request().url().includes('/api/tasks/') && route.request().headers().authorization === `Bearer ${session.access_token}`
      return route.fulfill({ status: expired ? 401 : 503, json: { error: { code: expired ? 'AUTH_EXPIRED' : 'SOURCE_UNAVAILABLE', message: '稍后重试' } } })
    })
    const first = await context.newPage(), second = await context.newPage()
    await first.goto('/')
    await first.getByLabel('邮箱', { exact: true }).fill(user.email)
    await first.getByLabel('密码', { exact: true }).fill('test-password')
    await first.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
    await expect(first.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    await second.goto('/')
    await expect(second.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    expireTasks = true
    await first.getByRole('button', { name: '刷新今日待办', exact: true }).click()
    await expect.poll(() => refreshing).toBe(true)
    await second.getByRole('button', { name: '账户菜单' }).click()
    await second.getByRole('menuitem', { name: '退出登录' }).click()
    await second.getByLabel('邮箱', { exact: true }).fill(user.email)
    await second.getByLabel('密码', { exact: true }).fill('test-password')
    await first.evaluate(() => { window.authStorageBarrier.holding = true })
    await second.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
    await expect(second.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    await expect.poll(() => first.evaluate(() => window.authStorageBarrier.reads)).toBeGreaterThan(0)
    await expect(first.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
    identityTokens.length = 0
    await first.evaluate(({ storageKey }) => {
      window.authStorageBarrier.holding = false
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey, oldValue: null, newValue: localStorage.getItem(storageKey), storageArea: localStorage }))
    }, { storageKey })
    releaseRefresh()
    await expect(first.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    expect(identityTokens).toContain('new-browser-session')
    await expect.poll(() => first.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) ?? '{}').access_token, storageKey)).toBe('new-browser-session')
    // A storage notification is not an identity grant. Even a forged payload
    // must cause an SDK read and online admission with the actual stored token.
    admissionAllowed = false
    identityTokens.length = 0
    await first.evaluate(({ storageKey }) => window.dispatchEvent(new StorageEvent('storage', {
      key: storageKey, newValue: '{"access_token":"untrusted-storage-event"}', storageArea: localStorage,
    })), { storageKey })
    await expect(first.getByRole('heading', { name: '暂时无法进入' })).toBeVisible()
    await expect(first.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
    expect(identityTokens).toContain('new-browser-session')
    expect(identityTokens).not.toContain('untrusted-storage-event')
  } finally { releaseRefresh(); await context.close() }
})
