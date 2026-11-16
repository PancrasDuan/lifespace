import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Locator } from '@playwright/test'
import { test, expect, type Page } from './authenticated-test'
import { initial, parent, future, today, recurringFixture } from './adventure-recurring-fixture'

const output = process.env.TASK_DATE_EVIDENCE_DIR || '.cache/211-date-picker'
const editor = (page: Page) => page.locator('.adventure-dialog').filter({ has: page.getByLabel('任务名称', { exact: true }) })
async function capture(page: Page, name: string) {
  await mkdir(output, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
}

// Run the same gestures against the actual unified form and the legacy editor.
async function exercisePicker(page: Page, form: Locator, label: string, original: string, screenshot: string) {
  const date = form.getByLabel(label, { exact: true })
  const trigger = form.getByRole('button', { name: `选择${label}`, exact: true })
  const picker = page.getByRole('dialog', { name: `选择${label}`, exact: true })
  await expect(date).toHaveValue(original)
  await capture(page, `${screenshot}-closed`)
  // This click reproduces #211 before the fix: the custom calendar never opens.
  await date.click({ position: { x: 16, y: 18 } })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('region', { name: `${label}日历` })).toBeVisible()
  await capture(page, `${screenshot}-calendar`)
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(form).toBeVisible()
  await expect(trigger).toBeFocused()

  // Real click on the horizontal area to the right of the native segments.
  const bar = form.locator('.lp-time-control')
  const dateBox = (await date.boundingBox())!, barBox = (await bar.boundingBox())!
  const start = dateBox.x + dateBox.width - barBox.x, end = barBox.width - 44
  expect(end).toBeGreaterThan(start)
  await bar.click({ position: { x: (start + end) / 2, y: barBox.height / 2 } })
  await expect(picker).toBeVisible()
  await picker.getByLabel('显示月份', { exact: true }).fill('2099-06')
  await picker.getByRole('button', { name: '2099-06-18', exact: true }).click()
  await expect(date).toHaveValue(original)
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(date).toHaveValue(original)
  await expect(trigger).toBeFocused()

  await trigger.locator('svg').click()
  await expect(picker).toBeVisible()
  await picker.getByLabel('显示月份', { exact: true }).fill('2026-11')
  await expect(picker.getByRole('button', { name: '2026-11-14', exact: true })).toBeDisabled()
  await expect(picker.getByRole('button', { name: today, exact: true })).toBeEnabled()
  await picker.getByRole('button', { name: '关闭日期选择', exact: true }).click()

  await date.fill('2099-06-15')
  // en-US segments: month, day, year; type real digits into the day segment.
  await date.click({ position: { x: 16, y: 18 } })
  await date.press('ArrowRight')
  await date.press('6')
  await expect(date).toHaveValue('2099-06-06')
  await expect(picker.getByLabel('显示月份', { exact: true })).toHaveValue('2099-06')
  await expect(picker.getByRole('button', { name: '2099-06-06', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await date.press('ArrowLeft')
  await date.press('ArrowUp')
  await expect(date).toHaveValue('2099-06-07')
  await expect(picker.getByRole('button', { name: '2099-06-07', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await picker.getByRole('button', { name: '2099-06-18', exact: true }).click()
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(date).toHaveValue('2099-06-07')
  // Keyboard entry, focus trap, Escape and return to the icon all stay in the editor.
  await trigger.press('Enter')
  await expect(picker).toBeFocused()
  await expect(picker).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('button', { name: '关闭日期选择', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(picker.getByRole('button', { name: '确认日期', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('button', { name: '关闭日期选择', exact: true })).toBeFocused()
  await picker.getByRole('button', { name: '2099-06-19', exact: true }).click()
  await picker.getByRole('button', { name: '确认日期', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(date).toHaveValue('2099-06-19')
  await expect(trigger).toBeFocused()
  await expect(form.getByLabel('任务名称', { exact: true })).toHaveValue(/.+/)
  expect(await form.locator('label label').count()).toBe(0)
}

test.use({ locale: 'en-US' })
for (const width of [1440, 390]) {
  test(`${width}px 旧一次性编辑保持日期手势与原可访问名称`, async ({ page, context }) => {
    test.setTimeout(45000)
    const fixture = await recurringFixture(context)
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/adventure')
    const row = page.locator('.today-task-record').filter({ hasText: '出门散步三十分钟' })
    await row.getByRole('button', { name: '编辑任务', exact: true }).click()
    await exercisePicker(page, editor(page), '执行日期', today, `legacy-${width}`)
    await editor(page).getByRole('button', { name: '取消', exact: true }).click()
    expect(fixture.envelopes).toEqual([])
  })

  for (const kind of ['once', 'recurring'] as const) test(`${width}px 新建${kind}复用原日历且确认取消不丢草稿`, async ({ page, context }) => {
    test.setTimeout(45000)
    const fixture = await recurringFixture(context)
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/adventure')
    await capture(page, `surroundings-${kind}-${width}`)
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    const form = editor(page)
    if (kind === 'once') await form.getByRole('button', { name: '一次性任务', exact: true }).click()
    await form.getByLabel('任务名称', { exact: true }).fill('合成日期回归行动')
    await form.getByLabel('任务说明', { exact: true }).fill('保留表单草稿')
    await form.getByLabel('任务归属').selectOption(initial.workspace.goals[1].id)
    await exercisePicker(page, form, kind === 'once' ? '计划日期' : '开始日期', today, `create-${kind}-${width}`)
    await expect(form.getByLabel('任务说明')).toHaveValue('保留表单草稿')
    await form.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(form).toHaveCount(0)
    expect(fixture.envelopes).toHaveLength(1)
    expect(fixture.envelopes[0].command).toMatchObject({ type: kind === 'once' ? 'createTask' : 'createRecurringTask',
      title: '合成日期回归行动', description: '保留表单草稿', destination: initial.workspace.goals[1].id,
      ...(kind === 'once' ? { plannedOn: '2099-06-19' } : { startOn: '2099-06-19', today }) })
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    await form.getByLabel('任务名称', { exact: true }).fill('取消整个新建草稿')
    await form.getByRole('button', { name: '取消', exact: true }).click()
    await expect(form).toHaveCount(0)
    expect(fixture.envelopes).toHaveLength(1)
  })

  test(`${width}px 未开始周期编辑保留草稿与日期能力，开始后只读`, async ({ page, context }) => {
    test.setTimeout(45000)
    const fixture = await recurringFixture(context)
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/adventure')
    while (!await page.getByRole('button', { name: `选择日期 ${future.startOn}`, exact: true }).count()) await page.getByRole('button', { name: '下一周', exact: true }).click()
    await page.getByRole('button', { name: `选择日期 ${future.startOn}`, exact: true }).click()
    await page.getByRole('button', { name: future.title, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '编辑任务', exact: true }).click()
    const form = editor(page)
    await form.getByLabel('每期次数').fill('7')
    await exercisePicker(page, form, '开始日期', future.startOn, `edit-unstarted-${width}`)
    await expect(form.getByLabel('每期次数')).toHaveValue('7')
    await form.getByRole('button', { name: '取消', exact: true }).click()
    expect(fixture.envelopes).toEqual([])
    await page.getByRole('button', { name: future.title, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '编辑任务', exact: true }).click()
    await expect(form.getByLabel('开始日期', { exact: true })).toHaveValue(future.startOn)
    await form.getByLabel('每期次数').fill('7')
    await form.getByRole('button', { name: '选择开始日期', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择开始日期', exact: true })
    await picker.getByRole('button', { name: '2026-12-02', exact: true }).click()
    await picker.getByRole('button', { name: '确认日期', exact: true }).click()
    await form.getByRole('button', { name: '保存任务', exact: true }).click()
    await expect(form).toHaveCount(0)
    expect(fixture.envelopes[0].command).toMatchObject({ type: 'editRecurringTask', id: future.id, startOn: '2026-12-02', requiredCount: 7, today })
    await page.getByRole('button', { name: '回到今天', exact: true }).click()
    await page.getByRole('button', { name: parent.title, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '编辑任务', exact: true }).click()
    await expect(editor(page).locator('input[type=date]')).toHaveCount(0)
    await expect(editor(page).locator('time')).toHaveAttribute('datetime', parent.startOn)
    await expect(editor(page).getByLabel('开始日期不可修改')).toBeVisible()
    await capture(page, `edit-started-${width}`)
    await editor(page).getByRole('button', { name: '保存任务', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    expect(fixture.envelopes).toHaveLength(2)
    expect(fixture.envelopes[1].command).not.toHaveProperty('startOn')
  })
}

test('新表单拒绝过去与超上限日期，日历导航不能越过9999年', async ({ page, context }) => {
  const fixture = await recurringFixture(context)
  await page.goto('/adventure')
  await page.getByRole('button', { name: '新建行动', exact: true }).click()
  const form = editor(page), date = form.getByLabel('开始日期', { exact: true })
  await form.getByLabel('任务名称', { exact: true }).fill('边界合成任务')
  await expect(date).toHaveAttribute('min', today)
  await expect(date).toHaveAttribute('max', '9999-12-31')
  for (const value of ['2026-11-14', '10000-01-01']) {
    await date.fill(value)
    await form.getByRole('button', { name: '创建任务', exact: true }).click()
    expect(fixture.envelopes).toEqual([])
    expect(await date.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false)
  }
  await date.fill('9999-12-31')
  await form.getByRole('button', { name: '选择开始日期', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择开始日期', exact: true })
  await expect(picker.getByRole('button', { name: '下个月', exact: true })).toBeDisabled()
  await picker.getByLabel('显示月份', { exact: true }).fill('10000-01')
  await expect(picker.getByLabel('显示月份', { exact: true })).toHaveValue('9999-12')
  await picker.getByRole('button', { name: '确认日期', exact: true }).click()
  await form.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(fixture.envelopes[0].command).toMatchObject({ startOn: '9999-12-31' })
})

test('旧逾期一次性编辑只允许原过去日期例外', async ({ page, context }) => {
  const supplied = structuredClone(initial)
  supplied.workspace.tasks[0] = { ...supplied.workspace.tasks[0], plannedOn: '2026-11-12', overdue: true }
  const fixture = await recurringFixture(context, supplied)
  await page.goto('/adventure')
  const row = page.locator('.today-task-record').filter({ hasText: '出门散步三十分钟' })
  await row.getByRole('button', { name: '编辑任务', exact: true }).click()
  const form = editor(page), date = form.getByLabel('执行日期', { exact: true })
  await form.getByRole('button', { name: '选择执行日期', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择执行日期', exact: true })
  await expect(picker.getByRole('button', { name: '2026-11-12', exact: true })).toBeEnabled()
  await expect(picker.getByRole('button', { name: '2026-11-13', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await date.fill('2026-11-13')
  await form.getByRole('button', { name: '保存任务', exact: true }).click()
  expect(fixture.envelopes).toEqual([])
  await date.fill('2026-11-12')
  await form.getByRole('button', { name: '保存任务', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(fixture.envelopes[0].command).toMatchObject({ plannedOn: '2026-11-12' })
})

for (const width of [1440, 390]) test(`${width}px 快速重开日历后旧关闭回焦不能夺走焦点`, async ({ page, context }) => {
  await recurringFixture(context)
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
  await page.goto('/adventure')
  await page.getByRole('article', { name: '任务：出门散步三十分钟', exact: true }).getByRole('button', { name: '编辑任务', exact: true }).click()
  const trigger = editor(page).getByRole('button', { name: '选择执行日期', exact: true })
  const picker = page.getByRole('dialog', { name: '选择执行日期', exact: true })
  await trigger.click(); await expect(picker).toBeVisible()
  // Model a delayed browser animation frame: close, then reopen before the old
  // focus-return callback runs. Exercise the real control/event handlers.
  await page.evaluate(() => {
    const native = window.requestAnimationFrame
    const pending: FrameRequestCallback[] = []
    window.requestAnimationFrame = callback => { pending.push(callback); return pending.length }
    ;(window as Window & { flushDateFocus?: () => void }).flushDateFocus = () => {
      window.requestAnimationFrame = native
      for (const callback of pending) callback(performance.now())
      delete (window as Window & { flushDateFocus?: () => void }).flushDateFocus
    }
  })
  try {
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await trigger.press('Enter')
    await expect(picker).toBeVisible()
    await page.evaluate(() => (window as Window & { flushDateFocus?: () => void }).flushDateFocus?.())
    await expect(picker).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  } finally {
    await page.evaluate(() => (window as Window & { flushDateFocus?: () => void }).flushDateFocus?.())
  }
})


test.describe('narrow touch date control', () => {
  test.use({ hasTouch: true })
  test('390x520 tap and cancel preserve date; reopening and Escape restore focus', async ({ page, context }) => {
    await recurringFixture(context)
    await page.setViewportSize({ width: 390, height: 520 })
    await page.goto('/adventure')
    await page.getByRole('article', { name: '任务：出门散步三十分钟', exact: true }).getByRole('button', { name: '编辑任务', exact: true }).tap()
    const form = editor(page), date = form.getByLabel('执行日期', { exact: true })
    const trigger = form.getByRole('button', { name: '选择执行日期', exact: true })
    const picker = page.getByRole('dialog', { name: '选择执行日期', exact: true })
    await trigger.tap(); await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: '2026-11-17', exact: true }).tap()
    const folder = 'docs/evidence/token-integration'; await mkdir(folder, { recursive: true })
    const state = await page.evaluate(() => ({ scrollY, touch: navigator.maxTouchPoints > 0 }))
    await page.screenshot({ path: folder + '/date-picker-touch.png' })
    await writeFile(folder + '/date-picker-touch.png.json', JSON.stringify({ viewport: page.viewportSize(), fullPage: false, ...state, source: 'src/adventure/TaskDateField.tsx', sourceSha256: createHash('sha256').update(await readFile('src/adventure/TaskDateField.tsx')).digest('hex') }, null, 2) + '\n')
    await picker.getByRole('button', { name: '取消', exact: true }).tap()
    await expect(date).toHaveValue(today)
    await trigger.tap(); await expect(picker).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0); await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
