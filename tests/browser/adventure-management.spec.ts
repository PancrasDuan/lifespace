import { test, expect } from './authenticated-test'
import { adventureFixture } from './adventure-fixture'

test('目标编辑取消、每主线独立聚焦、键盘与拖动排序、支线迁移及归档来源', async ({
  page,
  context,
}) => {
  test.setTimeout(45000)
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  const goals = ['跑步', '力量', '睡眠', '饮食'].map(
    (title) =>
      server.seed([
        {
          type: 'createGoal',
          containerId: main,
          title,
          standard: `${title}实际标准`,
        },
      ]).entityId!,
  )
  for (const id of goals.slice(0, 3))
    server.seed([{ type: 'focusGoal', id, focused: true }])
  const side = server.seed([
    { type: 'createContainer', kind: 'side', name: '探索' },
  ]).entityId!
  const sideGoal = server.seed([
    {
      type: 'createGoal',
      containerId: side,
      title: '城市漫步',
      standard: '完成一次完整路线',
    },
  ]).entityId!
  server.seed([{ type: 'focusGoal', id: sideGoal, focused: true }])
  await page.goto('/adventure')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  const mainCard = page
    .locator('.adventure-container')
    .filter({ has: page.getByRole('heading', { name: '健康 主线' }) })
  const runGoal = mainCard
    .locator('li')
    .filter({ has: page.getByRole('button', { name: '跑步', exact: true }) })
  await runGoal.getByLabel('跑步的更多操作').click()
  await runGoal.getByRole('button', { name: '编辑目标' }).click()
  await page.getByLabel('目标名称').fill('不应保存')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    runGoal.getByRole('button', { name: '跑步', exact: true }),
  ).toBeVisible()
  const foodGoal = mainCard
    .locator('li')
    .filter({ has: page.getByRole('button', { name: '饮食', exact: true }) })
  await foodGoal.getByRole('button', { name: '聚焦', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('每条主线最多聚焦3个目标')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '下移目标 跑步' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: '下移目标 跑步' }).focus()
  await page.keyboard.press('Enter')
  await expect(mainCard.locator('li').first()).toContainText('力量')
  await expect(runGoal.getByRole('button', { name: '取消聚焦' })).toBeVisible()
  await mainCard.locator('li').last().dragTo(mainCard.locator('li').first())
  await expect(mainCard.locator('li').first()).toContainText('饮食')
  await page.getByRole('button', { name: '在用支线 1/10' }).click()
  const sideCard = page
    .locator('.adventure-container')
    .filter({ has: page.getByRole('heading', { name: '探索 支线' }) })
  await sideCard.getByLabel('探索的更多操作').click()
  await sideCard.getByRole('button', { name: '升级或迁移' }).click()
  await page.getByLabel('转换方式').selectOption('existing')
  await page.getByLabel('目标主线', { exact: true }).selectOption(main)
  await page.getByRole('button', { name: '确认转换' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '聚焦',
  )
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    sideCard.getByRole('button', { name: '城市漫步', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '主线 1/5' }).click()
  await runGoal.getByRole('button', { name: '取消聚焦' }).click()
  await page.getByRole('button', { name: '在用支线 1/10' }).click()
  await sideCard.getByLabel('探索的更多操作').click()
  await sideCard.getByRole('button', { name: '升级或迁移' }).click()
  await page.getByLabel('转换方式').selectOption('existing')
  await page.getByLabel('目标主线', { exact: true }).selectOption(main)
  await page.getByRole('button', { name: '确认转换' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: '归档与来源 1' }).click()
  await expect(page.getByText('已转换 · 来源只读')).toBeVisible()
  await expect(page.getByText('转换后的目标位于 健康 主线。')).toBeVisible()
  await expect(page.getByLabel('探索的更多操作')).toHaveCount(0)
  await page.getByRole('button', { name: '主线 1/5' }).click()
  await mainCard.getByLabel('健康的更多操作').click()
  await mainCard.getByRole('button', { name: '归档主线' }).click()
  await page.getByRole('button', { name: '确认归档' }).click()
  await page.getByRole('button', { name: '归档与来源 2' }).click()
  await expect(
    mainCard.locator('header').getByText('已归档 · 只读', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '主线 1/5' })).toBeVisible()
})

test('周期暂停恢复、规则修改预览、额外完成、目标逐项去向与撤销', async ({
  page,
  context,
}) => {
  test.setTimeout(45000)
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  const goal = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '建立习惯',
      standard: '完成计划活动',
    },
  ]).entityId!
  const cycle = server.seed([
    {
      type: 'createCycle',
      goalId: goal,
      title: '每天跑步',
      startDate: '2026-10-19',
      cadence: 'daily',
      weekdays: [],
      checklist: ['热身'],
    },
  ]).entityId!
  const second = server.seed([
    {
      type: 'createCycle',
      goalId: goal,
      title: '拉伸',
      startDate: '2026-10-19',
      cadence: 'daily',
      weekdays: [],
      checklist: [],
    },
  ]).entityId!
  await page.goto('/adventure')
  const cycleCard = page.locator('.adventure-cycle-row').filter({
    has: page.getByRole('button', { name: '每天跑步', exact: true }),
  })
  await cycleCard.getByLabel('每天跑步的更多操作').click()
  await cycleCard.getByRole('button', { name: '暂停周期任务' }).click()
  await page.getByRole('button', { name: '确认暂停' }).click()
  await expect(cycleCard).toContainText('暂停中')
  await expect(
    page.getByRole('checkbox', { name: '完成任务 每天跑步' }),
  ).toHaveCount(0)
  await cycleCard.getByLabel('每天跑步的更多操作').click()
  await cycleCard.getByRole('button', { name: '恢复周期任务' }).click()
  await page.getByRole('button', { name: '确认恢复' }).click()
  await expect(cycleCard).toContainText('运行中')
  await cycleCard.getByLabel('每天跑步的更多操作').click()
  await cycleCard.getByRole('button', { name: '修改重复规则' }).click()
  await page.getByLabel('重复频率').selectOption('weekly')
  await page.getByRole('checkbox', { name: '周一' }).check()
  await expect(page.getByText(/原安排 31 次 → 新安排/)).toBeVisible()
  await page.getByRole('button', { name: '保存重复规则' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await cycleCard.getByLabel('每天跑步的更多操作').click()
  await cycleCard.getByRole('button', { name: '记录额外完成' }).click()
  await page.getByRole('button', { name: '确认额外完成' }).click()
  await expect(page.getByText('行动与目标待结算 +1 XP')).toBeVisible()
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByLabel('建立习惯的更多操作').click()
  await page.getByRole('button', { name: '确认目标达成' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: '确认目标达成' }),
  ).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByLabel('每天跑步（运行中）').selectOption('continue')
  await expect(
    dialog.getByRole('button', { name: '确认目标达成' }),
  ).toBeDisabled()
  await dialog.getByLabel('拉伸（运行中）').selectOption('end')
  await dialog.getByLabel('成就系数').selectOption('2')
  await dialog.getByRole('button', { name: '确认目标达成' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('行动与目标待结算 +3 XP')).toBeVisible()
  await page.getByRole('button', { name: '冒险概览', exact: true }).click()
  await expect(cycleCard).toContainText('运行中')
  await expect(
    page
      .locator('.adventure-cycle-row')
      .filter({ has: page.getByRole('button', { name: '拉伸', exact: true }) }),
  ).toContainText('已结束')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByRole('button', { name: '撤销达成' }).click()
  await expect(page.getByText('行动与目标待结算 +1 XP')).toBeVisible()
  await page.getByRole('button', { name: '冒险概览', exact: true }).click()
  await expect(
    page
      .locator('.adventure-cycle-row')
      .filter({ has: page.getByRole('button', { name: '拉伸', exact: true }) }),
  ).toContainText('运行中')
  await cycleCard.getByRole('button', { name: '每天跑步', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('计划')
  await expect(page.getByRole('dialog')).toContainText('累计达标 0 个月')
  expect(cycle).toBeTruthy()
  expect(second).toBeTruthy()
})

test('漏做任务重新安排保留来源，未来和过去筛选可访问；窄屏新建键盘关闭返回焦点', async ({
  page,
  context,
}) => {
  test.setTimeout(30000)
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '职业' },
  ]).entityId!
  const goal = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '作品上线',
      standard: '可被访问',
    },
  ]).entityId!
  server.seed(
    [
      {
        type: 'createTask',
        goalId: goal,
        title: '整理作品',
        date: '2026-10-18',
        checklist: [],
      },
    ],
    '2026-10-18',
  )
  await page.goto('/adventure')
  await page.getByRole('button', { name: '过去', exact: true }).click()
  await page.getByLabel('整理作品的更多操作').click()
  await page.getByRole('button', { name: '重新安排', exact: true }).click()
  await page.getByLabel('新的执行日期').fill('2026-10-20')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '重新安排', exact: true })
    .click()
  await expect(page.getByText('已重新安排 · 原记录保留')).toBeVisible()
  await page.getByRole('button', { name: '未来', exact: true }).click()
  await expect(
    page.getByText('未来安排 · 当天可完成 · 来自重新安排'),
  ).toBeVisible()
  await page.getByRole('button', { name: '整理作品', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('原安排编号')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: '新建', exact: true }),
  ).toBeFocused()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('支线升级新主线保留目标，三类奖励合并结算可追溯且重复刷新不发奖', async ({
  page,
  context,
}) => {
  test.setTimeout(30000)
  const server = await adventureFixture(context, '2026-10-20')
  const side = server.seed(
    [{ type: 'createContainer', kind: 'side', name: '探索健康' }],
    '2026-09-19',
  ).entityId!
  const goal = server.seed(
    [
      {
        type: 'createGoal',
        containerId: side,
        title: '稳定跑步',
        standard: '形成习惯',
      },
    ],
    '2026-09-19',
  ).entityId!
  const cycle = server.seed(
    [
      {
        type: 'createCycle',
        goalId: goal,
        title: '月度跑步',
        startDate: '2026-09-19',
        cadence: 'weekly',
        weekdays: [1],
        checklist: [],
      },
    ],
    '2026-09-19',
  ).entityId!
  const task = server.seed(
    [
      {
        type: 'createTask',
        goalId: goal,
        title: '完成本期回顾',
        date: '2026-10-19',
        checklist: [],
      },
    ],
    '2026-10-19',
  ).entityId!
  server.seed(
    [
      { type: 'completeTask', id: task },
      {
        type: 'completeGoal',
        id: goal,
        confirmed: true,
        coefficient: 2,
        cycleChoices: { [cycle]: 'continue' },
      },
    ],
    '2026-10-19',
  )
  await page.goto('/adventure')
  await expect(page.getByText('总经验 3 · 距下一级 17 XP')).toBeVisible()
  await page.getByRole('button', { name: '成长记录', exact: true }).click()
  await expect(page.locator('.adventure-ledger-row')).toHaveCount(3)
  await page.getByRole('button', { name: /任务月奖励/ }).click()
  await expect(page.getByRole('dialog')).toContainText('计划 4 次')
  await expect(page.getByRole('dialog')).toContainText('+0 XP')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '刷新并结算' }).click()
  await expect(page.locator('.adventure-ledger-row')).toHaveCount(3)
  await page.getByRole('button', { name: '第一个成果 · 已解锁' }).click()
  await expect(page.getByRole('dialog')).toContainText('2026-10-20 解锁')
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: /目标达成.*2026-10-19/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByRole('button', { name: '归档与来源 1' }).click()
  const sideCard = page
    .locator('.adventure-container')
    .filter({ has: page.getByRole('heading', { name: '探索健康 支线' }) })
  await sideCard.getByLabel('探索健康的更多操作').click()
  await sideCard.getByRole('button', { name: '升级或迁移' }).click()
  await page.getByLabel('新主线名称').fill('健康成长')
  await page.getByRole('button', { name: '确认转换' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: '主线 1/5' }).click()
  await expect(
    page.getByRole('heading', { name: '健康成长 主线' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '稳定跑步', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('总经验 3 · 距下一级 17 XP')).toBeVisible()
})

test('旧版本写入冲突要求读取后重新确认，不自动覆盖另一页面的编辑', async ({
  page,
  context,
}) => {
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  await page.goto('/adventure')
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByLabel('健康的更多操作').click()
  await page.getByRole('button', { name: '编辑名称' }).click()
  await page.getByLabel('名称', { exact: true }).fill('旧页面意图')
  server.seed([{ type: 'editContainer', id: main, name: '另一页面已保存' }])
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '其他页面已更新数据',
  )
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '另一页面已保存 主线' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '旧页面意图 主线' }),
  ).toHaveCount(0)
})

test('未来清单不能提前执行，暂停当天仍可撤销完成；规则预览对照首个受影响任务月', async ({
  page,
  context,
}) => {
  test.setTimeout(30000)
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  const goal = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '稳定运动',
      standard: '按计划运动',
    },
  ]).entityId!
  const cycle = server.seed([
    {
      type: 'createCycle',
      goalId: goal,
      title: '运动计划',
      startDate: '2026-10-19',
      cadence: 'daily',
      weekdays: [],
      checklist: ['准备装备'],
    },
  ]).entityId!
  server.seed([
    {
      type: 'editTask',
      id: `${cycle}@2026-11-26`,
      title: '旧规则已实体化安排',
      date: '2026-11-26',
      checklist: ['准备装备'],
    },
  ])
  server.seed([
    {
      type: 'createTask',
      goalId: goal,
      title: '明天整理装备',
      date: '2026-10-20',
      checklist: ['原步骤'],
    },
  ])
  await page.goto('/adventure')
  await page.getByRole('button', { name: '未来', exact: true }).click()
  const futureRow = page.locator('.adventure-task-row').filter({
    has: page.getByRole('button', { name: '明天整理装备', exact: true }),
  })
  await futureRow.locator('summary').filter({ hasText: '检查清单' }).click()
  await expect(
    futureRow.getByRole('checkbox', { name: '明天整理装备清单：原步骤' }),
  ).toBeDisabled()
  await futureRow.getByLabel('明天整理装备的更多操作').click()
  await futureRow.getByRole('button', { name: '修改安排与清单' }).click()
  await page.getByLabel('检查清单').fill('新步骤')
  await page.getByRole('button', { name: '保存安排' }).click()
  await expect(
    futureRow.getByRole('checkbox', { name: '明天整理装备清单：新步骤' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByRole('checkbox', { name: '完成任务 运动计划' }).check()
  const cycleCard = page.locator('.adventure-cycle-row').filter({
    has: page.getByRole('button', { name: '运动计划', exact: true }),
  })
  await cycleCard.getByLabel('运动计划的更多操作').click()
  await cycleCard.getByRole('button', { name: '暂停周期任务' }).click()
  await page.getByRole('button', { name: '确认暂停' }).click()
  const currentRow = page.locator('.adventure-task-row').filter({
    has: page.getByRole('button', { name: '运动计划', exact: true }),
  })
  await currentRow.locator('summary').filter({ hasText: '检查清单' }).click()
  await expect(
    currentRow.getByRole('checkbox', { name: '运动计划清单：准备装备' }),
  ).toBeDisabled()
  await expect(
    currentRow.getByRole('checkbox', { name: '撤销任务 运动计划' }),
  ).toBeEnabled()
  await currentRow
    .getByRole('checkbox', { name: '撤销任务 运动计划' })
    .uncheck()
  await expect(page.getByText('行动与目标待结算 +0 XP')).toBeVisible()
  await cycleCard.getByLabel('运动计划的更多操作').click()
  await cycleCard.getByRole('button', { name: '恢复周期任务' }).click()
  await page.getByRole('button', { name: '确认恢复' }).click()
  await cycleCard.getByLabel('运动计划的更多操作').click()
  await cycleCard.getByRole('button', { name: '修改重复规则' }).click()
  await page.getByLabel('新规则生效日期').fill('2026-11-25')
  await page.getByLabel('重复频率').selectOption('weekly')
  await page.getByRole('checkbox', { name: '周一' }).check()
  await expect(page.getByText('原安排 31 次 → 新安排 4 次')).toBeVisible()
  await expect(page.getByText('首个受影响任务月 · 第 2 月')).toBeVisible()
  const table = page.getByRole('table', { name: '任务月数值对照（仅预估）' })
  await expect(table.getByRole('row', { name: '计划次数 30 9' })).toBeVisible()
  await expect(
    page.getByText('原任务月：2026-11-19 → 2026-12-19'),
  ).toBeVisible()
  await page.screenshot({
    path: '.cache/adventure-rule-preview.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '未来', exact: true }).click()
  await page.getByLabel('查看任务日期').fill('2026-11-26')
  await expect(
    page.getByRole('button', { name: '旧规则已实体化安排', exact: true }),
  ).toBeVisible()
})

test('归档前逐项展示待结算影响，详情关联返回原目标并保留桌面与窄屏布局', async ({
  page,
  context,
}) => {
  test.setTimeout(30000)
  const server = await adventureFixture(context)
  const main = server.seed([
    { type: 'createContainer', kind: 'main', name: '健康' },
  ]).entityId!
  const goal = server.seed([
    {
      type: 'createGoal',
      containerId: main,
      title: '完成五公里',
      standard: '实际跑完五公里',
    },
  ]).entityId!
  server.seed([{ type: 'focusGoal', id: goal, focused: true }])
  const task = server.seed([
    {
      type: 'createTask',
      goalId: goal,
      title: '今日轻松跑',
      date: '2026-10-19',
      checklist: ['热身', '拉伸'],
    },
  ]).entityId!
  server.seed([
    { type: 'completeTask', id: task },
    {
      type: 'createTask',
      goalId: goal,
      title: '明日回顾',
      date: '2026-10-20',
      checklist: [],
    },
    {
      type: 'createTask',
      goalId: goal,
      title: '两月后复盘',
      date: '2026-12-19',
      checklist: [],
    },
  ])
  await page.goto('/adventure')
  await page.screenshot({
    path: '.cache/adventure-overview-desktop.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByRole('button', { name: '完成五公里', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '今日轻松跑', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '完成五公里' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('健康的更多操作').click()
  await page.getByRole('button', { name: '归档主线' }).click()
  const impact = page.getByRole('region', { name: '归档影响明细' })
  await expect(impact).toContainText('关联 1 个目标')
  await expect(impact).toContainText('将停止 2 项一次性任务')
  await impact.getByText('查看全部一次性安排').click()
  await expect(impact).toContainText('两月后复盘 · 2026-12-19')
  await expect(impact).toContainText('保留待结算：1 次已完成行动')
  await expect(impact).toContainText('今日轻松跑')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '冒险概览', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('heading', { name: '当前焦点 1 个' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: '.cache/adventure-overview-mobile.png',
    fullPage: true,
  })
})

test('从统一入口创建支线、目标及未来每周周期任务，结束日期和计划正确且不能提前额外完成', async ({
  page,
  context,
}) => {
  await adventureFixture(context)
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '主线 / 支线', exact: true }).click()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('类型', { exact: true })).toBeFocused()
  await page.getByLabel('类型', { exact: true }).selectOption('side')
  await page.getByLabel('名称', { exact: true }).fill('摄影探索')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '目标', exact: true }).click()
  await expect(page.getByLabel('所属主线或支线')).toHaveValue('')
  await page
    .getByLabel('所属主线或支线')
    .selectOption({ label: '摄影探索 支线' })
  await page.getByLabel('目标名称').fill('完成摄影练习')
  await page.getByLabel('完成标准').fill('拍出一组完整照片')
  await page.getByRole('button', { name: '创建目标', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(page.getByLabel('所属目标')).toHaveValue('')
  await page
    .getByLabel('所属目标')
    .selectOption({ label: '摄影探索 支线 · 完成摄影练习 目标' })
  await page.getByLabel('任务类型').selectOption('cycle')
  await page.getByLabel('任务名称').fill('每周拍摄')
  await page.getByLabel('开始日期').fill('2026-10-20')
  await page.getByLabel('重复频率').selectOption('weekly')
  await page.getByRole('checkbox', { name: '周二' }).check()
  await page.getByRole('checkbox', { name: '周四' }).check()
  await page.getByLabel('结束日期').fill('2026-11-20')
  await page.getByLabel('检查清单').fill('准备设备\n完成拍摄\n整理照片')
  await expect(page.getByRole('dialog')).toContainText('2026-10-20、2026-10-22')
  await page.getByRole('button', { name: '安排任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  const cycleCard = page.locator('.adventure-cycle-row').filter({
    has: page.getByRole('button', { name: '每周拍摄', exact: true }),
  })
  await cycleCard.getByLabel('每周拍摄的更多操作').click()
  await expect(
    cycleCard.getByRole('button', { name: '记录额外完成' }),
  ).toBeDisabled()
  await cycleCard.getByLabel('每周拍摄的更多操作').click()
  await cycleCard.getByRole('button', { name: '每周拍摄', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('计划 10 次')
  await expect(page.getByRole('dialog')).toContainText('至 2026-11-20（含）')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '未来', exact: true }).click()
  await expect(page.locator('.adventure-task-row')).toHaveCount(2)
  await expect(
    page.getByRole('checkbox', { name: '完成任务 每周拍摄' }).first(),
  ).toBeDisabled()
  const firstTask = page.locator('.adventure-task-row').first()
  await firstTask.getByLabel('每周拍摄的更多操作').click()
  await firstTask.getByRole('button', { name: '修改安排与清单' }).click()
  await expect(page.getByLabel('执行日期')).toHaveValue('2026-10-20')
  await expect(page.getByLabel('检查清单')).toHaveValue(
    '准备设备\n完成拍摄\n整理照片',
  )
  await page.getByRole('button', { name: '取消', exact: true }).click()
})
