import { test, expect } from './authenticated-test'
import { withMainline } from './adventure-fixture'

test('账户切换期间迟到的旧账户规划响应不能覆盖新账户或阻塞新版本', async ({ page, context }) => {
  const first = '00000000-0000-4000-8000-000000000001'
  const second = '00000000-0000-4000-8000-000000000063'
  let owner = first, hold = false, held = false, settled = false
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: owner, email: 'demo@example.com' } } }))
  await context.route('**/api/adventure**', async route => {
    const account = owner
    if (hold && account === first) { held = true; await pending }
    await route.fulfill({ json: { ...withMainline, version: account === first ? 100 : 1,
      mainlines: [{ ...withMainline.mainlines[0], name: account === first ? '旧账户私有主线' : '新账户主线' }] } }).catch(() => {})
    if (account === first && held) settled = true
  })
  await page.goto('/adventure?view=planning')
  await expect(page.getByRole('article', { name: '主线：旧账户私有主线', exact: true })).toBeVisible()
  hold = true
  await page.getByLabel('显示已达成／已结束', { exact: true }).check()
  await expect.poll(() => held).toBe(true)
  try {
    owner = second
    await page.evaluate(id => {
      const session = JSON.parse(localStorage.getItem('sb-auth-test-auth-token')!)
      session.user.id = id
      session.access_token = 'second-test-access-token'
      localStorage.setItem('sb-auth-test-auth-token', JSON.stringify(session))
      const channel = new BroadcastChannel('sb-auth-test-auth-token')
      channel.postMessage({ event: 'SIGNED_IN', session })
      channel.close()
    }, second)
    await expect(page.getByRole('article', { name: '主线：新账户主线', exact: true })).toBeVisible()
  } finally { release() }
  await expect.poll(() => settled).toBe(true)
  await expect(page.getByRole('article', { name: '主线：旧账户私有主线', exact: true })).toHaveCount(0)
  await expect(page.getByRole('article', { name: '主线：新账户主线', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled()
})
