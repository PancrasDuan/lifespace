import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createServer as httpServer, type Server } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { once } from 'node:events'
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHmac, randomBytes } from 'node:crypto'
import { Agent, buildConnector, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
// @ts-expect-error pg is confined to the isolated Node harness.
import pg from 'pg'
import app from '../../worker/index'
import { Store } from '../../tools/token-collector/store'
import { scan } from '../../tools/token-collector/collector'
import { startRegistration, claimRegistration, uploadPending, request, endpoint } from '../../tools/token-collector/transport'
import { syntheticCodexLog } from '../fixtures/token-usage/synthetic'
import { type TokenUsageSnapshot } from '../../src/shared/token-usage-contract'
import { withTokenBrowser } from '../support/token-browser'
import { expect as browserExpect } from '@playwright/test'
import { captureTokenPage, captureTokenViewport } from '../support/capture-token-page'

const close = (s?: Server) => s ? new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()) }) : undefined
const listen = async (server: Server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return (server.address() as { port: number }).port }
const token = (value: object) => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(value)
  return head + '.' + createHmac('sha256', process.env.TOKEN_TEST_JWT_SECRET!).update(head).digest('base64url')
}
describe.skipIf(!process.env.TOKEN_DB_URL)('collector actual Worker HTTPS gateway + PostgREST + PostgreSQL + SQLite + Tokscale', () => {
  let db: any, worker: Server, gateway: Server, state: string, home: string, root: string, store: Store, workerUrl: string, gatewayUrl: string
  const previousDispatcher = getGlobalDispatcher()
  let dispatcher: Agent
  let dropUpload = false, uploadCalls = 0, heartbeatCalls = 0, hadCorrectHeaders = false
  const owner = '00000000-0000-4000-8000-000000000213', device = 'synthetic-device-213-e2e'
  const serviceKey = randomBytes(32).toString('base64url'), publishableKey = 'sb_publishable_' + randomBytes(12).toString('base64url')
  const browserToken = () => token({ sub: owner, session_id: '00000000-0000-4000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 3600 })
  const browser = async (path: string, body: unknown) => {
    const response = await fetch(workerUrl + '/api/token/registrations/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + browserToken() }, body: JSON.stringify(body) })
    expect(response.status).toBe(200); return response.json() as Promise<any>
  }
  beforeAll(async () => {
    if (!process.env.TOKEN_DB_RPC_URL || !process.env.TOKEN_TEST_TLS_CERT) throw new Error('collector integration requires the real PostgREST/TLS harness')
    process.umask(0o077)
    db = new pg.Client({ connectionString: process.env.TOKEN_DB_URL }); await db.connect()
    await db.query('truncate token_private.models,token_private.rollups,token_private.registrations,token_private.devices,token_private.rate_limits cascade')
    gateway = httpsServer({ key: await readFile(process.env.TOKEN_TEST_TLS_KEY!), cert: await readFile(process.env.TOKEN_TEST_TLS_CERT) }, async (req, res) => {
      try {
        if (req.url === '/auth/v1/user') {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: owner, email: 'collector@example.com', email_confirmed_at: '2026-11-16', is_anonymous: false })); return
        }
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(c)
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (req.headers.apikey === serviceKey) headers.Authorization = 'Bearer ' + token({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })
        if (req.headers['x-lifespace-device-token']) headers['x-lifespace-device-token'] = String(req.headers['x-lifespace-device-token'])
        if (req.url?.endsWith('/token_usage_upload')) { uploadCalls++; hadCorrectHeaders ||= req.headers.apikey === publishableKey && Boolean(req.headers['x-lifespace-device-token']) && !req.headers.authorization }
        if (req.url?.endsWith('/token_usage_heartbeat')) heartbeatCalls++
        const response = await fetch(process.env.TOKEN_DB_RPC_URL! + req.url!.replace('/rest/v1', ''), { method: 'POST', headers, body: Buffer.concat(chunks) })
        const responseBody = await response.text()
        if (dropUpload && req.url?.endsWith('/token_usage_upload') && response.ok) { dropUpload = false; res.destroy(); return }
        res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(responseBody)
      } catch { res.writeHead(503); res.end('{}') }
    })
    const gatewayPort = await listen(gateway)
    gatewayUrl = 'https://127.0.0.1'
    // Route the standard HTTPS test origin to its random local port at the TCP
    // connector only. Every request still executes real TLS/HTTP/PostgREST;
    // production Worker URL validation and TLS verification remain unchanged.
    const connector = buildConnector({ ca: await readFile(process.env.TOKEN_TEST_TLS_CERT) })
    dispatcher = new Agent({ connect(options, callback) { connector({ ...options, ...(options.protocol === 'https:' && options.hostname === '127.0.0.1' ? { port: String(gatewayPort) } : {}) }, callback) } })
    setGlobalDispatcher(dispatcher)
    const bindings = { SUPABASE_URL: gatewayUrl, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: serviceKey, AUTH_ALLOWED_EMAILS: 'collector@example.com' }
    worker = httpServer(async (req, res) => {
      try {
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(c)
        const response = await app.request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}) }, bindings)
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
      } catch { res.writeHead(503); res.end('{}') }
    })
    workerUrl = `http://127.0.0.1:${await listen(worker)}`
    root = await mkdtemp(join(tmpdir(), 'token-collector-integration-')); state = join(root, 'state'); home = join(root, 'home')
    await mkdir(join(home, '.codex/sessions'), { recursive: true })
    await writeFile(join(home, '.codex/sessions/source.jsonl'), syntheticCodexLog())
    store = await Store.open(state)
    store.set('config', { deviceId: device, server: workerUrl + '/', sourceHome: home, hours: 3, loopback: true })
  }, 15000)
  afterAll(async () => { store?.close(); setGlobalDispatcher(previousDispatcher); await dispatcher?.close(); await close(worker); await close(gateway); await db?.end(); if (root) await rm(root, { recursive: true, force: true }) })
  test('real registration/browser approval and lost claim retry retain same credential; actual CLI accounting matches PG', async () => {
    const display = await startRegistration(store, store.config(), 'synthetic-host', 'linux')
    expect(display.url).toBe(workerUrl + '/token/devices/confirm')
    const inspected = await browser('inspect', { code: display.code })
    expect(inspected.deviceId).toBe(device)
    await browser('decide', { code: display.code, requestId: inspected.requestId, approve: true, replaceExisting: false })
    const registration = store.get('registration') as { requestId: string; claimSecret: string }
    // Persisted claim at DB/Worker, discarded by a crashing terminal before save.
    const lost = await request(new URL(workerUrl + '/api/token/registrations/claim'), JSON.stringify({ requestId: registration.requestId, claimSecret: registration.claimSecret })) as any
    await db.query("update token_private.registrations set polled_at=now()-interval '6 seconds'")
    expect(await claimRegistration(store)).toEqual({ status: 'claimed' })
    expect(store.credential()!.uploadToken).toBe(lost.uploadToken); expect(store.credential()!.generation).toBe(lost.generation)
    expect((await scan(store, state, { offline: true })).blockedDates).toEqual([])
    expect(await uploadPending(store, 'synthetic-renamed')).toMatchObject({ uploaded: 2, pending: 0, heartbeat: true })
    expect(hadCorrectHeaders).toBe(true)
    const rows = (await db.query('select date::text,metrics from token_private.rollups order by date')).rows
    expect(rows.map((r: any) => [r.date, r.metrics.total])).toEqual([['2026-11-14', 130], ['2026-11-15', 650]])
    const before = uploadCalls, heartbeats = heartbeatCalls
    await scan(store, state, { offline: true }); await uploadPending(store, 'synthetic-renamed')
    expect(uploadCalls).toBe(before); expect(heartbeatCalls).toBe(heartbeats + 1)
    expect((await db.query('select hostname,sync_hours from token_private.devices')).rows[0]).toMatchObject({ hostname: 'synthetic-renamed', sync_hours: 3 })
  })
  test('persisted upload with lost HTTP receipt survives close/reopen and retries exact JSON; offline backoff retains queue', async () => {
    const base = JSON.parse(String(store.db.prepare("select snapshot from rollups where date='2026-11-15'").get()!.snapshot)) as TokenUsageSnapshot
    base.content.metrics = { input: 90, output: 0, total: 90 }
    base.content.models = { coverage: 'complete', items: [{ modelId: 'new-model', providerId: null, metrics: base.content.metrics, cost: base.content.cost }] }
    store.saveScan(await store.prepareSnapshots([base]), [], new Set(), [])
    const original = store.tasks()[0].body; dropUpload = true
    expect((await uploadPending(store, 'synthetic')).pending).toBe(1)
    expect((await db.query("select metrics from token_private.rollups where date='2026-11-15'")).rows[0].metrics.total).toBe(90)
    store.close(); store = await Store.open(state)
    expect(store.tasks()[0].body).toBe(original)
    expect(await uploadPending(store, 'synthetic', Date.now() + 10000)).toMatchObject({ uploaded: 1, pending: 0 })
    expect((await db.query("select item from token_private.models where date='2026-11-15'")).rows.map((r: any) => r.item.modelId)).toEqual(['new-model'])
    const current = store.credential()!
    store.set('credential', { ...current, upload: { ...current.upload, url: 'http://127.0.0.1:1/rest/v1/rpc/token_usage_upload' } })
    base.content.metrics = { input: 80, output: 0, total: 80 }; base.content.models.items[0].metrics = base.content.metrics
    store.saveScan(await store.prepareSnapshots([base]), [], new Set(), [])
    expect(await uploadPending(store, 'synthetic')).toMatchObject({ uploaded: 0, pending: 1, heartbeat: false })
    store.set('credential', current)
    expect(await uploadPending(store, 'synthetic', Date.now() + 10000)).toMatchObject({ uploaded: 1, pending: 0 })
  })
  test('new generation after browser-approved rebind rejects old token/queue and republishes latest from version 1', async () => {
    const old = store.credential()!
    const display = await startRegistration(store, store.config(), 'synthetic-clone-review', 'linux')
    const inspected = await browser('inspect', { code: display.code }); expect(inspected.replacesExisting).toBe(true)
    const denied = await fetch(workerUrl + '/api/token/registrations/decide', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + browserToken() }, body: JSON.stringify({ code: display.code, requestId: inspected.requestId, approve: true, replaceExisting: false }) })
    expect(denied.status).toBe(409)
    await browser('decide', { code: display.code, requestId: inspected.requestId, approve: true, replaceExisting: true })
    await claimRegistration(store)
    expect(store.credential()!.generation).toBe('2'); expect(store.tasks().every(t => t.version === '1' && t.generation === '2')).toBe(true)
    const stale = store.tasks()[0]
    await expect(request(endpoint(old.upload.url), stale.body, { apikey: publishableKey, 'X-LifeSpace-Device-Token': old.uploadToken })).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
    expect(await uploadPending(store, 'synthetic')).toMatchObject({ uploaded: 2, pending: 0 })
    expect((await db.query('select distinct generation::text from token_private.rollups')).rows).toEqual([{ generation: '2' }])
  })
  test('real PostgreSQL never sees a newer same-key snapshot overtake its backed-off predecessor', async () => {
    const base = JSON.parse(String(store.db.prepare("select snapshot from rollups where date='2026-11-15'").get()!.snapshot)) as TokenUsageSnapshot
    base.content.metrics = { input: 81, output: 0, total: 81 }; base.content.models.items[0].metrics = base.content.metrics
    store.saveScan(await store.prepareSnapshots([base]), [], new Set(), [])
    const now = Date.now(); store.retry(store.tasks()[0], 'NETWORK_UNCONFIRMED', now)
    base.content.metrics = { input: 82, output: 0, total: 82 }; base.content.models.items[0].metrics = base.content.metrics
    store.saveScan(await store.prepareSnapshots([base]), [], new Set(), [])
    const calls = uploadCalls
    expect(await uploadPending(store, 'synthetic', now + 1)).toMatchObject({ uploaded: 0, pending: 2, heartbeat: true })
    expect(uploadCalls).toBe(calls)
    expect(await uploadPending(store, 'synthetic', now + 10000)).toMatchObject({ uploaded: 2, pending: 0, heartbeat: true })
    expect((await db.query("select metrics from token_private.rollups where date='2026-11-15'")).rows[0].metrics.total).toBe(82)
  })
  test('actual React browser approves replacement; collector claims/uploads; summary reaches DOM; disable preserves history', async () => {
    const display = await startRegistration(store, store.config(), 'synthetic-browser-device', 'linux')
    const oldCode = (await db.query("select code from token_private.registrations where status='claimed' order by created_at limit 1")).rows[0].code
    await withTokenBrowser(workerUrl, browserToken(), owner, async page => {
      await page.clock.setFixedTime(new Date('2026-11-15T06:32:00Z'))
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
      await page.goto('/token/devices/confirm?code=' + display.code)
      await page.getByRole('button', { name: '核对设备', exact: true }).click()
      await browserExpect(page.getByText('synthetic-browser-device', { exact: true })).toBeVisible()
      await browserExpect(page.getByRole('button', { name: '批准连接' })).toBeDisabled()
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: '批准连接' }).click()
      await browserExpect(page.getByRole('status')).toContainText('已批准')
      expect(await claimRegistration(store)).toEqual({ status: 'claimed' })
      expect((await browser('inspect', { code: oldCode })).superseded).toBe(true)
      await scan(store, state, { offline: true })
      expect(await uploadPending(store, 'synthetic-browser-device')).toMatchObject({ pending: 0, heartbeat: true })
      const summaryResponse = await fetch(workerUrl + '/api/token/summary?startDate=2026-10-17&endDate=2026-11-15', { headers: { Authorization: 'Bearer ' + browserToken() } })
      const summary = await summaryResponse.json() as { totals: { metrics: { total: number } } }
      expect(summary.totals.metrics.total).toBe(780)
      await page.goto('/token')
      await browserExpect(page.getByTestId('token-total')).toHaveAttribute('data-value', '780')
      await browserExpect(page.locator('.device-text strong')).toHaveText('synthetic-browser-device')
      await page.getByRole('button', { name: '日统计明细' }).click()
      await browserExpect(page.getByText('已读取 2 份设备日汇总', { exact: false })).toBeVisible()
      await captureTokenViewport(page, '.impeccable/review/token-frontend/real-chain.png')
      await captureTokenPage(page, '.impeccable/review/token-frontend/real-chain-full.png')
      await page.getByRole('button', { name: '停用', exact: true }).click()
      await page.getByRole('button', { name: '确认停用', exact: true }).click()
      await browserExpect(page.getByText('已停用', { exact: true })).toBeVisible()
      await browserExpect(page.getByTestId('token-total')).toHaveAttribute('data-value', '780')
      expect((await db.query('select enabled from token_private.devices where device_id=$1', [device])).rows[0].enabled).toBe(false)
      expect((await browser('inspect', { code: display.code })).superseded).toBe(true)
      expect((await db.query('select count(*)::int n from token_private.rollups')).rows[0].n).toBe(2)
      expect((await uploadPending(store, 'synthetic-browser-device')).heartbeat).toBe(false)
      expect(errors).toEqual([])
    })
  }, 90000)
})
