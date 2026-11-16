import { test, expect } from './authenticated-test'
import { emptyPlanning, planningFixture, withGoal } from './adventure-fixture'

const owner = '00000000-0000-4000-8000-000000000001'
const goal = '00000000-0000-4000-8000-000000000055'
const legacyEnvelope = { requestId: 'legacy-goal-create-001', expectedVersion: 2, command: { type: 'createGoal', destination: '', title: '旧目标', standards: ['标准'] } }
const currentEnvelope = { requestId: 'pending-recovery-224', expectedVersion: 2, command: { type: 'createGoal', title: '恢复目标', standards: ['标准'] } }
const linkedReceipt = (route: import('@playwright/test').Route, message = '已保存') => {
  const { requestId, nonce } = route.request().postDataJSON()
  return { requestId, nonce, outcome: 'confirmed' as const, receipt: { version: 3, result: { entityId: goal, message } } }
}

async function putPending(page: import('@playwright/test').Page, key: string, value: unknown) {
  await page.evaluate(async ({ key, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lifespace-adventure-pending-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('commands')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('commands', 'readwrite')
      tx.objectStore('commands').put(value, key)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  }, { key, value })
}
async function getPending(page: import('@playwright/test').Page, key: string) {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lifespace-adventure-pending-v1', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const result = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('commands', 'readonly'), request = tx.objectStore('commands').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result
  }, key)
}

test('RECEIPT_UNKNOWN 后重载的 pending 可按原封套恢复，不再永久冻结', async ({ page, context }) => {
  const fixture = await planningFixture(context)
  const retries: unknown[] = []
  await context.route('**/api/adventure/recovery', route => route.fulfill({ status: 404, json: { error: { code: 'RECEIPT_UNKNOWN', message: '未知' } } }))
  await context.route('**/api/adventure/recovery', route => {
    const { nonce, ...envelope } = route.request().postDataJSON()
    retries.push(envelope)
    fixture.show({ ...emptyPlanning, version: 3 })
    return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: {
      requestId: envelope.requestId, nonce, outcome: 'confirmed', receipt: { version: 3, result: { entityId: goal, message: '已恢复目标' } },
    } })
  })
  await page.goto('/adventure')
  await putPending(page, owner, currentEnvelope)
  await page.reload()
  await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
  await expect.poll(() => retries).toEqual([currentEnvelope])
  await expect.poll(() => getPending(page, owner)).toBeUndefined()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
  expect(fixture.envelopes).toEqual([])
})

for (const [code, stored] of [
  ['VERSION_CONFLICT', currentEnvelope], ['PLANNING_DATE_CHANGED', currentEnvelope], ['LEGACY_RECEIPT_MISSING', legacyEnvelope],
] as const) {
  test(`${code} 必须先读取事实并明确勾选，解除后重新读取且不新建 requestId`, async ({ page, context }) => {
    const fixture = await planningFixture(context, withGoal)
    let attempts = 0, reads = 0
    page.on('request', request => { if (request.method() === 'GET' && /\/api\/adventure\?/.test(request.url())) reads++ })
    await context.route('**/api/adventure/recovery', route => {
      attempts++
      const { requestId, nonce } = route.request().postDataJSON()
      return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: { requestId, nonce, outcome: 'review', code } })
    })
    await page.goto('/adventure')
    await putPending(page, owner, stored)
    await page.reload()
    await page.evaluate(() => { crypto.randomUUID = () => { throw new Error('恢复不得创建 requestId') } })
    await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
    const release = page.getByRole('button', { name: '解除本地待确认状态', exact: true })
    const checkbox = page.getByRole('checkbox', { name: '我已核对当前页面事实，确认解除本地待确认状态' })
    await expect(release).toBeDisabled()
    await expect(checkbox).toBeDisabled()
    fixture.failNextQuery()
    await page.getByRole('button', { name: '重新读取当前事实' }).click()
    await expect(page.getByText(/无法完成读取或核对本地记录/)).toBeVisible()
    await expect(release).toBeDisabled()
    await page.getByRole('button', { name: '重新读取当前事实' }).click()
    await expect(checkbox).toBeEnabled()
    await expect(release).toBeDisabled()
    expect(await getPending(page, owner)).toEqual(stored)
    await checkbox.check()
    await expect(release).toBeEnabled()
    const beforeRelease = reads
    await release.click()
    await expect.poll(() => getPending(page, owner)).toBeUndefined()
    await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
    expect(reads).toBeGreaterThan(beforeRelease)
    expect(attempts).toBe(1)
    expect(fixture.envelopes).toEqual([])
  })
}

for (const width of [1440, 390]) {
  test(`人工核对状态 ${width}px 保留既有页面且没有横向溢出`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 950 })
    await planningFixture(context, withGoal)
    await context.route('**/api/adventure/recovery', route => {
      const { requestId, nonce } = route.request().postDataJSON()
      return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: { requestId, nonce, outcome: 'review', code: 'LEGACY_RECEIPT_MISSING' } })
    })
    await page.goto('/adventure')
    await putPending(page, owner, legacyEnvelope)
    await page.reload()
    await page.getByRole('button', { name: '确认上次操作结果' }).click()
    await page.getByRole('button', { name: '重新读取当前事实' }).click()
    await expect(page.getByRole('checkbox')).toBeEnabled()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `docs/evidence/224-recovery/review-${width}.png`, fullPage: true })
  })
}

for (const failure of ['delete', 'changed', 'locked'] as const) {
  test(`人工解除遇到 ${failure} 时保留记录并撤销已核对资格`, async ({ page, context }) => {
    await planningFixture(context, withGoal)
    await context.route('**/api/adventure/recovery', route => {
      const { requestId, nonce } = route.request().postDataJSON()
      return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: { requestId, nonce, outcome: 'review', code: 'LEGACY_RECEIPT_MISSING' } })
    })
    await page.goto('/adventure')
    await putPending(page, owner, legacyEnvelope)
    await page.reload()
    await page.getByRole('button', { name: '确认上次操作结果' }).click()
    await page.getByRole('button', { name: '重新读取当前事实' }).click()
    await page.getByRole('checkbox').check()
    const replacement = { ...legacyEnvelope, requestId: 'another-pending-224' }
    if (failure === 'changed') await putPending(page, owner, replacement)
    else if (failure === 'delete') await page.evaluate(() => { IDBObjectStore.prototype.delete = () => { throw new Error('synthetic delete failure') } })
    else {
      await page.evaluate(owner => {
        const state = window as Window & { lockHeld?: boolean; releaseLock?: () => void }
        void navigator.locks.request(`lifespace-adventure-command:${owner}`, async () => {
          state.lockHeld = true
          await new Promise<void>(resolve => { state.releaseLock = resolve })
        })
      }, owner)
      await expect.poll(() => page.evaluate(() => (window as Window & { lockHeld?: boolean }).lockHeld)).toBe(true)
    }
    try {
      await page.getByRole('button', { name: '解除本地待确认状态', exact: true }).click()
      await expect(page.getByRole('checkbox')).toBeDisabled()
      expect(await getPending(page, owner)).toEqual(failure === 'changed' ? replacement : legacyEnvelope)
      await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
    } finally {
      if (failure === 'locked') await page.evaluate(() => (window as Window & { releaseLock?: () => void }).releaseLock?.())
    }
  })
}

test('新页面保留旧目标封套，在服务端恢复确认后解除冻结', async ({ page, context }) => {
  const fixture = await planningFixture(context)
  const lookups: unknown[] = []
  await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store, extension="quoted, \\"value\\""' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
  await context.route('**/api/adventure/recovery', route => {
    lookups.push(route.request().postDataJSON())
    return route.fulfill({ headers: { 'Cache-Control': 'extension="quoted, \\"value\\"", no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: linkedReceipt(route, '已创建目标') })
  })
  await page.goto('/adventure')
  await putPending(page, owner, legacyEnvelope)
  await page.reload()
  await expect(page.getByText(/有一项操作的结果尚未确认/)).toBeVisible()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
  await expect.poll(() => lookups).toEqual([{ ...legacyEnvelope, nonce: expect.stringMatching(/^[0-9a-f]{64}$/) }])
  expect(fixture.envelopes).toEqual([])
  await expect.poll(() => getPending(page, owner)).toBeUndefined()
})

for (const scenario of ['missing', 'conflict', 'unsafe', 'bad-model', 'missing-model', 'bad-cache', 'missing-cache', 'incomplete-cache', 'invalid-receipt'] as const) {
  test(`待决回执 ${scenario} 时保留封套并阻止新写入`, async ({ page, context }) => {
    const fixture = await planningFixture(context)
    let lookups = 0
    await context.route('**/api/adventure/recovery', route => {
      lookups++
      if (scenario === 'missing' || scenario === 'conflict' || scenario === 'unsafe') return route.fulfill({ status: scenario === 'missing' ? 404 : 409, json: { error: { code: scenario === 'missing' ? 'RECEIPT_UNKNOWN' : scenario === 'conflict' ? 'REQUEST_ID_REUSED' : 'REPLAY_UNAVAILABLE', message: '无法确认' } } })
      return route.fulfill({ headers: { ...(scenario === 'missing-cache' ? {} : { 'Cache-Control': scenario === 'bad-cache' ? 'x-no-store' : scenario === 'incomplete-cache' ? 'no-store, extension=' : 'no-store' }), ...(scenario === 'missing-model' ? {} : { 'X-Lifespace-Adventure-Recovery': scenario === 'bad-model' ? 'legacy' : '1' }) }, json: scenario === 'invalid-receipt' ? { version: 3, result: {} } : linkedReceipt(route, '已创建目标') })
    })
    await page.goto('/adventure')
    await putPending(page, owner, legacyEnvelope)
    await page.reload()
    await expect(page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ })).toBeVisible()
    await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
    await expect(page.getByText(/操作结果尚未确认，请稍后再次确认/)).toBeVisible()
    expect(await getPending(page, owner)).toEqual(legacyEnvelope)
    expect(lookups).toBe(1)
    expect(fixture.envelopes).toEqual([])
    await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '解除本地待确认状态', exact: true })).toHaveCount(0)
  })
}

for (const mismatch of ['requestId', 'nonce', 'previous-response'] as const) {
  test(`回执关联 ${mismatch} 不匹配时保留封套，重试使用新 nonce`, async ({ page, context }) => {
    const fixture = await planningFixture(context)
    const nonces: string[] = []
    let previous: ReturnType<typeof linkedReceipt> | undefined
    await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
    await context.route('**/api/adventure/recovery', route => {
      const current = linkedReceipt(route)
      nonces.push(current.nonce)
      const value = mismatch === 'requestId' ? { ...current, requestId: 'another-request' } : mismatch === 'nonce' ? { ...current, nonce: '0'.repeat(64) } : previous ?? { ...current, nonce: '0'.repeat(64) }
      previous = current
      return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: value })
    })
    await page.goto('/adventure')
    await putPending(page, owner, legacyEnvelope)
    await page.reload()
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
      await expect.poll(() => nonces.length).toBe(attempt + 1)
      await expect(page.getByText(/操作结果尚未确认，请稍后再次确认/)).toBeVisible()
      expect(await getPending(page, owner)).toEqual(legacyEnvelope)
    }
    expect(nonces).toHaveLength(2)
    expect(nonces[0]).not.toBe(nonces[1])
    expect(fixture.envelopes).toEqual([])
    await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  })
}

test('安全随机数不可用时保留封套并不查询', async ({ page, context }) => {
  await planningFixture(context)
  let lookups = 0
  await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
  await context.route('**/api/adventure/recovery', route => { lookups++; return route.abort() })
  await page.goto('/adventure')
  await putPending(page, owner, legacyEnvelope)
  await page.reload()
  await page.evaluate(() => { crypto.getRandomValues = () => { throw new Error('unavailable') } })
  await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
  await expect(page.getByText(/操作结果尚未确认，请稍后再次确认/)).toBeVisible()
  expect(await getPending(page, owner)).toEqual(legacyEnvelope)
  expect(lookups).toBe(0)
})

test('其他账户记录不展示、不删除且不阻止本人操作', async ({ page, context }) => {
  await planningFixture(context)
  await page.goto('/adventure')
  const other = '00000000-0000-4000-8000-000000000002'
  await putPending(page, other, legacyEnvelope)
  await page.reload()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ })).toHaveCount(0)
  expect(await getPending(page, other)).toEqual(legacyEnvelope)
})

test('损坏封套和存储失败均阻止新写入，不删除记录', async ({ page, context }) => {
  await planningFixture(context)
  await page.goto('/adventure')
  const corrupt = { requestId: 'bad', command: { type: 'createGoal' } }
  await putPending(page, owner, corrupt)
  await page.reload()
  await expect(page.getByText(/浏览器无法安全读取操作/)).toBeVisible()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  expect(await getPending(page, owner)).toEqual(corrupt)
})

test('浏览器存储不可用时停止操作而非假定没有待决记录', async ({ page, context }) => {
  await planningFixture(context)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('storage unavailable') } })
  })
  await page.goto('/adventure')
  await expect(page.getByText(/浏览器无法安全读取操作/)).toBeVisible()
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
})

test('回执已确认但删除本地封套失败时仍保持冻结', async ({ page, context }) => {
  const fixture = await planningFixture(context)
  await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
  await context.route('**/api/adventure/recovery', route => route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: linkedReceipt(route) }))
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.delete
    IDBObjectStore.prototype.delete = function (key) {
      if (localStorage.getItem('fail-pending-delete') === 'yes') throw new Error('synthetic delete failure')
      return original.call(this, key)
    }
  })
  await page.goto('/adventure')
  await putPending(page, owner, legacyEnvelope)
  await page.evaluate(() => localStorage.setItem('fail-pending-delete', 'yes'))
  await page.reload()
  await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
  await expect(page.getByText(/无法确认本地保存状态/)).toBeVisible()
  expect(await getPending(page, owner)).toEqual(legacyEnvelope)
  await expect(page.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  expect(fixture.envelopes).toEqual([])
})

for (const command of [
  { type: 'editGoal', id: goal, destination: 'independent', title: '旧目标', standards: ['标准'] },
  { type: 'reorderGoals', mainlineId: '00000000-0000-4000-8000-000000000054', id: goal, direction: 'up' },
  { type: 'migrateTask', id: goal, destination: '' },
]) {
  test(`旧 ${command.type} 封套原样进入恢复入口`, async ({ page, context }) => {
    const fixture = await planningFixture(context)
    const envelope = { requestId: `old-${command.type}-001`, expectedVersion: 3, command }
    const seen: unknown[] = []
    await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
    await context.route('**/api/adventure/recovery', route => {
      seen.push(route.request().postDataJSON())
      return route.fulfill({ headers: { 'Cache-Control': 'no-store', 'X-Lifespace-Adventure-Recovery': '1' }, json: linkedReceipt(route) })
    })
    await page.goto('/adventure')
    await putPending(page, owner, envelope)
    await page.reload()
    await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
    await expect.poll(() => seen).toEqual([{ ...envelope, nonce: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    await expect.poll(() => getPending(page, owner)).toBeUndefined()
    expect(fixture.envelopes).toEqual([])
  })
}

test('认证拒绝卸载页面时不删除待决封套', async ({ page, context }) => {
  await planningFixture(context)
  await context.route('**/api/adventure/compatibility', route => route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json: { model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false } }))
  await context.route('**/api/adventure/recovery', route => route.fulfill({ status: 403, json: { error: { code: 'AUTH_DENIED', message: '无权访问' } } }))
  await page.goto('/adventure')
  await putPending(page, owner, legacyEnvelope)
  await page.reload()
  await page.getByRole('button', { name: /安全重试同一次操作|确认上次操作结果/ }).click()
  await expect(page.locator('.adventure-page')).toHaveCount(0)
  expect(await getPending(page, owner)).toEqual(legacyEnvelope)
})

test('同账户另一页面持锁时保持冻结，锁释放后读取旧封套', async ({ page, context }) => {
  await planningFixture(context)
  await page.goto('/adventure')
  await putPending(page, owner, legacyEnvelope)
  await page.evaluate(owner => {
    const state = window as Window & { lockHeld?: boolean; releaseLock?: () => void }
    void navigator.locks.request(`lifespace-adventure-command:${owner}`, async () => {
      state.lockHeld = true
      await new Promise<void>(resolve => { state.releaseLock = resolve })
    })
  }, owner)
  await expect.poll(() => page.evaluate(() => (window as Window & { lockHeld?: boolean }).lockHeld)).toBe(true)
  const second = await context.newPage()
  await second.goto('/adventure')
  await expect(second.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as Window & { releaseLock?: () => void }).releaseLock?.())
  await expect(second.getByText(/有一项操作的结果尚未确认/)).toBeVisible()
  expect(await getPending(second, owner)).toEqual(legacyEnvelope)
  await second.close()
})
