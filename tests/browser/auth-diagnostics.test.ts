import { expect, test, type Page } from '@playwright/test'

const config = { url: 'https://auth-test.supabase.co', publishableKey: 'sb_publishable_test-only' }
const unavailable = '认证服务暂时不可用，请稍后重试。'

async function showDiagnostic(page: Page, text: string) {
  const panel = page.locator('.auth-diagnostics')
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveAttribute('open', '')
  await page.getByText('查看诊断信息', { exact: true }).click()
  await expect(panel.locator('code')).toHaveText(text)
  await expect(panel).not.toContainText('private')
}

for (const boundary of ['initialize', 'session'] as const) {
  test(`启动 ${boundary} 的异常或 SDK 错误保留来源`, async ({ page }) => {
    await page.route('**/api/auth/config', route => route.fulfill({ json: config }))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    await page.evaluate(async ({ boundary }) => {
      const modulePath = '/src/auth/client.ts'
      const { authClient } = await import(/* @vite-ignore */ modulePath)
      const client = await authClient()
      if (boundary === 'initialize') client.auth.initialize = async () => { throw new TypeError('private startup') }
      else client.auth.getSession = async () => ({ data: { session: null }, error: { __isAuthError: true, name: 'AuthRetryableFetchError', status: 503, message: 'private startup' } })
      window.dispatchEvent(new Event('focus'))
    }, { boundary })
    await expect(page.getByText(unavailable, { exact: true })).toBeVisible()
    await showDiagnostic(page, `LSAUTH/1 stage=${boundary} kind=${boundary === 'initialize' ? 'TypeError status=none' : 'AuthRetryableFetchError status=503'} code=unknown`)
  })
}

test('配置 HTTP 失败保留原提示与重试，并显示脱敏诊断', async ({ page }) => {
  let fail = true
  await page.route('**/api/auth/config', route => route.fulfill(fail ? { status: 503, json: { message: 'private-body' } } : { json: config }))
  await page.goto('/')
  await expect(page.getByText(unavailable, { exact: true })).toBeVisible()
  await showDiagnostic(page, 'LSAUTH/1 stage=config-response kind=Error status=503 code=unknown')
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  fail = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(page.locator('.auth-diagnostics')).toHaveCount(0)
})

for (const malformed of ['json', 'schema']) {
  test(`区分公开配置 ${malformed} 解析失败`, async ({ page }) => {
    await page.route('**/api/auth/config', route => route.fulfill(malformed === 'json'
      ? { body: 'private-invalid-json', contentType: 'application/json' }
      : { json: { url: 'private-url', publishableKey: 'private-key' } }))
    await page.goto('/')
    await expect(page.getByText(unavailable, { exact: true })).toBeVisible()
    await showDiagnostic(page, `LSAUTH/1 stage=config-parse kind=${malformed === 'json' ? 'SyntaxError status=200' : 'ZodError status=none'} code=unknown`)
  })
}

test('配置请求超时保留错误类别', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (input, init) => String(input) === '/api/auth/config'
      ? Promise.reject(new DOMException('private timeout', 'TimeoutError')) : original(input, init)
  })
  await page.goto('/')
  await expect(page.getByText(unavailable, { exact: true })).toBeVisible()
  await showDiagnostic(page, 'LSAUTH/1 stage=config-fetch kind=TimeoutError status=none code=unknown')
})

test('准入检查故障仍拒绝业务访问，并显示 HTTP 状态', async ({ page }) => {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com' }
  await page.addInitScript(({ user }) => localStorage.setItem('sb-auth-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, token_type: 'bearer', user })), { user })
  await page.route('**/api/auth/config', route => route.fulfill({ json: config }))
  await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { error: 'private' } }))
  let businessRequests = 0
  await page.route(/\/api\/(?!auth\/)/, route => { businessRequests++; return route.fulfill({ status: 503, json: {} }) })
  await page.goto('/')
  await expect(page.getByText(unavailable, { exact: true })).toBeVisible()
  await showDiagnostic(page, 'LSAUTH/1 stage=identity-response kind=unknown status=503 code=unknown')
  expect(businessRequests).toBe(0)
})

for (const view of ['login', 'forgot'] as const) {
  for (const failure of ['sdk-result', 'throw', 'transport'] as const) {
    test(`${view} ${failure} 诊断覆盖真实 SDK 调用边界且不改变原提示`, async ({ page }) => {
      await page.route('**/api/auth/config', route => route.fulfill({ json: config }))
      let requests = 0
      await page.route('https://auth-test.supabase.co/**', route => {
        requests++
        return failure === 'transport' ? route.abort('failed') : route.fulfill({ status: 422, headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'X-Supabase-Api-Version' }, json: { code: 'unexpected_failure', msg: 'private-error' } })
      })
      await page.goto('/')
      await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
      if (view === 'forgot') await page.getByRole('button', { name: '忘记密码？' }).click()
      if (failure === 'throw') {
        await page.evaluate(async ({ view }) => {
          const modulePath = '/src/auth/client.ts'
          const { authClient } = await import(/* @vite-ignore */ modulePath)
          const client = await authClient()
          client.auth[view === 'login' ? 'signInWithPassword' : 'resetPasswordForEmail'] = async () => { throw new DOMException('private exception', 'SecurityError') }
        }, { view })
      }
      await page.getByLabel('邮箱', { exact: true }).fill('private@example.com')
      if (view === 'login') await page.getByLabel('密码', { exact: true }).fill('private-password')
      await page.getByRole('button', { name: view === 'login' ? '登录 LifeSpace' : '发送重置邮件', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText(failure === 'throw' ? '连接失败，请检查网络后重试' : view === 'login' ? '登录暂时失败，请稍后重试' : '邮件暂时无法发送，请稍后重试')
      const fields = failure === 'throw' ? 'kind=SecurityError status=none code=unknown' : failure === 'transport' ? 'kind=AuthRetryableFetchError status=none code=unknown' : 'kind=AuthApiError status=422 code=unexpected_failure'
      await showDiagnostic(page, `LSAUTH/1 stage=${view === 'login' ? 'password-sign-in' : 'password-recovery'} ${fields}`)
      expect(requests).toBe(failure === 'throw' ? 0 : 1)
      await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('private@example.com')
      if (view === 'login') await expect(page.getByLabel('密码', { exact: true })).toHaveValue('private-password')
      await page.getByRole('button', { name: view === 'login' ? '忘记密码？' : '返回登录', exact: true }).click()
      await expect(page.locator('.auth-diagnostics')).toHaveCount(0)
    })
  }
}
