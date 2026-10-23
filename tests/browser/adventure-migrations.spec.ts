import { openRecordActions } from './adventure-record-helpers'
import { test, expect } from './authenticated-test'
import { allowed, planningFixture, withGoal, goalId, mainlineId } from './adventure-fixture'
import type { PlanningPage } from '../../src/shared/adventure-planning'

const target = '00000000-0000-4000-8000-000000000060'
const initial: PlanningPage = { ...withGoal, goals: [{ ...withGoal.goals[0], capabilities: { ...withGoal.goals[0].capabilities, migrate: allowed } }] }
const moved: PlanningPage = { ...initial, version: 3, goals: [{ ...initial.goals[0], mainlineId: target, mainlineName: '目的主线' }] }

async function openMigration(page: import('@playwright/test').Page) {
  await page.goto('/adventure')
  await page.getByRole('button', { name: '目标：五公里', exact: true }).click()
  await openRecordActions(page.locator('.adventure-proto-goal').first())
  await page.getByRole('button', { name: '迁移目标', exact: true }).click()
}

test('迁移结果未知只重试原封套，成功后查询失败只重读', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  await context.route('**/api/adventure/migration-options?**', route => route.fulfill({ json: { version: 2, kind: 'goal', entityId: goalId, page: 1, pageSize: 20, total: 1,
    options: [{ id: target, name: '目的主线', capability: allowed }] } }))
  server.saved(moved)
  await openMigration(page)
  await page.getByLabel('迁移目的').selectOption(target)
  server.loseNextResponse()
  await page.getByRole('button', { name: '确认迁移', exact: true }).click()
  await expect(page.getByRole('button', { name: '安全重试同一次操作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认迁移', exact: true })).toBeDisabled()
  server.failNextQuery()
  await page.getByRole('button', { name: '安全重试同一次操作', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
  expect(server.envelopes).toHaveLength(2)
  expect(server.envelopes[1]).toEqual(server.envelopes[0])
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled()
  expect(server.envelopes).toHaveLength(2)
})

test('迁移409重读后清除旧选择，必须重新选择并确认', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  let version = 2
  await context.route('**/api/adventure/migration-options?**', route => route.fulfill({ json: { version, kind: 'goal', entityId: goalId, page: 1, pageSize: 20, total: 2,
    options: [{ id: mainlineId, name: '当前主线', capability: { allowed: false, reason: '当前归属，无需迁移' } }, { id: target, name: '目的主线', capability: allowed }] } }))
  await openMigration(page)
  await page.getByLabel('迁移目的').selectOption(target)
  version = 3
  server.saved({ ...initial, version })
  server.conflictNext()
  await page.getByRole('button', { name: '确认迁移', exact: true }).click()
  await expect(page.getByLabel('迁移目的')).toHaveValue('__unselected')
  await expect(page.getByRole('button', { name: '确认迁移', exact: true })).toBeDisabled()
  expect(server.envelopes).toHaveLength(1)
  await page.getByLabel('迁移目的').selectOption(target)
  server.saved({ ...moved, version: 4 })
  await page.getByRole('button', { name: '确认迁移', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(server.envelopes[1]).toMatchObject({ expectedVersion: 3, command: { type: 'migrateGoal', id: goalId, destination: target } })
  expect(server.envelopes[1].requestId).not.toBe(server.envelopes[0].requestId)
})

test('候选读取失败可恢复，分页不沿用旧选择且取消不发命令', async ({ page, context }) => {
  const server = await planningFixture(context, initial)
  let fail = true
  await context.route('**/api/adventure/migration-options?**', async route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: { message: '候选失败' } } }) }
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'))
    return route.fulfill({ json: { version: 2, kind: 'goal', entityId: goalId, page: pageNumber, pageSize: 20, total: 21,
      options: [{ id: pageNumber === 1 ? mainlineId : target, name: `候选页 ${pageNumber}`, capability: allowed }] } })
  })
  await openMigration(page)
  await page.getByRole('button', { name: '重试读取候选', exact: true }).click()
  await page.getByLabel('迁移目的').selectOption(mainlineId)
  await page.getByRole('button', { name: '下一页候选', exact: true }).click()
  await expect(page.getByLabel('迁移目的')).toHaveValue('__unselected')
  await page.getByLabel('迁移目的').selectOption(target)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(server.envelopes).toHaveLength(0)
})
