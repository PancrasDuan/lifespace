import { test as base, expect } from '@playwright/test'

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2026-10-11',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-11',
}
export const test = base.extend({
  context: async ({ context }, use) => {
    // 未被业务测试明确覆盖的请求保持模拟不可用，不穿透到无配置的本地 Worker。
    await context.route(/\/api\/(?!auth\/)/, (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: '测试中未配置此数据源',
          },
        },
      }),
    )
    await context.addInitScript(
      ({ user }) => {
        const owner = localStorage.getItem('test-auth-owner') ?? user.id
        localStorage.setItem(
          'sb-auth-test-auth-token',
          JSON.stringify({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            token_type: 'bearer',
            expires_at: 4102444800,
            user: { ...user, id: owner },
          }),
        )
      },
      { user },
    )
    await context.route('**/api/auth/config', (route) =>
      route.fulfill({
        json: {
          url: 'https://auth-test.supabase.co',
          publishableKey: 'sb_publishable_test-only',
        },
      }),
    )
    await context.route('**/api/auth/me', (route) =>
      route.fulfill({ json: { user: { id: user.id, email: user.email } } }),
    )
    await context.route('https://auth-test.supabase.co/**', (route) =>
      route.fulfill({
        status: 400,
        json: { error_code: 'invalid_credentials', msg: 'Test auth response' },
      }),
    )
    await use(context)
  },
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (...args: Parameters<typeof page.goto>) => {
      const response = await goto(...args)
      await expect(
        page.locator('.home-page, .news-page, .adventure-page'),
      ).toBeVisible()
      return response
    }
    const reload = page.reload.bind(page)
    page.reload = async (...args: Parameters<typeof page.reload>) => {
      const response = await reload(...args)
      await expect(
        page.locator('.home-page, .news-page, .adventure-page'),
      ).toBeVisible()
      return response
    }
    await use(page)
  },
})
export { expect }
export type { Page } from '@playwright/test'
