import { test, expect } from './authenticated-test'
import app from '../../worker/index'
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

test.describe('真实任务事务的桌面与手机浏览器验收（受控身份）', () => {
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
      await expect(page.getByLabel('任务归属', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('任务归属', { exact: true }).locator('option[value="independent"]')).toHaveCount(0)
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
    const frozen = completed.tasks.find(task => task.title === title)!
    const completionA = frozen.completionId
    expect(frozen.reward).toEqual({ amount: 1, calculation: { type: 'fixed_task', completionId: completionA, count: 1, coefficient: 1 } })
    await expect(card).toContainText('本次奖励 1 点经验')
    await card.getByRole('button', { name: '取消完成', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '取消任务完成' })
    await expect(dialog).toContainText(`${before.growth.totalXp} 点经验`)
    expect((await snapshot()).version).toBe(completed.version)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure55-native-${width}.png` })
    await dialog.getByRole('button', { name: '确认取消完成', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    const afterCancel = await snapshot()
    expect(afterCancel.growth.totalXp).toBe(before.growth.totalXp)
    expect(afterCancel.tasks.find(task => task.title === title)!.reward).toBeNull()
    await expect(card).not.toContainText('本次奖励')
    await card.getByRole('button', { name: '完成', exact: true }).click()
    await expect(card.getByRole('button', { name: '取消完成', exact: true })).toBeVisible()
    await page.reload()
    await expect(card).toContainText('已完成')
    const result = await snapshot()
    expect(result.tasks.find(task => task.title === title)!.completionId).not.toBe(completionA)
    expect(result.growth.totalXp).toBe(before.growth.totalXp + 1)
    expect(result.tasks.find(task => task.title === title)!.reward?.amount).toBe(1)
  })
  for (const width of [1440, 390]) test(`${width}px 聚焦配额、拖动与键盘排序、搜索日期双视图与进度刷新`, async ({ page }) => {
    const write = async (command: unknown) => {
      const response = await app.request('/api/adventure/commands', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: (await snapshot()).version, requestId: crypto.randomUUID(), command }),
      }, env)
      expect(response.status).toBe(200)
      return (await response.json() as { result: { entityId: string } }).result.entityId
    }
    const ids: string[] = []
    for (let i = 1; i <= 4; i++) ids.push(await write({ type: 'createGoal', destination: '', title: `验收目标 ${i}`, standards: ['独立完成标准'] }))
    const today = (await snapshot()).today
    for (const [title, destination] of [['搜索聚焦', ids[0]], ['搜索未聚焦', ids[3]], ['搜索独立', '']])
      await write({ type: 'createTask', title, description: '检索说明', destination, plannedOn: today })
    await write({ type: 'createTask', title: '搜索未来', description: '', destination: ids[0], plannedOn: '2099-01-01' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/adventure')
    const card = (i: number) => page.getByRole('article', { name: `目标卡：验收目标 ${i}`, exact: true })
    for (const i of [1, 2, 3]) {
      await card(i).getByRole('button', { name: '聚焦', exact: true }).click()
      await expect(card(i)).toContainText('聚焦中')
    }
    await expect(card(4).getByRole('button', { name: '聚焦', exact: true })).toBeDisabled()
    expect((await snapshot()).goals.filter(goal => goal.focused)).toHaveLength(3)
    await card(3).getByRole('button', { name: '上移目标 验收目标 3', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await snapshot()).goals.map(goal => goal.title)).toEqual(['验收目标 1', '验收目标 3', '验收目标 2', '验收目标 4'])
    await expect(card(3).getByRole('button', { name: '上移目标 验收目标 3', exact: true })).toBeEnabled()
    await card(2).dragTo(card(1))
    await expect.poll(async () => (await snapshot()).goals.map(goal => goal.title)).toEqual(['验收目标 2', '验收目标 1', '验收目标 3', '验收目标 4'])
    await page.getByRole('button', { name: '聚焦任务', exact: true }).click()
    const focusedTask = page.getByRole('article', { name: '任务：搜索聚焦', exact: true })
    await expect(focusedTask).toBeVisible()
    await expect(page.getByRole('article', { name: '任务：搜索独立', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: '任务：搜索未聚焦', exact: true })).toHaveCount(0)
    await expect(page.getByRole('progressbar', { name: '当前筛选任务进度', exact: true })).toHaveAttribute('value', '0')
    await focusedTask.getByRole('button', { name: '完成', exact: true }).click()
    await expect(focusedTask).toContainText('已完成')
    await expect(page.getByRole('progressbar', { name: '当前筛选任务进度', exact: true })).toHaveAttribute('value', '0.5')
    expect((await snapshot('?taskScope=focus')).taskProgress).toEqual({ completed: 1, total: 2, ratio: 0.5 })
    await page.getByLabel('搜索任务', { exact: true }).fill('搜索')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('button', { name: '未来', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '未来', exact: true }).click()
    await expect(page.getByRole('article', { name: '任务：搜索未来', exact: true })).toBeVisible()
    expect((await snapshot('?taskScope=focus&taskRange=future&search=搜索')).taskProgress).toEqual({ completed: 0, total: 1, ratio: 0 })
    await page.getByLabel('搜索任务', { exact: true }).fill('不存在')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('group', { name: '当前筛选任务进度', exact: true })).toContainText('暂无可统计任务')
    await page.reload()
    await expect(page.getByRole('article', { name: '目标卡：验收目标 2', exact: true })).toBeVisible()
    const result = await snapshot()
    expect(result.goals.map(goal => goal.id)).toEqual([ids[1], ids[0], ids[2], ids[3]])
    expect(result.goals[1]).toMatchObject({ focused: true, progress: { completed: 1, total: 2, ratio: 0.5 } })
    await expect(page.getByRole('article', { name: '任务：搜索独立', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: '任务：搜索未聚焦', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/adventure65-native-${width}.png`, fullPage: true })
  })

  for (const width of [1440, 390]) test(`${width}px 有行动与待完成任务的达成、取消预览、零行动保底及终态刷新`, async ({ page }) => {
    const write = async (command: unknown) => {
      const response = await app.request('/api/adventure/commands', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: (await snapshot()).version, requestId: crypto.randomUUID(), command }),
      }, env)
      expect(response.status).toBe(200)
      return (await response.json() as { result: { entityId: string } }).result.entityId
    }
    const id = await write({ type: 'createGoal', destination: '', title: '浏览器成果', standards: ['独立确认成果'] })
    await write({ type: 'focusGoal', id, focused: true })
    const task = await write({ type: 'createTask', destination: id, title: '已经做完', description: '', plannedOn: (await snapshot()).today })
    await write({ type: 'completeTask', id: task })
    await write({ type: 'createTask', destination: id, title: '将要停止', description: '', plannedOn: (await snapshot()).today })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/adventure')
    await page.getByRole('button', { name: '目标：浏览器成果', exact: true }).click()
    await page.getByRole('button', { name: '确认达成', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '确认目标达成', exact: true })
    await expect(modal).toContainText('独立确认成果')
    await expect(modal).toContainText('将要停止')
    await expect(modal).toContainText('需要继续的任务请先迁出')
    const before = await snapshot()
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    expect(await snapshot()).toEqual(before)
    await page.getByRole('button', { name: '目标：浏览器成果', exact: true }).click()
    await page.getByRole('button', { name: '确认达成', exact: true }).click()
    await page.getByLabel('成就感评价', { exact: true }).selectOption('2')
    await page.getByLabel('达成感想（可选）', { exact: true }).fill('浏览器确认的感想')
    await expect(modal).toContainText('目标奖励：2 点经验')
    await modal.getByRole('button', { name: '确认达成并入账', exact: true }).focus()
    await page.keyboard.press('Enter')
    const result = page.getByRole('dialog', { name: '目标详情', exact: true })
    await expect(result).toContainText('已达成 · 结果已冻结')
    await expect(result).toContainText('浏览器确认的感想')
    await expect(result.getByRole('button', { name: '编辑目标', exact: true })).toBeDisabled()
    await expect(result.getByRole('button', { name: '添加任务', exact: true })).toBeDisabled()
    await expect(result.getByRole('button', { name: '确认达成', exact: true })).toBeDisabled()
    await expect(result.getByLabel('目标任务历史', { exact: true })).toContainText('将要停止')
    expect((await snapshot()).growth).toMatchObject({ totalXp: 3, actions: 1, achievedGoals: 1 })
    await page.reload()
    await expect(result).toContainText('目标奖励 2 点经验')
    await expect(result).toContainText('已结束')
    const frozen = (await snapshot(`?goalId=${id}`)).goalDetail!.goal
    expect(frozen).toMatchObject({ status: 'achieved', focused: false, achievement: { reflection: '浏览器确认的感想', reward: { amount: 2, calculation: { count: 1, coefficient: 2 } } } })
    await page.screenshot({ path: `.cache/adventure59-result-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '目标：浏览器成果', exact: true })).toHaveCount(0)
    const completed = page.getByRole('article', { name: '任务：已经做完', exact: true })
    await expect(completed.getByRole('button', { name: '取消完成', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /阶段成果/ }).click()
    await page.getByLabel('目标名称', { exact: true }).fill('无任务成果')
    await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('没有任务也能确认')
    await page.getByRole('button', { name: '创建目标', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: '目标：无任务成果', exact: true }).click()
    await page.getByRole('button', { name: '确认达成', exact: true }).click()
    await expect(modal).toContainText('固定奖励 1 点')
    await expect(modal.getByLabel('成就感评价', { exact: true })).toHaveValue('1')
    await modal.getByRole('button', { name: '确认达成并入账', exact: true }).click()
    await expect(result).toContainText('无有效计奖行动，使用 1 点保底奖励')
    expect((await snapshot()).growth).toMatchObject({ totalXp: 4, actions: 1, achievedGoals: 2 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

})
