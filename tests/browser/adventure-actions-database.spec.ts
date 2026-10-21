import { test, expect } from './authenticated-test'
import app from '../../worker/index'
import { planningPageSchema } from '../../src/shared/adventure-planning'

const rpcOrigin = process.env.ADVENTURE_LOCAL_RPC_URL
const owner = '00000000-0000-4000-8000-000000000001'
const env = {
  SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'actions@example.invalid',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`
const nativeFetch = globalThis.fetch
const snapshot = async () => {
  const response = await app.request('/api/adventure', { headers: { Authorization: `Bearer ${token}` } }, env)
  expect(response.status).toBe(200)
  return planningPageSchema.parse(await response.json())
}

test.describe('真实任务事务的桌面与手机浏览器验收（受控身份）', () => {
  test.skip(!rpcOrigin, '仅在显式启动的隔离本机 PostgreSQL／PostgREST 中运行')
  test.beforeEach(async ({ context }) => {
    const target = new URL(rpcOrigin!)
    if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('只允许本机隔离 RPC')
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== env.SUPABASE_URL) return nativeFetch(input, init)
      if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email: 'actions@example.invalid', email_confirmed_at: '2026-10-21', is_anonymous: false })
      if (!url.pathname.startsWith('/rest/v1/rpc/adventure_')) throw new Error('禁止非 RPC 请求')
      return nativeFetch(new URL(url.pathname.replace('/rest/v1', ''), target), init)
    }
    await context.route('**/api/adventure**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const response = await app.request(url.pathname + url.search, {
        method: request.method(), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: request.method() === 'GET' ? undefined : request.postData() ?? undefined,
      }, env)
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => { globalThis.fetch = nativeFetch })

  for (const width of [1440, 390]) test(`${width}px 创建${width === 1440 ? '目标任务' : '独立任务'}、编辑、完成、取消、重做与刷新`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const title = `隔离行动 ${width}`
    await page.goto('/adventure')
    const before = await snapshot()
    if (width === 1440) {
      await page.getByRole('button', { name: '新建', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: /阶段成果/ }).click()
      await page.getByLabel('目标名称').fill('隔离结果')
      await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('完成独立完整行动')
      await page.getByRole('button', { name: '创建目标', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await page.getByRole('button', { name: '目标：隔离结果' }).click()
      await page.getByRole('button', { name: '添加任务', exact: true }).click()
    } else {
      await page.getByRole('button', { name: '新建', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: /一次性任务/ }).click()
      await page.getByLabel('任务归属', { exact: true }).selectOption('independent')
    }
    await page.getByLabel('任务名称', { exact: true }).fill(title)
    await page.getByLabel('任务说明', { exact: true }).fill('原始说明')
    await page.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const card = page.getByRole('article', { name: `任务：${title}` })
    await card.getByRole('button', { name: '编辑任务', exact: true }).click()
    await page.getByLabel('任务说明', { exact: true }).fill('新说明，随后完成')
    await page.getByRole('button', { name: '保存任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(card).toContainText('新说明，随后完成')
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
    const completed = await snapshot()
    expect(completed.growth.totalXp).toBe(before.growth.totalXp + 1)
    const completionA = completed.tasks.find(task => task.title === title)!.completionId
    await card.getByRole('button', { name: '取消完成', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '取消任务完成' })
    await expect(dialog).toContainText(`${before.growth.totalXp} 点经验`)
    expect((await snapshot()).version).toBe(completed.version)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure55-native-${width}.png` })
    await dialog.getByRole('button', { name: '确认取消完成', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    expect((await snapshot()).growth.totalXp).toBe(before.growth.totalXp)
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
    await page.reload()
    await expect(card).toContainText('已完成')
    const result = await snapshot()
    expect(result.tasks.find(task => task.title === title)!.completionId).not.toBe(completionA)
    expect(result.growth.totalXp).toBe(before.growth.totalXp + 1)
  })
})
