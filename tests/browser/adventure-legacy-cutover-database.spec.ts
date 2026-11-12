import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openCutoverDatabase } from '../support/old-cutover-pg.mjs'
import { test, expect } from './authenticated-test'
import { planningDatabase } from '../support/planning-database'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import newWorker from '../../worker/index'

const oldRoot = process.env.OLD_ADVENTURE_DIST
const port = Number(process.env.OLD_CUTOVER_PG_PORT)
const rpc = process.env.ADVENTURE_LOCAL_RPC_URL
const owner = '00000000-0000-4000-8000-000000000174'
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const authorization = `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: owner, exp: 4102444800 })}.local-test`
const env = { SUPABASE_URL: 'https://planning-local-test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_local-test-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only', AUTH_ALLOWED_EMAILS: 'legacy@example.invalid' }

test('真实旧构建跨切换保留未知封套并由受控人员核对', async ({ page, context }) => {
  test.setTimeout(90000)
  test.skip(!oldRoot || !port || !process.env.OLD_CUTOVER_MARKER || !rpc, '需要专用临时旧库与旧构建')
  if (!oldRoot || !port || !process.env.OLD_CUTOVER_MARKER || !rpc || new URL(rpc).hostname !== '127.0.0.1') throw new Error('requires the isolated legacy cutover runner')
  const { default: oldWorker } = await import(/* @vite-ignore */ pathToFileURL(join(oldRoot, 'dist/lifespace/index.js')).href)
  const database = planningDatabase('legacy@example.invalid')
  const nativeFetch = globalThis.fetch
  database.install({ browserOwner: owner })
  const installedFetch = globalThis.fetch
  let denyIdentity = false, identityChecks = 0, retryAuthorization = 'Bearer expired'
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (denyIdentity && url.pathname === '/auth/v1/user') {
      identityChecks++
      return Response.json({ id: owner, email: 'revoked@example.invalid', email_confirmed_at: '2026-10-20', is_anonymous: false })
    }
    return installedFetch(input, init)
  }
  const sql = await openCutoverDatabase(port)
  const marker = await sql.query('select id from cutover_test.marker')
  if (marker.rows.length !== 1 || marker.rows[0].id !== process.env.OLD_CUTOVER_MARKER) throw new Error('isolated cluster marker mismatch')
  let phase: 'old' | 'maintenance' | 'new' = 'old', dropFirst = true
  const envelopes: Array<{ requestId: string; expectedVersion: number; command: unknown }> = []
  try {
    await context.route('**/adventure**', async (route, request) => {
      if (new URL(request.url()).pathname !== '/adventure') return route.fallback()
      await route.fulfill({ path: join(oldRoot, 'dist/client/index.html'), contentType: 'text/html' })
    })
    await context.route('**/assets/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop()!
      if (!/^[\w.-]+$/.test(name)) throw new Error('unexpected asset name')
      await route.fulfill({ path: join(oldRoot, 'dist/client/assets', name) })
    })
    await context.route('**/api/adventure**', async route => {
      const req = route.request(), url = new URL(req.url())
      const body = req.method() === 'GET' ? undefined : req.postDataJSON()
      if (url.pathname === '/api/adventure/commands') envelopes.push(body)
      // Only this handshake is a simulated future transition Worker; the
      // actual pre-transition Worker is used for the old command and reads.
      if (phase === 'old' && url.pathname === '/api/adventure/compatibility') {
        return route.fulfill({ json: { model: 'legacy', version: 1, receiptLookup: false, legacyRetry: true }, headers: { 'Cache-Control': 'no-store' } })
      }
      if (phase === 'maintenance') {
        return route.fulfill({ status: 503, json: { error: { code: 'MAINTENANCE', message: '切换中，结果可能未知，请不要刷新或重新提交，请联系维护人员核对。' } } })
      }
      const response = phase === 'new'
        ? await newWorker.request(url.pathname + url.search, { method: req.method(), headers: { Authorization: retryAuthorization, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
        : await oldWorker.request(url.pathname + url.search, { method: req.method(), headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
      if (phase === 'old' && url.pathname === '/api/adventure/commands' && dropFirst) {
        expect(response.status).toBe(200)
        dropFirst = false
        await route.abort('failed')
      } else await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
    await page.goto('/adventure')
    await page.getByRole('button', { name: '新建行动', exact: true }).click()
    await page.getByLabel('任务名称', { exact: true }).fill('旧请求已提交')
    await page.getByRole('button', { name: '创建任务', exact: true }).click()
    await expect(page.getByText(/尚不能确认是否保存/)).toBeVisible()
    expect(envelopes).toHaveLength(1)
    const original = envelopes[0]
    const before = await sql.query('select revision, total_xp from public.adventure_accounts where owner_id=$1', [owner])
    expect(before.rows[0]).toMatchObject({ revision: '1', total_xp: '0' })
    const oldCapability = await page.evaluate(async () => (await fetch('/api/adventure/compatibility')).json())
    expect(oldCapability).toEqual({ model: 'legacy', version: 1, receiptLookup: false, legacyRetry: true })
    // This router is a synthetic barrier, not a deployed edge or bypass check.
    phase = 'maintenance'
    await page.getByRole('button', { name: '安全重试同一次操作' }).click()
    await expect(page.getByText('切换中，结果可能未知，请不要刷新或重新提交，请联系维护人员核对。')).toBeVisible()
    expect(envelopes[1]).toEqual(original)
    expect(await page.evaluate(async () => (await fetch('/api/adventure')).status)).toBe(503)
    expect((await sql.query('select revision, total_xp from public.adventure_accounts where owner_id=$1', [owner])).rows).toEqual(before.rows)
    await sql.query(await readFile('db/adventure/migrations/20261111000000_goal_categories.sql', 'utf8'))
    phase = 'new'
    const switchedRetry = await database.request(owner, '/api/adventure/legacy-retry', original, null)
    expect(switchedRetry.status).toBe(503)
    expect(await switchedRetry.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' } })
    expect((await sql.query('select revision, total_xp from public.adventure_accounts where owner_id=$1', [owner])).rows).toEqual(before.rows)
    await page.getByRole('button', { name: '安全重试同一次操作' }).click()
    await expect(page.getByText('旧页面操作结果可能未知，请不要刷新或重新提交，请联系维护人员核对。')).toBeVisible()
    await expect(page.getByRole('button', { name: '安全重试同一次操作' })).toBeVisible()
    expect(envelopes[2]).toEqual(original)
    retryAuthorization = authorization
    denyIdentity = true
    await page.getByRole('button', { name: '安全重试同一次操作' }).click()
    await expect(page.getByText('旧页面操作结果可能未知，请不要刷新或重新提交，请联系维护人员核对。')).toBeVisible()
    expect(envelopes[3]).toEqual(original)
    expect(identityChecks).toBe(0)
    const currentDenied = await newWorker.request('/api/adventure/commands', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'X-Adventure-Client-Version': 'goal-categories-1' }, body: JSON.stringify(original) }, env)
    expect(currentDenied.status).toBe(403)
    expect(identityChecks).toBe(1)
    denyIdentity = false
    // Operator lookup is owner + requestId + the original PostgreSQL digest;
    // this query is read-only and never executes an absent command.
    const saved = await sql.query(`select command_hash=encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex') matches
      from public.adventure_events where owner_id=$1 and request_id=$2`, [owner, original.requestId, JSON.stringify(original.command)])
    expect(saved.rows).toEqual([{ matches: true }])
    const different = await sql.query(`select command_hash=encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex') matches
      from public.adventure_events where owner_id=$1 and request_id=$2`, [owner, original.requestId, JSON.stringify({ type: 'createTask', title: '不同的内容' })])
    expect(different.rows).toEqual([{ matches: false }])
    const absent = await sql.query('select 1 from public.adventure_events where owner_id=$1 and request_id=$2', [owner, 'no-such-receipt'])
    expect(absent.rows).toEqual([])
    const absentStatus = await page.evaluate(async envelope => (await fetch('/api/adventure/commands', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...envelope, requestId: 'no-such-receipt' }),
    })).status, original)
    expect(absentStatus).toBe(503)
    expect((await sql.query('select 1 from public.adventure_events where owner_id=$1 and request_id=$2', [owner, 'no-such-receipt'])).rows).toEqual([])
    const wrongOwner = await sql.query('select 1 from public.adventure_events where owner_id=$1 and request_id=$2', ['00000000-0000-4000-8000-000000000175', original.requestId])
    expect(wrongOwner.rows).toEqual([])
    for (const role of ['anon', 'authenticated']) {
      await sql.query('begin')
      try {
        await sql.query(`set local role ${role}`)
        await expect(sql.query('select command_hash from public.adventure_events where owner_id=$1 and request_id=$2', [owner, original.requestId])).rejects.toMatchObject({ code: '42501' })
      } finally { await sql.query('rollback') }
    }
    const permissions = await sql.query(`select has_function_privilege('anon','public.adventure_receipt_lookup(uuid,text,jsonb)','execute') anon,
      has_function_privilege('authenticated','public.adventure_receipt_lookup(uuid,text,jsonb)','execute') authenticated,
      has_function_privilege('service_role','public.adventure_receipt_lookup(uuid,text,jsonb)','execute') service`)
    expect(permissions.rows).toEqual([{ anon: false, authenticated: false, service: true }])
    const phantom = '00000000-0000-4000-8000-000000000175'
    await sql.query('begin')
    try {
      await sql.query('set local role service_role')
      await expect(sql.query('select public.adventure_receipt_lookup($1,$2,$3)', [phantom, original.requestId, JSON.stringify(original.command)])).rejects.toMatchObject({ message: 'RECEIPT_UNKNOWN' })
    } finally { await sql.query('rollback') }
    expect((await sql.query('select 1 from public.adventure_accounts where owner_id=$1', [phantom])).rows).toEqual([])
    expect((await sql.query('select revision, total_xp from public.adventure_accounts where owner_id=$1', [owner])).rows).toEqual(before.rows)
    const directReceipt = (await sql.query('select public.adventure_receipt_lookup($1,$2,$3) receipt', [owner, original.requestId, JSON.stringify(original.command)])).rows[0].receipt
    const parsedReceipt = planningReceiptSchema.safeParse(directReceipt)
    expect(parsedReceipt.success, parsedReceipt.success ? '' : parsedReceipt.error.message).toBe(true)
    // Migration's NOTIFY is asynchronous. Recovery must wait for the new
    // read-only function; production still needs an external maintenance gate.
    await expect.poll(async () => (await nativeFetch(`${rpc}/rpc/adventure_receipt_lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner, p_request_id: original.requestId, p_command: original.command }),
    })).status).toBe(200)
    const replay = await database.request(owner, '/api/adventure/receipts/lookup', original, null)
    expect(replay.status, await replay.clone().text()).toBe(200)
    expect(replay.headers.get('x-lifespace-adventure-model')).toBe('goal-categories-1')
    expect(replay.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(await replay.json())).not.toMatch(/mainline|主线/i)
    expect((await sql.query('select count(*)::int n from public.adventure_tasks where owner_id=$1 and title=$2', [owner, '旧请求已提交'])).rows[0].n).toBe(1)
    const date = (await sql.query("select (clock_timestamp() at time zone 'Asia/Shanghai')::date::text today")).rows[0].today
    const inFlight = { requestId: 'cutover-inflight-001', expectedVersion: Number(before.rows[0].revision), command: { type: 'createTask', title: '在途行动', description: '', plannedOn: date, destination: '' } }
    await sql.query('begin')
    try {
      await sql.query('select public.adventure_planning_command($1,$2,$3,$4)', [owner, inFlight.requestId, inFlight.expectedVersion, JSON.stringify(inFlight.command)])
      const notCommitted = await database.request(owner, '/api/adventure/receipts/lookup', inFlight, null)
      expect(notCommitted.status).toBe(404)
      expect(await notCommitted.json()).toMatchObject({ error: { code: 'RECEIPT_UNKNOWN' } })
      await sql.query('commit')
    } catch (error) { await sql.query('rollback'); throw error }
    expect((await database.request(owner, '/api/adventure/receipts/lookup', inFlight, null)).status).toBe(200)
    // An unrelated authentication revalidation can still unmount the old UI
    // and discard its in-memory pending envelope; the 503 gate cannot stop it.
    await context.route('**/api/auth/me', route => route.fulfill({ status: 403, json: { error: { code: 'AUTH_DENIED', message: '无权访问' } } }))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.adventure-page')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '安全重试同一次操作' })).toHaveCount(0)
    await context.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.com' } } }))
    // The legacy page itself masks GET failures; this remains a release blocker.
    await page.reload()
    await expect(page.getByText('暂时无法读取人生冒险，请检查连接后重新读取。')).toBeVisible()
    await page.goto('/adventure?mainlineId=00000000-0000-4000-8000-000000000054')
    await expect(page.getByText('暂时无法读取人生冒险，请检查连接后重新读取。')).toBeVisible()
  } finally {
    database.restore()
    await sql.end()
  }
})
