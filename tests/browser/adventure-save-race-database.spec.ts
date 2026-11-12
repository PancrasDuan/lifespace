import { test, expect } from './authenticated-test'
import { localPlanningRpc, planningDatabaseBrowser } from '../support/planning-database-browser'

const database = planningDatabaseBrowser()
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function seed() {
  const goal = (await database.write({ type: 'createGoal', title: '保留目标', standards: ['标准'], categoryLabel: '旧标签' })).result.entityId
  const task = (await database.write({ type: 'createTask', title: '保留行动', description: '完成时的说明', plannedOn: (await database.snapshot()).today, destination: goal })).result.entityId
  await database.write({ type: 'completeTask', id: task })
  return { goal, task, frozen: (await database.snapshot()).tasks[0] }
}
async function editGoal(page: import('@playwright/test').Page) {
  await page.goto('/adventure?view=planning')
  await page.getByRole('button', { name: '变更目标 保留目标' }).click()
  await page.getByLabel('分类标签').fill('新标签')
  await page.getByRole('button', { name: '保存目标' }).click()
}

test.describe('保存与刷新期间的真实数据库回执', () => {
  test.skip(!localPlanningRpc, '仅在显式启动的隔离本机 PostgreSQL／PostgREST 中运行')
  test.afterEach(() => database.restore())

  test('发送前丢失后刷新：无提交且缺回执时继续冻结', async ({ page, context }) => {
    await database.install(context)
    const { goal, task, frozen } = await seed()
    let requests = 0
    await context.route('**/api/adventure/commands', async route => { requests++; await route.abort('failed') })
    await editGoal(page)
    await expect(page.getByText(/保存结果未知|安全重试/).first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '确认上次操作结果' })).toBeVisible()
    const lookup = page.waitForResponse(response => response.url().endsWith('/api/adventure/receipts/lookup'))
    await page.getByRole('button', { name: '确认上次操作结果' }).click()
    const missing = await lookup
    expect(missing.status()).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'RECEIPT_UNKNOWN' } })
    await expect(page.getByText(/操作结果尚未确认/)).toBeVisible()
    await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
    expect(requests).toBe(1)
    const result = await database.snapshot()
    expect(result.goals.find(item => item.id === goal)?.categoryLabel).toBe('旧标签')
    expect(result.tasks[0]).toMatchObject({ id: task, goalId: goal, reward: frozen.reward, completionOrigin: { goalId: goal, categoryLabel: '旧标签' } })
  })

  test('数据库已提交但响应未达页面时刷新：回执确认后解除冻结', async ({ page, context }) => {
    const committed = gate(), release = gate()
    await database.install(context, { afterCommand: async () => { committed.release(); await release.promise } })
    const { goal, task, frozen } = await seed()
    try {
      await editGoal(page)
      await committed.promise
      expect((await database.snapshot()).goals.find(item => item.id === goal)?.categoryLabel).toBe('新标签')
      await page.reload()
      release.release()
      await expect(page.getByRole('button', { name: '确认上次操作结果' })).toBeVisible()
      const lookup = page.waitForResponse(response => response.url().endsWith('/api/adventure/receipts/lookup'))
      await page.getByRole('button', { name: '确认上次操作结果' }).click()
      expect((await lookup).status()).toBe(200)
      await expect(page.getByRole('button', { name: '确认上次操作结果' })).toHaveCount(0)
      const result = await database.snapshot()
      expect(result.goals.find(item => item.id === goal)?.categoryLabel).toBe('新标签')
      expect(result.tasks[0]).toMatchObject({ id: task, goalId: goal, reward: frozen.reward, completionOrigin: { goalId: goal, categoryLabel: '旧标签' } })
    } finally { release.release() }
  })

  test('延迟发送时等待保存完成再刷新：保留标签和完成事实', async ({ page, context }) => {
    await database.install(context)
    const { goal, task, frozen } = await seed()
    const entered = gate(), release = gate()
    await context.route('**/api/adventure/commands', async route => { entered.release(); await release.promise; await route.fallback() })
    try {
      await editGoal(page)
      await entered.promise
      await expect(page.getByRole('dialog', { name: '编辑目标' })).toBeVisible()
      expect((await database.snapshot()).goals.find(item => item.id === goal)?.categoryLabel).toBe('旧标签')
      release.release()
      await expect(page.getByRole('dialog', { name: '编辑目标' })).toBeHidden()
      await expect(page.locator('.goal-console-row').filter({ hasText: '保留目标' })).toContainText('新标签')
      await page.reload()
      await expect(page.getByRole('button', { name: '确认上次操作结果' })).toHaveCount(0)
      const result = await database.snapshot()
      expect(result.goals.find(item => item.id === goal)?.categoryLabel).toBe('新标签')
      expect(result.tasks[0]).toMatchObject({ id: task, goalId: goal, reward: frozen.reward, completionOrigin: { goalId: goal, categoryLabel: '旧标签' } })
    } finally { release.release() }
  })
})
