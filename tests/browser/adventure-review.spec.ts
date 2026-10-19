import { test, expect } from './authenticated-test'
import { adventureFixture } from './adventure-fixture'

test('已达成且保留周期的目标可单独归档，另一目标继续推进，历史待结算保留', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  const goalA = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '目标 A',
      standard: '完成第一次跑步',
    },
  ]).entityId!
  const goalB = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '目标 B',
      standard: '形成睡眠规律',
    },
  ]).entityId!
  const cycle = server.seed([
    {
      type: 'createCycle',
      goalId: goalA,
      title: '继续跑步',
      startDate: '2026-10-19',
      cadence: 'daily',
      weekdays: [],
      checklist: [],
    },
  ]).entityId!
  server.seed([
    { type: 'completeTask', id: `${cycle}@2026-10-19` },
    {
      type: 'completeGoal',
      id: goalA,
      confirmed: true,
      coefficient: 1,
      cycleChoices: { [cycle]: 'continue' },
    },
  ])
  await page.goto('/adventure')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  const goalARow = page
    .locator('.adventure-goals>li')
    .filter({ has: page.getByRole('button', { name: '目标 A', exact: true }) })
  await expect(goalARow.getByLabel('目标 A的更多操作')).toBeVisible({
    timeout: 1500,
  })
  await goalARow.getByLabel('目标 A的更多操作').click()
  await expect(goalARow.getByRole('button', { name: '编辑目标' })).toHaveCount(
    0,
  )
  await goalARow.getByRole('button', { name: '归档目标' }).click()
  const impact = page.getByRole('region', { name: '归档影响明细' })
  await expect(impact).toContainText('关联 1 个目标 · 1 个周期任务')
  await expect(impact).toContainText(
    '保留待结算：1 次已完成行动、1 项已确认目标',
  )
  await page.getByRole('button', { name: '确认归档' }).click()
  await expect(goalARow).toContainText('已归档 · 只读')
  await page.screenshot({
    path: '.cache/adventure-review-completed-archive.png',
    fullPage: true,
  })
  await expect(goalARow.getByLabel('目标 A的更多操作')).toHaveCount(0)
  await expect(goalARow.getByRole('button', { name: '撤销达成' })).toHaveCount(
    0,
  )
  const goalBRow = page
    .locator('.adventure-goals>li')
    .filter({ has: page.getByRole('button', { name: '目标 B', exact: true }) })
  await goalBRow.getByRole('button', { name: '聚焦', exact: true }).click()
  await expect(goalBRow.getByRole('button', { name: '取消聚焦' })).toBeVisible()
  await page.getByRole('button', { name: '冒险概览', exact: true }).click()
  await expect(page.locator('.adventure-cycle-row')).toContainText('已结束')
  await expect(page.getByText('行动与目标待结算 +2 XP')).toBeVisible()
  server.setToday('2026-10-20')
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await expect(page.getByText('总经验 2 · 距下一级 18 XP')).toBeVisible()
  expect(goalB).toBeTruthy()
})

test('零经验目标结算仍提示新成就，经验与等级保持原值', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context, '2026-10-20')
  const main = server.seed(
    [{ type: 'createContainer', kind: 'main', name: '探索' }],
    '2026-10-19',
  ).entityId!
  const goal = server.seed(
    [
      {
        type: 'createGoal',
        containerId: main,
        title: '确认外部成果',
        standard: '通过实际结果确认达成',
      },
    ],
    '2026-10-19',
  ).entityId!
  server.seed(
    [{ type: 'completeGoal', id: goal, confirmed: true, cycleChoices: {} }],
    '2026-10-19',
  )
  await page.goto('/adventure')
  await expect(page.getByRole('status')).toContainText('解锁 1 项成就', {
    timeout: 1500,
  })
  await expect(page.getByRole('status')).toContainText('未增加经验')
  await expect(page.getByRole('status')).not.toContainText('+0 XP')
  await expect(page.getByText('总经验 0 · 距下一级 20 XP')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '第一个成果 · 已解锁' }),
  ).toBeVisible()
})

import { Temporal } from '@js-temporal/polyfill'

test('累计长期系数1.1但本月未达标时，当前预览及结算详情明确实际使用1并奖励5XP', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context, '2026-10-19')
  const main = server.seed(
    [{ type: 'createContainer', kind: 'main', name: '健康' }],
    '2026-06-19',
  ).entityId!
  const goal = server.seed(
    [
      {
        type: 'createGoal',
        containerId: main,
        title: '长期运动',
        standard: '保持运动',
      },
    ],
    '2026-06-19',
  ).entityId!
  const cycle = server.seed(
    [
      {
        type: 'createCycle',
        goalId: goal,
        title: '每日运动',
        startDate: '2026-06-19',
        cadence: 'daily',
        weekdays: [],
        checklist: [],
      },
    ],
    '2026-06-19',
  ).entityId!
  for (
    let day = Temporal.PlainDate.from('2026-06-19');
    day.toString() < '2026-10-04';
    day = day.add({ days: 1 })
  )
    server.seed(
      [{ type: 'completeTask', id: `${cycle}@${day}` }],
      day.toString(),
    )
  await page.goto('/adventure')
  const cycleCard = page.locator('.adventure-cycle-row').filter({
    has: page.getByRole('button', { name: '每日运动', exact: true }),
  })
  await cycleCard.getByRole('button', { name: '每日运动', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('计划 30 次 · 实际完成 15 次 · 完成率 50%')
  await expect(dialog).toContainText('累计长期系数 ×1.1', { timeout: 1500 })
  await expect(dialog).toContainText('本期实际适用系数 ×1')
  await expect(dialog).toContainText('奖励预估 5 XP')
  await page.screenshot({
    path: '.cache/adventure-review-multipliers-current.png',
  })
  await page.keyboard.press('Escape')
  await cycleCard.getByLabel('每日运动的更多操作').click()
  await cycleCard.getByRole('button', { name: '修改重复规则' }).click()
  const forecast = page.getByRole('table', { name: '任务月数值对照（仅预估）' })
  await expect(
    forecast.getByRole('row', { name: '累计长期系数 ×1.1 ×1.1' }),
  ).toBeVisible()
  await expect(
    forecast.getByRole('row', { name: '本期实际适用系数 ×1 ×1' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  server.setToday('2026-10-20')
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await page.getByRole('button', { name: '成长记录', exact: true }).click()
  await page.getByRole('button', { name: /^任务月奖励 · 2026-10-19 / }).click()
  await expect(page.getByRole('dialog')).toContainText('累计长期系数 ×1.1')
  await expect(page.getByRole('dialog')).toContainText('本期实际适用系数 ×1')
  await expect(page.getByRole('dialog')).toContainText(
    'floor(10 × min(15/30, 1) × 1)',
  )
  await expect(page.getByRole('dialog')).toContainText('+5 XP')
  await page.screenshot({
    path: '.cache/adventure-review-multipliers-ledger.png',
  })
})

test('历史任务月缺少实际系数字段时明确未知，保留原计算公式而非将累计系数冒充实际', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context)
  server.seedHistoricalState({
    schemaVersion: 1,
    timeZone: 'Asia/Shanghai',
    containers: [],
    goals: [],
    tasks: [],
    cycles: [],
    achievements: [],
    ledger: [
      {
        id: 'legacy-cycle-month',
        kind: 'cycle',
        sourceId: 'legacy-cycle',
        date: '2026-09-19',
        settledOn: '2026-09-20',
        amount: 5,
        calculation: 'floor(10 × min(15/30, 1) × 1)',
        snapshots: [],
        month: {
          index: 3,
          start: '2026-08-19',
          end: '2026-09-19',
          planned: 30,
          actual: 15,
          rate: 0.5,
          qualifiedBefore: 3,
          qualifiedAfter: 3,
          multiplier: '1.1',
        },
      },
    ],
  })
  await page.goto('/adventure')
  await page.getByRole('button', { name: '成长记录', exact: true }).click()
  await page.getByRole('button', { name: /任务月奖励.*2026-09-19/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('本期实际适用系数未单独记录', {
    timeout: 1500,
  })
  await expect(dialog).not.toContainText('适用系数 ×1.1')
  await expect(dialog).toContainText('floor(10 × min(15/30, 1) × 1)')
})
