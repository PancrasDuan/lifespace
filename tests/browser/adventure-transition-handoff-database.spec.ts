import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './authenticated-test'
import { planningDatabase } from '../support/planning-database'
import { openCutoverDatabase } from '../support/old-cutover-pg.mjs'
import { openRecordActions } from './adventure-record-helpers'

const oldRoot = process.env.OLD_ADVENTURE_DIST
const port = Number(process.env.OLD_CUTOVER_PG_PORT)
const rpc = process.env.ADVENTURE_LOCAL_RPC_URL
const scenario = process.env.OLD_CUTOVER_SCENARIO ?? 'task'
const firstOwner = '00000000-0000-4000-8000-000000000001'
const secondOwner = '00000000-0000-4000-8000-000000000002'
const env = { SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'handoff@example.invalid' }
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = (owner: string) => `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`

async function pending(page: import('@playwright/test').Page, owner: string) {
  return page.evaluate(async owner => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('lifespace-adventure-pending-v1', 1)
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    const value = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction('commands', 'readonly').objectStore('commands').get(owner)
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    db.close(); return value
  }, owner)
}

test('过渡版持久封套跨关闭与迁移由新构建只读接续，并隔离账户', async ({ page, context }) => {
  test.setTimeout(90000)
  test.skip(!oldRoot || !port || !process.env.OLD_CUTOVER_MARKER || !rpc, '需要专用临时旧库和两端构建')
  if (!oldRoot || !port || !process.env.OLD_CUTOVER_MARKER || !rpc || new URL(rpc).hostname !== '127.0.0.1') throw new Error('requires isolated runner')
  const { default: oldWorker } = await import(/* @vite-ignore */ pathToFileURL(join(oldRoot, 'dist/lifespace/index.js')).href)
  const { default: newWorker } = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'dist/lifespace/index.js')).href)
  const database = planningDatabase('handoff@example.invalid')
  database.install()
  const sql = await openCutoverDatabase(port)
  const marker = await sql.query('select id from cutover_test.marker')
  if (marker.rows.length !== 1 || marker.rows[0].id !== process.env.OLD_CUTOVER_MARKER) throw new Error('isolated cluster marker mismatch')
  let phase: 'legacy' | 'maintenance' | 'current' = 'legacy', activeOwner = firstOwner, lose = true
  let lookupFault: 'unknown' | 'conflict' | 'unsafe' | 'bad-cache' | 'auth' | undefined
  const oldEnvelopes: unknown[] = [], newCommands: unknown[] = [], lookups: unknown[] = []
  try {
    if (scenario === 'edit' || scenario === 'reorder') {
      let version = 0
      const seed = async (command: object) => {
        const result = await sql.query('select public.adventure_planning_command($1,$2,$3,$4::jsonb) result', [firstOwner, `seed-command-${version}`, version, JSON.stringify(command)])
        version++
        return result.rows[0].result.result.entityId as string
      }
      const destination = scenario === 'reorder' ? await seed({ type: 'createMainline', name: '接续主线' }) : ''
      await seed({ type: 'createGoal', destination, title: '待编辑目标', standards: ['完成'] })
      if (scenario === 'reorder') await seed({ type: 'createGoal', destination, title: '待排序目标', standards: ['完成'] })
    }
    await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: activeOwner, email: 'demo@example.com' } } }))
    await context.route('**/adventure**', async (route, request) => {
      if (new URL(request.url()).pathname !== '/adventure') return route.fallback()
      await route.fulfill({ path: join(phase === 'legacy' ? oldRoot : process.cwd(), 'dist/client/index.html'), contentType: 'text/html' })
    })
    await context.route('**/assets/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop()!
      if (!/^[\w.-]+$/.test(name)) throw new Error('unexpected asset name')
      await route.fulfill({ path: join(phase === 'legacy' ? oldRoot : process.cwd(), 'dist/client/assets', name) })
    })
    await context.route('**/api/adventure**', async route => {
      const request = route.request(), url = new URL(request.url())
      const body = request.method() === 'GET' ? undefined : request.postDataJSON()
      if (phase === 'maintenance') return route.fulfill({ status: 503, headers: { 'Cache-Control': 'no-store' }, json: { error: { code: 'MAINTENANCE', message: '维护中，操作结果尚未确认' } } })
      if (phase === 'legacy' && url.pathname === '/api/adventure/commands') oldEnvelopes.push(body)
      if (phase === 'current' && url.pathname === '/api/adventure/commands') newCommands.push(body)
      if (phase === 'current' && url.pathname === '/api/adventure/receipts/lookup') lookups.push(body)
      if (phase === 'current' && url.pathname === '/api/adventure/receipts/lookup' && lookupFault) {
        if (lookupFault === 'bad-cache') return route.fulfill({ headers: { 'Cache-Control': 'no-store, extension=', 'X-Lifespace-Adventure-Model': 'goal-categories-1' }, json: { version: 1, result: { entityId: firstOwner, message: '合成响应' } } })
        return route.fulfill({ status: lookupFault === 'unknown' ? 404 : lookupFault === 'auth' ? 403 : 409, json: { error: { code: lookupFault === 'unknown' ? 'RECEIPT_UNKNOWN' : lookupFault === 'unsafe' ? 'REPLAY_UNAVAILABLE' : lookupFault === 'auth' ? 'AUTH_DENIED' : 'REQUEST_ID_REUSED', message: '合成故障' } } })
      }
      const headers = { Authorization: token(activeOwner), 'Content-Type': 'application/json', ...(request.headers()['x-adventure-client-version'] ? { 'X-Adventure-Client-Version': request.headers()['x-adventure-client-version'] } : {}) }
      const worker = phase === 'legacy' ? oldWorker : newWorker
      const response = await worker.request(url.pathname + url.search, { method: request.method(), headers, body: body === undefined ? undefined : JSON.stringify(body) }, env)
      if (phase === 'legacy' && url.pathname === '/api/adventure/commands' && lose) {
        expect(response.status).toBe(200); lose = false; return route.abort('failed')
      }
      const responseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      for (const name of ['cache-control', 'x-lifespace-adventure-model', 'x-lifespace-legacy-retry']) {
        const value = response.headers.get(name); if (value) responseHeaders[name] = value
      }
      await route.fulfill({ status: response.status, headers: responseHeaders, body: await response.text() })
    })
    await page.goto(scenario === 'edit' || scenario === 'reorder' ? '/adventure?view=planning' : '/adventure')
    if (scenario === 'goal') {
      await page.getByRole('button', { name: '新建目标', exact: true }).click()
      await page.getByLabel('目标名称').fill('跨版本待决目标')
      await page.getByRole('textbox', { name: '完成标准 1', exact: true }).fill('完成')
      await page.getByRole('dialog').getByRole('button', { name: '创建目标', exact: true }).click()
    } else if (scenario === 'edit') {
      await page.getByRole('button', { name: '目标：待编辑目标', exact: true }).click()
      await openRecordActions(page.locator('.adventure-proto-goal').first())
      await page.getByRole('region', { name: '目标详情', exact: true }).getByRole('button', { name: '编辑目标' }).click()
      await page.getByLabel('目标名称').fill('跨版本已编辑目标')
      await page.getByRole('button', { name: '保存目标', exact: true }).click()
    } else if (scenario === 'reorder') {
      const card = page.getByRole('article', { name: '目标卡：待排序目标', exact: true })
      await openRecordActions(card)
      await card.getByRole('button', { name: '上移目标 待排序目标', exact: true }).click()
    } else {
      await page.getByRole('button', { name: '新建行动', exact: true }).click()
      await page.getByLabel('任务名称', { exact: true }).fill('跨版本待决行动')
      await page.getByRole('button', { name: '创建任务', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: '安全重试同一次操作' })).toBeVisible()
    expect(oldEnvelopes).toHaveLength(1)
    expect(await pending(page, firstOwner)).toEqual(oldEnvelopes[0])
    const before = await sql.query('select revision,total_xp from public.adventure_accounts where owner_id=$1', [firstOwner])
    expect(before.rows[0]).toMatchObject({ revision: scenario === 'edit' ? '2' : scenario === 'reorder' ? '4' : '1', total_xp: '0' })
    await page.evaluate(other => localStorage.setItem('test-auth-owner', other), secondOwner)
    await page.close()
    phase = 'maintenance'
    await sql.query(await readFile('db/adventure/migrations/20261111000000_goal_categories.sql', 'utf8'))
    phase = 'current'; activeOwner = secondOwner
    const other = await context.newPage()
    await other.goto('/adventure')
    await expect(other.getByRole('button', { name: '新建目标', exact: true })).toBeEnabled()
    await expect(other.getByRole('button', { name: '确认上次操作结果' })).toHaveCount(0)
    expect(await pending(other, firstOwner)).toEqual(oldEnvelopes[0])
    await other.evaluate(owner => localStorage.setItem('test-auth-owner', owner), firstOwner)
    await other.close(); activeOwner = firstOwner
    let current = await context.newPage()
    await current.goto('/adventure')
    await expect(current.getByText(/有一项操作的结果尚未确认/)).toBeVisible()
    await expect(current.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
    // Inject response failures at the synthetic proxy; none is evidence about
    // production routes or the real identity provider.
    for (const fault of ['unknown', 'conflict', 'unsafe', 'bad-cache', 'auth'] as const) {
      lookupFault = fault
      const previous = lookups.length
      await current.getByRole('button', { name: '确认上次操作结果' }).click()
      await expect.poll(() => lookups.length).toBe(previous + 1)
      if (fault === 'auth') {
        await expect(current.locator('.adventure-page')).toHaveCount(0)
        expect(await pending(current, firstOwner)).toEqual(oldEnvelopes[0])
        await current.close()
        current = await context.newPage()
        await current.goto('/adventure')
      } else {
        await expect(current.getByText(/操作结果尚未确认，请稍后再次确认/)).toBeVisible()
        expect(await pending(current, firstOwner)).toEqual(oldEnvelopes[0])
      }
      await expect(current.getByRole('button', { name: '新建目标', exact: true })).toBeDisabled()
      expect(newCommands).toEqual([])
    }
    lookupFault = undefined
    // Only the authentic Worker and isolated database can resolve the receipt.
    await current.getByRole('button', { name: '确认上次操作结果' }).click()
    await expect.poll(async () => lookups.length).toBe(6)
    expect(lookups.every(value => JSON.stringify(value) === JSON.stringify(oldEnvelopes[0]))).toBe(true)
    await expect.poll(() => pending(current, firstOwner)).toBeUndefined()
    expect(newCommands).toEqual([])
    expect((await sql.query('select revision,total_xp from public.adventure_accounts where owner_id=$1', [firstOwner])).rows).toEqual(before.rows)
    const count = scenario === 'goal'
      ? await sql.query("select count(*)::int n from public.adventure_goals where owner_id=$1 and title='跨版本待决目标'", [firstOwner])
      : scenario === 'edit'
        ? await sql.query("select count(*)::int n from public.adventure_goals where owner_id=$1 and title='跨版本已编辑目标'", [firstOwner])
        : scenario === 'reorder'
          ? await sql.query("select count(*)::int n from public.adventure_goals where owner_id=$1 and title='待排序目标'", [firstOwner])
      : await sql.query("select count(*)::int n from public.adventure_tasks where owner_id=$1 and title='跨版本待决行动'", [firstOwner])
    expect(count.rows[0].n).toBe(1)
    await current.close()
  } finally {
    database.restore(); await sql.end()
  }
})
