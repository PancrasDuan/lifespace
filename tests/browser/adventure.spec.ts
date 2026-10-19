import { test, expect } from './authenticated-test'

test('人生冒险作为独立页面，数据源失败时提供明确重试', async ({ page }) => {
  await page.goto('/adventure')
  await expect(
    page.getByRole('heading', { name: '把想做的事，慢慢变成现实。' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('暂时无法读取人生冒险')
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible()
})

import { adventureFixture } from './adventure-fixture'
import type { Page } from '@playwright/test'

async function chooseNew(page: Page, name: '主线 / 支线' | '目标' | '任务') {
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name, exact: true })
    .click()
}
async function createMain(page: Page, name: string) {
  await chooseNew(page, '主线 / 支线')
  await page.getByLabel('名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}
async function createGoal(page: Page, owner: string, title: string) {
  await chooseNew(page, '目标')
  await page
    .getByLabel('所属主线或支线')
    .selectOption({ label: `${owner} 主线` })
  await page.getByLabel('目标名称').fill(title)
  await page.getByLabel('完成标准').fill('实际跑完五公里')
  await page.getByRole('button', { name: '创建目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

test('从空账户创建方向、目标、带清单任务，完成待结算，次日更新等级与成就', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context)
  await page.goto('/adventure')
  await expect(page.getByText('总经验 0 · 距下一级 20 XP')).toBeVisible()
  await chooseNew(page, '目标')
  await expect(page.getByLabel('所属主线或支线')).toHaveValue('')
  await expect(
    page.getByLabel('所属主线或支线').locator('option:not([hidden])'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await createMain(page, '健康')
  await createGoal(page, '健康', '跑完五公里')
  await chooseNew(page, '任务')
  await expect(page.getByLabel('所属目标')).toHaveValue('')
  await expect(
    page.getByLabel('所属目标').locator('option:not([hidden])'),
  ).toHaveText(['健康 主线 · 跑完五公里 目标'])
  await page
    .getByLabel('所属目标')
    .selectOption({ label: '健康 主线 · 跑完五公里 目标' })
  await page.getByLabel('任务名称').fill('完成一次跑步')
  await page.getByLabel('检查清单').fill('热身\n跑步\n拉伸')
  await page.getByRole('button', { name: '安排任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('checkbox', { name: '完成任务 完成一次跑步' }).check()
  await expect(page.getByText('行动与目标待结算 +1 XP')).toBeVisible()
  await expect(page.getByText('总经验 0 · 距下一级 20 XP')).toBeVisible()
  await page.reload()
  await expect(page.getByText('行动与目标待结算 +1 XP')).toBeVisible()
  server.setToday('2026-10-20')
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await expect(page.getByText('总经验 1 · 距下一级 19 XP')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '迈出第一步 · 已解锁' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '成长记录', exact: true }).click()
  await page.getByRole('button', { name: /单次行动.*完成一次跑步/ }).click()
  await expect(page.getByRole('dialog')).toContainText('结算时任务快照')
  await expect(page.getByRole('dialog')).toContainText('实际跑完五公里')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await expect(page.getByText('总经验 1 · 距下一级 19 XP')).toBeVisible()
})

test('丢失保存响应后安全重试使用同一请求编号，只创建一条主线', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context)
  await page.goto('/adventure')
  await createMain(page, '健康')
  await chooseNew(page, '主线 / 支线')
  await page.getByLabel('名称', { exact: true }).fill('职业')
  server.loseNextResponse()
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: '安全重试同一次操作' }),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '安全重试同一次操作' })
    .click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '职业 主线', exact: true }),
  ).toHaveCount(1)
  const writes = server.envelopes.filter(
    (envelope) =>
      envelope.command.type === 'createContainer' &&
      envelope.command.name === '职业',
  )
  expect(writes).toHaveLength(2)
  expect(writes[0].requestId).toBe(writes[1].requestId)
})

test('已验证身份切换时清理旧账户页面状态，迟到响应不能重新显示旧内容', async ({
  page,
  context,
}) => {
  const stateA = {
    schemaVersion: 1,
    timeZone: 'Asia/Shanghai',
    containers: [
      { id: 'a-main', kind: 'main', name: '账户 A 私密方向', archived: false },
    ],
    goals: [],
    tasks: [],
    cycles: [],
    ledger: [],
    achievements: [],
  }
  const stateB = { ...stateA, containers: [] }
  let switched = false,
    hold = false,
    held = false
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await context.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: switched
            ? '00000000-0000-4000-8000-000000000002'
            : '00000000-0000-4000-8000-000000000001',
          email: switched ? 'b@example.com' : 'demo@example.com',
        },
      },
    }),
  )
  await context.route('**/api/adventure**', async (route) => {
    const state = switched ? stateB : stateA
    if (hold && !switched) {
      held = true
      await pending
    }
    await route
      .fulfill({
        json: { state, version: switched ? 0 : 1, today: '2026-10-19' },
      })
      .catch(() => {})
  })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '账户 A 私密方向 主线' }),
  ).toBeVisible()
  hold = true
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await expect.poll(() => held).toBe(true)
  switched = true
  const userB = {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'b@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    email_confirmed_at: '2026-10-11',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-11',
  }
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  const tokenB = `${encode({ alg: 'HS256' })}.${encode({ sub: userB.id, exp: 4102444800, aud: 'authenticated', role: 'authenticated' })}.test-signature`
  await context.route('https://auth-test.supabase.co/auth/v1/user', (route) =>
    route.fulfill({ json: userB }),
  )
  await page.evaluate(async (tokenB) => {
    const path = '/src/auth/client.ts'
    const { authClient } = await import(path)
    await (
      await authClient()
    ).auth.setSession({ access_token: tokenB, refresh_token: 'test-b-refresh' })
  }, tokenB)
  try {
    await expect(
      page.getByRole('heading', { name: '账户 A 私密方向 主线' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '冒险概览', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  } finally {
    release()
  }
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '账户 A 私密方向 主线' }),
  ).toHaveCount(0)
})

test('SDK 无 SIGNED_OUT 切换到 B 且在线验证延迟时，A 的表单不能携带 B 身份写入', async ({
  page,
  context,
}) => {
  const empty = {
    schemaVersion: 1,
    timeZone: 'Asia/Shanghai',
    containers: [],
    goals: [],
    tasks: [],
    cycles: [],
    ledger: [],
    achievements: [],
  }
  const userB = {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'b@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    email_confirmed_at: '2026-10-11',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-11',
  }
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  const tokenB = `${encode({ alg: 'HS256' })}.${encode({ sub: userB.id, exp: 4102444800, aud: 'authenticated', role: 'authenticated', session_id: '00000000-0000-4000-8000-000000000003' })}.test-signature`
  let heldB = false,
    releaseB = () => {}
  const pendingB = new Promise<void>((resolve) => {
    releaseB = resolve
  })
  const leaked: string[] = []
  await context.route('https://auth-test.supabase.co/auth/v1/user', (route) =>
    route.fulfill({ json: userB }),
  )
  await context.route('**/api/auth/me', async (route) => {
    if (route.request().headers().authorization === `Bearer ${tokenB}`) {
      heldB = true
      await pendingB
      await route
        .fulfill({ json: { user: { id: userB.id, email: userB.email } } })
        .catch(() => {})
    } else
      await route.fulfill({
        json: {
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'demo@example.com',
          },
        },
      })
  })
  await context.route('**/api/adventure**', async (route) => {
    const body = route.request().postDataJSON()
    if (
      body?.command?.name === 'A 的私密计划' &&
      route.request().headers().authorization === `Bearer ${tokenB}`
    )
      leaked.push(body.command.name)
    await route.fulfill({
      json: { state: empty, version: 1, today: '2026-10-19' },
    })
  })
  await page.goto('/adventure')
  await chooseNew(page, '主线 / 支线')
  await page.getByLabel('名称', { exact: true }).fill('A 的私密计划')
  await page.evaluate(
    async ({ tokenB }) => {
      const path = '/src/auth/client.ts'
      const { authClient } = await import(path)
      const client = await authClient()
      await client.auth.setSession({
        access_token: tokenB,
        refresh_token: 'test-refresh-b',
      })
    },
    { tokenB },
  )
  await expect.poll(() => heldB).toBe(true)
  try {
    const staleSave = page
      .getByRole('dialog')
      .getByRole('button', { name: '创建', exact: true })
    if (await staleSave.isVisible()) await staleSave.click()
    expect(leaked).toEqual([])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.adventure-page')).toHaveCount(0)
  } finally {
    releaseB()
  }
  await expect(page.locator('.adventure-page')).toBeVisible()
  await expect(page.getByText('总经验 0 · 距下一级 20 XP')).toBeVisible()
})

test('写请求超时解除忙碌并保留请求编号，安全重试不永久阻塞或重复创建', async ({
  page,
  context,
}) => {
  test.setTimeout(35000)
  const server = await adventureFixture(context)
  let held = false,
    release = () => {}
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  const requestIds: string[] = []
  await context.route('**/api/adventure/commands', async (route) => {
    const envelope = route.request().postDataJSON()
    if (envelope.command.type === 'createContainer') {
      requestIds.push(envelope.requestId)
      if (!held) {
        held = true
        await delayed
        await route.abort().catch(() => {})
        return
      }
    }
    await route.fallback()
  })
  await page.goto('/adventure')
  await chooseNew(page, '主线 / 支线')
  await page.getByLabel('名称', { exact: true }).fill('超时恢复')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  try {
    const retry = page
      .getByRole('dialog')
      .getByRole('button', { name: '安全重试同一次操作' })
    await expect(retry).toBeEnabled({ timeout: 20000 })
    await retry.click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '主线与支线', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '超时恢复 主线' }),
    ).toHaveCount(1)
    expect(requestIds).toHaveLength(2)
    expect(requestIds[0]).toBe(requestIds[1])
  } finally {
    release()
  }
  expect(
    server.envelopes.filter(
      (envelope) => envelope.command.type === 'createContainer',
    ),
  ).toHaveLength(1)
})
