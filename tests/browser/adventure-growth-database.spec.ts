import { test, expect } from './authenticated-test'
import app from '../../worker/index'
import { growthPageSchema } from '../../src/shared/adventure-growth'
import { planningPageSchema } from '../../src/shared/adventure-planning'

const rpcOrigin = process.env.ADVENTURE_LOCAL_RPC_URL
let owner = '00000000-0000-4000-8000-000000000001'
const env = {
  SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'actions@example.invalid',
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const authToken = () => `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`
const nativeFetch = globalThis.fetch
const snapshot = async (query = '') => {
  const response = await app.request('/api/adventure' + query, { headers: { Authorization: `Bearer ${authToken()}` } }, env)
  expect(response.status).toBe(200)
  return planningPageSchema.parse(await response.json())
}

test.describe('真实成长记录的桌面与手机浏览器验收（受控身份）', () => {
  test.skip(!rpcOrigin, '仅在显式启动的隔离本机 PostgreSQL／PostgREST 中运行')
  test.beforeEach(async ({ context }) => {
    owner = crypto.randomUUID()
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
        method: request.method(), headers: { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' },
        body: request.method() === 'GET' ? undefined : request.postData() ?? undefined,
      }, env)
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
  })
  test.afterEach(() => { globalThis.fetch = nativeFetch })

  const write = async (command: unknown) => {
    const response = await app.request('/api/adventure/commands', { method: 'POST', headers: { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: (await snapshot()).version, requestId: crypto.randomUUID(), command }) }, env)
    expect(response.status).toBe(200)
    return await response.json() as { result: { entityId: string; completionId: string; achievementId: string } }
  }
  const complete = async (title: string, destination = '') => {
    const task = await write({ type: 'createTask', title, destination, description: '冻结行动说明', plannedOn: (await snapshot()).today })
    return write({ type: 'completeTask', id: task.result.entityId })
  }
  const growth = async () => {
    const response = await app.request('/api/adventure/growth', { headers: { Authorization: `Bearer ${authToken()}` } }, env)
    expect(response.status).toBe(200)
    return growthPageSchema.parse(await response.json())
  }

  for (const width of [1440, 390]) test(`${width}px 七项实时成就、任务和目标流水、保底及终态冻结来源`, async ({ page }) => {
    const main = (await write({ type: 'createMainline', name: '冻结主线' })).result.entityId
    const goal = (await write({ type: 'createGoal', destination: main, title: '冻结成果', standards: ['发生时标准'] })).result.entityId
    await complete('冻结任务', goal)
    await write({ type: 'achieveGoal', id: goal, coefficient: 3, reflection: '本次达成感想' })
    await write({ type: 'renameMainline', id: main, name: '新的主线名称' })
    await write({ type: 'endMainline', id: main })
    const fallback = (await write({ type: 'createGoal', destination: '', title: '零行动成果', standards: ['标准'] })).result.entityId
    await write({ type: 'achieveGoal', id: fallback, coefficient: 2 })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/adventure')
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    const summary = page.getByRole('region', { name: '全账户成长', exact: true })
    await expect(summary).toContainText('累计经验 5')
    await expect(summary).toContainText('1 次真实行动 · 2 个达成目标')
    const badges = page.getByRole('region', { name: '七个实时成就' })
    await expect(badges.getByRole('article')).toHaveCount(7)
    await expect(badges.getByRole('article', { name: '成就：迈出第一步', exact: true })).toContainText('已点亮')
    await expect(badges.getByRole('article', { name: '成就：三个成果', exact: true })).toContainText('还差 1 个目标')
    const journal = page.getByRole('region', { name: '有效奖励流水', exact: true })
    await expect(journal.getByRole('article')).toHaveCount(3)
    await expect(journal.getByRole('article', { name: '奖励：零行动成果', exact: true })).toContainText('零行动保底 · 固定 1 点')
    const goalReward = journal.getByRole('article', { name: '奖励：冻结成果', exact: true })
    await expect(goalReward).toContainText('1 次计奖行动 × 系数 3 = 3 点')
    await expect(goalReward).toContainText('冻结主线 / 冻结成果')
    await goalReward.getByRole('button', { name: '查看来源', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '冻结奖励来源', exact: true })
    await expect(detail).toContainText('发生时标准')
    await expect(detail).toContainText('本次达成感想')
    await expect(detail.getByRole('region', { name: '冻结计奖行动', exact: true })).toContainText('冻结任务')
    await expect(detail.getByRole('region', { name: '冻结计奖行动', exact: true })).toContainText('冻结行动说明')
    await page.reload()
    await expect(detail).toContainText('本次达成感想')
    await page.keyboard.press('Escape')
    await journal.getByRole('article', { name: '奖励：冻结任务', exact: true }).getByRole('button', { name: '查看来源', exact: true }).click()
    await expect(detail).toContainText('冻结行动说明')
    await expect(detail.getByRole('link', { name: '查看任务安排历史', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect((await growth()).growth).toMatchObject({ totalXp: 5, actions: 1, achievedGoals: 2 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure62-growth-${width}.png`, fullPage: true })
  })

  test('390px 页面与数据库核对 19→20→19→20，刷新后等级、流水及七项成就一致', async ({ page }) => {
    for (let i = 0; i < 19; i++) await complete(`已有行动 ${i}`)
    await write({ type: 'createTask', title: '临界行动', destination: '', description: '', plannedOn: (await snapshot()).today })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.goto('/adventure?view=growth')
    const summary = page.getByRole('region', { name: '全账户成长', exact: true })
    await expect(summary).toContainText('累计经验 19')
    await expect(summary).toContainText('Lv.1')
    await page.getByRole('button', { name: '冒险概览', exact: true }).click()
    const task = page.getByRole('article', { name: '任务：临界行动', exact: true })
    await task.getByRole('button', { name: '完成', exact: true }).click()
    await expect(task).toContainText('已完成')
    const completed = (await snapshot()).tasks.find(item => item.title === '临界行动')!
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await expect(summary).toContainText('累计经验 20')
    await expect(summary).toContainText('Lv.2')
    await expect(summary).toContainText('0 / 25')
    await page.getByRole('button', { name: '冒险概览', exact: true }).click()
    await task.getByRole('button', { name: '取消完成', exact: true }).click()
    await page.getByRole('button', { name: '确认取消完成', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await expect(summary).toContainText('累计经验 19')
    await expect(summary).toContainText('Lv.1')
    await expect(page.getByRole('article', { name: '奖励：临界行动', exact: true })).toHaveCount(0)
    expect((await growth()).growth).toMatchObject({ totalXp: 19, actions: 19, level: 1 })
    await page.getByRole('button', { name: '冒险概览', exact: true }).click()
    await task.getByRole('button', { name: '完成', exact: true }).click()
    await expect(task).toContainText('已完成')
    await page.getByRole('button', { name: '成长记录', exact: true }).click()
    await page.reload()
    await expect(summary).toContainText('累计经验 20')
    await expect(summary).toContainText('Lv.2')
    expect((await growth()).items[0].id).not.toBe(completed.completionId)
    expect((await growth()).growth).toMatchObject({ totalXp: 20, actions: 20, level: 2 })
  })

  test('分页与来源独立重试；版本变化拒绝拼页，重新读取后全量统计正确', async ({ page, context }) => {
    const goal = (await write({ type: 'createGoal', title: '多页成果', destination: '', standards: ['标准'] })).result.entityId
    for (let i = 0; i < 12; i++) await complete(`多页行动 ${i}`, goal)
    await write({ type: 'achieveGoal', id: goal, coefficient: 2 })
    await page.goto('/adventure?view=growth')
    const journal = page.getByRole('region', { name: '有效奖励流水', exact: true })
    await expect(journal.getByRole('article')).toHaveCount(10)
    let failSource = true
    await context.route('**/api/adventure/reward-source?**', async route => {
      if (failSource) { failSource = false; await route.fulfill({ status: 503, json: { error: { message: '临时来源失败' } } }) }
      else await route.fallback()
    })
    await journal.getByRole('article', { name: '奖励：多页成果', exact: true }).getByRole('button', { name: '查看来源', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '冻结奖励来源', exact: true })
    await detail.getByRole('button', { name: '重试来源详情', exact: true }).click()
    const actions = detail.getByRole('region', { name: '冻结计奖行动', exact: true })
    await expect(actions.getByRole('listitem')).toHaveCount(5)
    await actions.getByRole('button', { name: '下一页计奖行动', exact: true }).click()
    await expect(actions).toContainText('第 2 页')
    await actions.getByRole('button', { name: '下一页计奖行动', exact: true }).click()
    await expect(actions.getByRole('listitem')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(journal.getByRole('article')).toHaveCount(10)
    let failPage = true
    await context.route('**/api/adventure/growth?**', async route => {
      if (new URL(route.request().url()).searchParams.has('cursor') && failPage) { failPage = false; await route.fulfill({ status: 503, json: { error: { message: '临时分页失败' } } }) }
      else await route.fallback()
    })
    await journal.getByRole('button', { name: '加载更多流水', exact: true }).click()
    await expect(journal.getByRole('article')).toHaveCount(10)
    await page.getByRole('button', { name: '重试加载流水', exact: true }).click()
    await expect(journal.getByRole('article')).toHaveCount(13)
    await expect(journal).toContainText('已显示 13 / 13')
    await page.reload()
    await expect(journal.getByRole('article')).toHaveCount(10)
    await complete('另一会话的新行动')
    await journal.getByRole('button', { name: '加载更多流水', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('数据已更新')
    await expect(journal.getByRole('article')).toHaveCount(10)
    await page.getByRole('button', { name: '重新读取成长记录', exact: true }).click()
    await expect(journal).toContainText('已显示 10 / 14')
    await expect(page.getByRole('region', { name: '全账户成长', exact: true })).toContainText('累计经验 37')
    expect((await growth()).growth).toMatchObject({ totalXp: 37, actions: 13, achievedGoals: 1 })
  })
  test('直接进入只读成长页不请求规划接口或初始化账户', async ({ page, context }) => {
    const paths: string[] = []
    await context.route('**/api/adventure**', async route => { paths.push(new URL(route.request().url()).pathname); await route.fallback() })
    await page.goto('/adventure?view=growth')
    await expect(page.getByRole('region', { name: '全账户成长', exact: true })).toContainText('累计经验 0')
    expect(paths).toEqual(['/api/adventure/growth'])
    await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0)
    expect(await growth()).toMatchObject({ version: 0, total: 0, items: [] })
  })

  test('永久链接首屏失败可单独重试，保留已读取来源和稳定URL，错误提示仅一份且可关闭', async ({ page, context }) => {
    const done = await complete('独立恢复来源')
    let fail = true
    await context.route('**/api/adventure/growth?**', async route => {
      if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: { message: '成长首屏暂时失败' } } }) }
      else await route.fallback()
    })
    await page.goto(`/adventure?view=growth&rewardId=${done.result.completionId}`)
    const detail = page.getByRole('dialog', { name: '冻结奖励来源', exact: true })
    await expect(detail).toContainText('独立恢复来源')
    await expect(page.getByRole('alert')).toHaveCount(1)
    await detail.getByRole('button', { name: '关闭错误提示', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await detail.getByRole('button', { name: '重新读取成长记录', exact: true }).click()
    await expect(page.getByRole('region', { name: '全账户成长', exact: true })).toContainText('累计经验 1')
    await expect(detail).toContainText('冻结行动说明')
    await expect(page).toHaveURL(new RegExp(`rewardId=${done.result.completionId}`))
  })

  test('七项成就全部点亮，合法取消使百次行动熄灭，刷新与数据库一致', async ({ page }) => {
    let last: Awaited<ReturnType<typeof complete>> | undefined
    for (let i = 0; i < 100; i++) last = await complete(`百次验收 ${i}`)
    for (let i = 0; i < 10; i++) {
      const goal = (await write({ type: 'createGoal', title: `十项成果 ${i}`, destination: '', standards: ['标准'] })).result.entityId
      await write({ type: 'achieveGoal', id: goal })
    }
    await page.goto('/adventure?view=growth')
    const badges = page.getByRole('region', { name: '七个实时成就', exact: true })
    await expect(badges.getByRole('article')).toHaveCount(7)
    await expect(badges.getByText('已点亮', { exact: false })).toHaveCount(7)
    expect((await growth()).growth).toMatchObject({ totalXp: 110, actions: 100, achievedGoals: 10 })
    await write({ type: 'cancelTaskCompletion', completionId: last!.result.completionId })
    await page.reload()
    await expect(badges.getByRole('article', { name: '成就：百次行动', exact: true })).toContainText('未点亮')
    await expect(badges.getByRole('article', { name: '成就：百次行动', exact: true })).toContainText('还差 1 次行动')
    await expect(badges.getByText('已点亮', { exact: false })).toHaveCount(6)
    await expect(page.getByRole('region', { name: '全账户成长', exact: true })).toContainText('累计经验 109')
    expect((await growth()).growth.achievements.find(item => item.id === 'actions_100')).toMatchObject({ count: 99, remaining: 1, unlocked: false })
  })

})
