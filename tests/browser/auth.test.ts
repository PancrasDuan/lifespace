import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
  await page.route('https://auth-test.supabase.co/**', route => route.fulfill({ status: 400, json: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }))
})

test('未登录仅显示 B 登录页面，密码切换图标与内容同步', async ({ page }) => {
  let businessRequests = 0
  await page.route(/\/api\/(?!auth\/)/, route => { businessRequests++; return route.fulfill({ status: 503, json: {} }) })
  await page.goto('/news')
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '邮箱', exact: true })).toBeVisible()
  const password = page.getByLabel('密码', { exact: true })
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: '隐藏密码', exact: true })).toBeVisible()
  await expect(page.getByText('资讯来源')).toHaveCount(0)
  expect(businessRequests).toBe(0)
})

test('登录失败保留邮箱与密码，显示可重试的错误', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill('demo@example.com')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('邮箱或密码不正确，请重试')
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('demo@example.com')
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('wrong-password')
})

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-10-11', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' }
const session = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const pkceSession = { ...session, access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 })}.test-signature` }
test('成功登录后进入真实首页，并携带 Token 请求业务接口', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let authorization = ''
  await page.route(/\/api\/(?!auth\/)/, route => {
    authorization = route.request().headers().authorization
    return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '数据源暂时不可用' } } })
  })
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect.poll(() => authorization).toBe('Bearer test-access-token')
})

test('注册发出 SDK 请求后提示邮箱验证，待验证账户不能进入首页', async ({ page }) => {
  let registeredEmail = ''
  await page.route('https://auth-test.supabase.co/auth/v1/signup**', async route => {
    registeredEmail = route.request().postDataJSON().email
    await route.fulfill({ json: { user, session: null } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByLabel('确认密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await expect(page.getByRole('heading', { name: '请验证你的邮箱' })).toBeVisible()
  expect(registeredEmail).toBe(user.email)
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('头像退出仅撤销当前浏览器，成功后移除首页数据', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let scope = ''
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => {
    scope = new URL(route.request().url()).searchParams.get('scope') ?? ''
    return route.fulfill({ status: 204 })
  })
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '暂不可用' } } }))
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await page.getByRole('button', { name: '账户菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(scope).toBe('local')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('忘记密码通过 SDK 发送重置邮件并显示统一提示', async ({ page }) => {
  let recoveryEmail = ''
  await page.route('https://auth-test.supabase.co/auth/v1/recover**', route => {
    recoveryEmail = route.request().postDataJSON().email
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '忘记密码？', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByRole('heading', { name: '请查看你的邮箱' })).toBeVisible()
  expect(recoveryEmail).toBe(user.email)
})

test('恢复回跳修改密码并撤销所有旧会话，成功后要求重新登录', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier/recovery')))
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ json: pkceSession }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let newPassword = ''; let logoutScope = ''
  await page.route('https://auth-test.supabase.co/auth/v1/user', route => {
    newPassword = route.request().postDataJSON().password
    return route.fulfill({ json: user })
  })
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => {
    logoutScope = new URL(route.request().url()).searchParams.get('scope') ?? ''
    return route.fulfill({ status: 204 })
  })
  await page.goto('/auth/reset?code=test-recovery-code')
  await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible()
  await page.getByLabel('新密码', { exact: true }).fill('changed-password')
  await page.getByLabel('确认密码', { exact: true }).fill('changed-password')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByRole('heading', { name: '密码已更新' })).toBeVisible()
  expect(newPassword).toBe('changed-password'); expect(logoutScope).toBe('global')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('明确过期的业务读取由 SDK 续期后重试一次', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let refreshes = 0; let renewedRequests = 0
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=refresh_token', route => {
    refreshes++
    return route.fulfill({ json: { ...session, access_token: 'renewed-access-token', refresh_token: 'renewed-refresh-token' } })
  })
  await page.route(/\/api\/(?!auth\/)/, route => {
    const expired = route.request().url().includes('/api/tasks/') && route.request().headers().authorization === 'Bearer test-access-token'
    if (route.request().headers().authorization === 'Bearer renewed-access-token') renewedRequests++
    return route.fulfill({ status: expired ? 401 : 503, json: { error: { code: expired ? 'AUTH_EXPIRED' : 'SOURCE_UNAVAILABLE', message: '稍后重试' } } })
  })
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect.poll(() => renewedRequests).toBeGreaterThan(0)
  expect(refreshes).toBe(1)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toHaveCount(0)
})

test('密码已更新但撤销失败时只重试撤销，不重复修改密码', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier/recovery')))
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ json: pkceSession }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let updates = 0; let logouts = 0
  await page.route('https://auth-test.supabase.co/auth/v1/user', route => { updates++; return route.fulfill({ json: user }) })
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => {
    logouts++
    return logouts === 1 ? route.fulfill({ status: 503, json: { msg: 'Unavailable' } }) : route.fulfill({ status: 204 })
  })
  await page.goto('/auth/reset?code=test-recovery-code')
  await page.getByLabel('新密码', { exact: true }).fill('changed-password')
  await page.getByLabel('确认密码', { exact: true }).fill('changed-password')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByRole('alert')).toContainText('全部旧会话撤销尚未确认')
  await page.getByRole('button', { name: '重试撤销旧会话' }).click()
  await expect(page.getByRole('heading', { name: '密码已更新' })).toBeVisible()
  expect(updates).toBe(1); expect(logouts).toBe(2)
})

test('白名单撤销后清理业务页面并保留账户退出入口', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 403, json: { error: { code: 'AUTH_DENIED', message: '未获准访问' } } }))
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂时无法进入' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
  await page.getByRole('button', { name: '账户菜单' }).click()
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeEnabled()
})

test('等待验证页可重发验证邮件，成功后暂时禁用重发', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/signup**', route => route.fulfill({ json: { user, session: null } }))
  let resends = 0
  await page.route('https://auth-test.supabase.co/auth/v1/resend**', route => { resends++; return route.fulfill({ json: {} }) })
  await page.goto('/')
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByLabel('确认密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await page.getByRole('button', { name: '重新发送验证邮件' }).click()
  await expect(page.getByRole('button', { name: /秒后可重新发送/ })).toBeDisabled()
  expect(resends).toBe(1)
})

test('失效的验证回跳显示重新操作入口', async ({ page }) => {
  await page.goto('/auth/callback?error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('heading', { name: '验证链接不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('另一浏览器缺少校验凭据时提示手动登录，密码登录后正常进入首页', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.goto('/auth/callback?code=test-verification-code')
  await expect(page.getByRole('heading', { name: '请登录继续访问' })).toBeVisible()
  await expect(page.getByText('当前浏览器缺少自动登录所需的校验凭据。邮箱可能已验证，请使用邮箱和密码登录。')).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
  await page.getByRole('button', { name: '使用邮箱密码登录' }).click()
  await expect(page).toHaveURL('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
})

test('原浏览器交换已失效的验证代码仍显示错误提示', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier')))
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ status: 400, json: { code: 'flow_state_expired', msg: 'Expired auth code' } }))
  await page.goto('/auth/callback?code=test-expired-code')
  await expect(page.getByRole('heading', { name: '验证链接不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
})

test('刷新时显示首页骨架屏，准入完成前不请求或展示业务数据', async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  let release: () => void = () => {}
  let pending = Promise.resolve()
  await page.route('**/api/auth/me', async route => { await pending; await route.fulfill({ json: { user: { id: user.id, email: user.email } } }) })
  let businessRequests = 0
  await page.route(/\/api\/(?!auth\/)/, route => { businessRequests++; return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  const readyRequests = businessRequests
  pending = new Promise<void>(resolve => { release = resolve })
  await page.reload()
  try {
    await expect(page.getByRole('status', { name: '正在确认访问资格' })).toBeVisible()
    await expect(page.locator('.auth-card')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看今日待办详情' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '新闻', exact: true })).toHaveCount(0)
    expect(businessRequests).toBe(readyRequests)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 954 })
      const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport)
    }
  } finally { release() }
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect(page.getByRole('status', { name: '正在确认访问资格' })).toHaveCount(0)
})

test('已有有效会话的回跳先验证准入，通过后清理地址进入首页', async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  let identityChecks = 0
  await page.route('**/api/auth/me', route => { identityChecks++; return route.fulfill({ json: { user: { id: user.id, email: user.email } } }) })
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.goto('/auth/callback?code=test-unexchanged-code')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect(page).toHaveURL('/')
  expect(identityChecks).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: '请登录继续访问' })).toHaveCount(0)
})

for (const { status, heading } of [
  { status: 401, heading: '请登录继续访问' },
  { status: 403, heading: '暂时无法进入' },
  { status: 503, heading: '暂时无法连接' },
]) {
  test(`回跳已有本地会话但 Worker 返回 ${status} 时不能进入首页`, async ({ page }) => {
    await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
    await page.route('**/api/auth/me', route => route.fulfill({ status, json: {} }))
    let businessRequests = 0
    await page.route(/\/api\/(?!auth\/)/, route => { businessRequests++; return route.fulfill({ status: 503, json: {} }) })
    await page.goto('/auth/callback?code=test-unexchanged-code')
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看世界时间详情' })).toHaveCount(0)
    expect(businessRequests).toBe(0)
  })
}

test('已有会话通过准入时不被 URL 的回跳错误阻挡', async ({ page }) => {
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.goto('/auth/callback?error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('验证邮件 PKCE 回跳通过准入后进入首页并清理回跳地址', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier')))
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ json: pkceSession }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.goto('/auth/callback?code=test-verification-code')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('B 登录和注册页面在电脑与手机均无横向溢出', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 954 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    for (const view of ['登录', '注册']) {
      await page.getByRole('button', { name: view, exact: true }).click()
      const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport)
    }
  }
})

test('退出远端失败不清理 SDK 会话，允许当前浏览器重试', async ({ page }) => {
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => route.fulfill({ json: session }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => route.fulfill({ status: 401, json: { error_code: 'bad_jwt', msg: 'Unavailable' } }))
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('退出请求未获确认，请重试')
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeEnabled()
})

test('两个浏览器可同时登录，退出一个不影响另一个', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const active = new Set<string>()
  try {
    const pages = []
    for (const [index, context] of contexts.entries()) {
      const accessToken = `test-browser-${index}`
      await context.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
      await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => { active.add(accessToken); return route.fulfill({ json: { ...session, access_token: accessToken } }) })
      await context.route('**/api/auth/me', route => route.fulfill(active.has(accessToken) ? { json: { user: { id: user.id, email: user.email } } } : { status: 401, json: { error: { code: 'AUTH_INVALID', message: '登录失效' } } }))
      await context.route('https://auth-test.supabase.co/auth/v1/logout**', route => { expect(new URL(route.request().url()).searchParams.get('scope')).toBe('local'); active.delete(accessToken); return route.fulfill({ status: 204 }) })
      await context.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
      const page = await context.newPage(); pages.push(page)
      await page.goto('/')
      await page.getByLabel('邮箱', { exact: true }).fill(user.email)
      await page.getByLabel('密码', { exact: true }).fill('test-password')
      await page.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
      await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    }
    await pages[0].getByRole('button', { name: '账户菜单' }).click()
    await pages[0].getByRole('menuitem', { name: '退出登录' }).click()
    await expect(pages[0].getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    await pages[1].reload()
    await expect(pages[1].getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
  } finally { await Promise.all(contexts.map(context => context.close())) }
})

test('恢复资格绑定会话，刷新重置页面仍可设置密码并打开退出菜单', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('sb-auth-test-auth-token')) localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier/recovery'))
  })
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ json: pkceSession }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.goto('/auth/reset?code=test-recovery-code')
  await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible()
  await page.getByRole('button', { name: '账户菜单' }).click()
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeEnabled()
  await expect(page.getByRole('menu', { name: '账户' })).toContainText(user.email)
})

test('恢复标记存储失败不重复更新已成功的密码', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-auth-test-auth-token-code-verifier', JSON.stringify('test-pkce-verifier/recovery')))
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=pkce', route => route.fulfill({ json: pkceSession }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  let updates = 0; let logouts = 0
  await page.route('https://auth-test.supabase.co/auth/v1/user', route => { updates++; return route.fulfill({ json: user }) })
  await page.route('https://auth-test.supabase.co/auth/v1/logout**', route => { logouts++; return logouts === 1 ? route.fulfill({ status: 503, json: { msg: 'Unavailable' } }) : route.fulfill({ status: 204 }) })
  await page.goto('/auth/reset?code=test-recovery-code')
  await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible()
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'lifespace.auth.resetPending') throw new DOMException('denied', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  })
  await page.getByLabel('新密码', { exact: true }).fill('changed-password')
  await page.getByLabel('确认密码', { exact: true }).fill('changed-password')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByRole('alert')).toContainText('全部旧会话撤销尚未确认')
  await page.getByRole('button', { name: '重试撤销旧会话' }).click()
  await expect(page.getByRole('heading', { name: '密码已更新' })).toBeVisible()
  expect(updates).toBe(1)
})

test('到期续期遇临时断网显示不可用，恢复后仍使用原会话续期', async ({ page }) => {
  const time = new Date('2026-10-11T00:00:00Z')
  await page.clock.install({ time })
  await page.addInitScript(({ session, expiry }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ ...session, expires_at: expiry })), { session, expiry: time.getTime() / 1000 - 1 })
  let offline = true; let refreshes = 0
  await page.route('https://auth-test.supabase.co/auth/v1/token?grant_type=refresh_token', route => {
    refreshes++
    return offline ? route.fulfill({ status: 503, json: { msg: 'Unavailable' } }) : route.fulfill({ json: { ...session, access_token: 'recovered-access-token' } })
  })
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: user.id, email: user.email } } }))
  await page.route(/\/api\/(?!auth\/)/, route => route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: '稍后重试' } } }))
  await page.goto('/')
  await expect.poll(() => refreshes).toBeGreaterThan(0)
  await page.clock.fastForward(32000)
  await expect(page.getByRole('heading', { name: '暂时无法连接' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('sb-auth-test-auth-token') !== null)).toBe(true)
  offline = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
})

test('另一标签重新登录后，迟到续期不能覆盖新会话或触发旧请求退出', async ({ browser }) => {
  const context = await browser.newContext()
  let passwordLogins = 0; let expireTasks = false; let refreshing = false
  let releaseRefresh: (() => void) | undefined
  const held = new Promise<void>(resolve => { releaseRefresh = resolve })
  const active = new Set<string>()
  try {
    await context.route('**/api/auth/config', route => route.fulfill({ json: { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' } }))
    await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=password', route => {
      const token = passwordLogins++ ? 'new-browser-session' : session.access_token
      active.add(token); return route.fulfill({ json: { ...session, access_token: token, refresh_token: `${token}-refresh` } })
    })
    await context.route('https://auth-test.supabase.co/auth/v1/token?grant_type=refresh_token', async route => { refreshing = true; await held; await route.fulfill({ json: { ...session, access_token: 'late-access-token' } }) })
    await context.route('https://auth-test.supabase.co/auth/v1/logout**', route => { active.delete(session.access_token); return route.fulfill({ status: 204 }) })
    await context.route('**/api/auth/me', route => route.fulfill(active.has(route.request().headers().authorization?.replace('Bearer ', '') ?? '') ? { json: { user: { id: user.id, email: user.email } } } : { status: 401, json: { error: { code: 'AUTH_INVALID', message: '登录失效' } } }))
    await context.route(/\/api\/(?!auth\/)/, route => {
      const expired = expireTasks && route.request().url().includes('/api/tasks/') && route.request().headers().authorization === `Bearer ${session.access_token}`
      return route.fulfill({ status: expired ? 401 : 503, json: { error: { code: expired ? 'AUTH_EXPIRED' : 'SOURCE_UNAVAILABLE', message: '稍后重试' } } })
    })
    const first = await context.newPage(); const second = await context.newPage()
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
    await second.getByRole('button', { name: '登录 LifeSpace', exact: true }).click()
    await expect(second.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    releaseRefresh?.()
    await expect(first.getByRole('button', { name: '查看世界时间详情' })).toBeVisible()
    await expect.poll(() => first.evaluate(() => JSON.parse(localStorage.getItem('sb-auth-test-auth-token') ?? '{}').access_token)).toBe('new-browser-session')
  } finally { releaseRefresh?.(); await context.close() }
})
