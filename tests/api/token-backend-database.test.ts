import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
// @ts-expect-error pg is only used by the isolated Node database harness.
import pg from 'pg'
import app from '../../worker/index'
import { randomBytes, createHash } from 'node:crypto'
import { canonicalTokenUsageContent, tokenUsageContentHash, tokenUsageContentSchema, tokenUsageSnapshotSchema } from '../../src/shared/token-usage-contract'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const owner = '00000000-0000-4000-8000-000000000209'
const device = 'synthetic-device-209'
const token = randomBytes(32).toString('base64url')
const unknownCost = { currency: 'USD', coverage: 'unknown', apiEstimate: null }
const content = (n = 130): any => ({ metrics: { input: n - 30, output: 30, total: n, cacheRead: 20, reasoning: 10 }, cost: unknownCost, models: { coverage: 'missing', items: [] } })
const snapshot = (n = 130, revision = '1', day = '2026-11-15'): any => ({ identity: { deviceId: device, date: day, agent: 'codex' }, content: content(n), metadata: { schemaVersion: 1, statisticsVersion: 'synthetic-1', tool: { name: 'tokscale', version: '4.23.0' }, priceVersion: null, scannedAt: '2026-11-15T03:00:00Z', snapshotVersion: revision } })

describe.skipIf(!process.env.TOKEN_DB_URL)('Token real PostgreSQL', () => {
  let db: any
  const sql = async (text: string, values: unknown[] = []) => (await db.query(text, values)).rows
  const upload = async (s: any, generation = '1', digest?: string) => (await sql('select public.token_usage_upload($1,$2,$3) result', [generation, s, digest ?? await tokenUsageContentHash(s.content)]))[0].result
  const reset = async () => {
    await sql('reset role'); await sql('rollback'); await sql('truncate token_private.models,token_private.rollups,token_private.registrations,token_private.devices,token_private.rate_limits cascade')
    await sql('insert into token_private.devices(device_id,hostname,platform,owner_id,generation,token_hash) values($1,$2,$3,$4,1,decode($5,\'hex\'))', [device, 'synthetic-host', 'linux', owner, hash(token)])
    await sql("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-lifespace-device-token': token })])
  }
  beforeAll(async () => { db = new pg.Client({ connectionString: process.env.TOKEN_DB_URL }); await db.connect() })
  afterAll(async () => { await db?.end() })
  test('fixed canonical vector; missing/null/zero, Unicode UTF16 model ordering and decimals agree with JS', async () => {
    await reset()
    const models = ['\uE000', '😀', '模型', 'a\n"', 'é', 'é', null].map(modelId => ({ modelId, providerId: null, metrics: {}, cost: { currency: 'USD', apiEstimate: '0.00014199999999999998', coverage: 'unverified' } }))
    const vectors = [content(), ...[{}, { input: null }, { input: 0 }, { input: -0 }].map(metrics => ({ ...content(), metrics })),
      { ...content(), models: { coverage: 'partial', items: models } },
      { ...content(), cost: { currency: 'USD', actual: '999999999999999999999.0000000001', coverage: 'complete' } }]
    for (const v of vectors) {
      const row = (await sql("select token_private.canonical($1::jsonb) bytes,encode(extensions.digest(convert_to(token_private.canonical($1::jsonb),'UTF8'),'sha256'),'hex') hash", [v]))[0]
      expect(row.bytes).toBe(canonicalTokenUsageContent(v)); expect(row.hash).toBe(await tokenUsageContentHash(v))
      await sql('select token_private.content($1)', [v])
    }
    expect(await tokenUsageContentHash(content())).toBe('d79d902b2a4f9729093d471e38a8dfac7c4fc755f0569502e454eecb84d5d526')
  })
  test('database strictly validates content against shared schema, including complete model totals and costs', async () => {
    const valid = [content(), { metrics: {}, cost: { currency: 'USD', coverage: 'unknown' }, models: { coverage: 'complete', items: [{ modelId: null, providerId: null, metrics: {}, cost: { currency: 'USD', coverage: 'unknown' } }] } }]
    const invalid = [
      { ...content(), rawPath: '/synthetic' }, { ...content(), metrics: { total: -1 } }, { ...content(), metrics: { input: 1, output: 2, total: 4 } },
      { ...content(), metrics: { input: 10, cacheRead: 11 } }, { ...content(), metrics: { input: 9007199254740992 } }, { ...content(), metrics: { input: '1' } },
      { ...content(), cost: { currency: 'USD', apiEstimate: '0', coverage: 'unknown' } }, { ...content(), cost: { currency: 'USD', actual: '1.0', coverage: 'complete' } },
      { ...content(), cost: { currency: 'USD', actual: '1', apiEstimate: null, coverage: 'complete' } }, { ...content(), cost: { currency: 'USD', actual: 1, coverage: 'complete' } },
      { ...content(), models: { coverage: 'complete', items: [] } },
      { ...content(), models: { coverage: 'partial', items: [{ modelId: null, providerId: null, metrics: {}, cost: unknownCost }, { modelId: null, providerId: null, metrics: {}, cost: unknownCost }] } },
    ]
    for (const v of valid) { expect(tokenUsageContentSchema.safeParse(v).success).toBe(true); await sql('select token_private.content($1)', [v]) }
    for (const v of invalid) { expect(tokenUsageContentSchema.safeParse(v).success).toBe(false); await expect(sql('select token_private.content($1)', [v])).rejects.toThrow() }
  })
  test('A → B → A watermarks, duplicate lost receipts, conflict, stale and same-content metadata updates', async () => {
    await reset()
    expect(await upload(snapshot())).toMatchObject({ persisted: true, snapshotVersion: '1', result: 'replaced' })
    expect(await upload(snapshot())).toMatchObject({ result: 'duplicate' })
    await upload(snapshot(200, '2')); await upload(snapshot(130, '3'))
    await expect(upload(snapshot(200, '2'))).rejects.toThrow('TOKEN_STALE_VERSION')
    await expect(upload(snapshot(200, '3'))).rejects.toThrow('TOKEN_VERSION_CONFLICT')
    const before = (await sql('select content_updated_at from token_private.rollups'))[0]
    const newer = snapshot(130, '4'); newer.metadata.statisticsVersion = 'synthetic-2'
    expect(await upload(newer)).toMatchObject({ result: 'unchanged', generation: '1', date: '2026-11-15', agent: 'codex', deviceId: device, snapshotVersion: '4' })
    const after = (await sql('select content_updated_at,revision::text,metadata from token_private.rollups'))[0]
    expect(after.content_updated_at).toEqual(before.content_updated_at); expect(after.revision).toBe('4'); expect(after.metadata.statisticsVersion).toBe('synthetic-2')
    await expect(upload(snapshot(130, '5'), '1', 'a'.repeat(64))).rejects.toThrow('TOKEN_HASH_MISMATCH')
    expect((await sql('select revision::text from token_private.rollups'))[0].revision).toBe('4')
  })
  test('numeric decreases, model reassignment/removal and rollback preserve a single complete unit', async () => {
    await reset()
    const s = snapshot(); s.content.models = { coverage: 'complete', items: [{ modelId: 'old-model', providerId: 'label', metrics: s.content.metrics, cost: s.content.cost }] }
    await upload(s)
    const lower = snapshot(100, '2'); lower.content.models = { coverage: 'complete', items: [{ modelId: 'new-model', providerId: null, metrics: lower.content.metrics, cost: lower.content.cost }] }
    await upload(lower)
    expect((await sql('select item from token_private.models')).map((r: any) => r.item.modelId)).toEqual(['new-model'])
    await sql('begin'); await upload(snapshot(130, '3')); await sql('rollback')
    expect((await sql('select revision::text,metrics from token_private.rollups'))[0]).toMatchObject({ revision: '2', metrics: { total: 100 } })
    expect((await sql('select count(*)::int n from token_private.models'))[0].n).toBe(1)
    await upload(snapshot(100, '3')); expect((await sql('select count(*)::int n from token_private.models'))[0].n).toBe(0)
  })
  test('valid upload token never substitutes for a required generation, including NULL through direct RPC', async () => {
    await reset()
    for(const generation of [null, '', '01', '0', '2']) {
      await expect(sql('select public.token_usage_upload($1,$2,$3)',[generation,snapshot(),await tokenUsageContentHash(content())])).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
      await expect(sql('select public.token_usage_heartbeat($1,$2,$3,$4)',[device,generation,'host',1])).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
    }
    expect((await sql('select count(*)::int n from token_private.rollups'))[0].n).toBe(0)
    expect((await sql('select last_received_at from token_private.devices'))[0].last_received_at).toBeNull()
  })
  test('mid-function model failure rolls back main, child replacement and receive watermark together', async () => {
    await reset(); await upload(snapshot())
    const before = (await sql('select revision::text,received_at from token_private.rollups'))[0]
    await sql("create function token_private.synthetic_reject() returns trigger language plpgsql set search_path='' as $$begin raise exception 'synthetic transaction failure'; end$$; create trigger synthetic_reject before insert on token_private.models for each row execute function token_private.synthetic_reject()")
    const s=snapshot(100,'2'); s.content.models={coverage:'complete',items:[{modelId:'synthetic-failure',providerId:null,metrics:s.content.metrics,cost:s.content.cost}]}
    try { await expect(upload(s)).rejects.toThrow('synthetic transaction failure') }
    finally { await sql('drop trigger synthetic_reject on token_private.models; drop function token_private.synthetic_reject()') }
    expect((await sql('select revision::text,received_at from token_private.rollups'))[0]).toEqual(before)
    expect((await sql('select count(*)::int n from token_private.models'))[0].n).toBe(0)
  })
  test('anon/authenticated cannot read tables/helpers or privileged APIs; token cannot cross devices or survive revocation', async () => {
    await reset()
    for (const role of ['anon', 'authenticated']) {
      await sql(`set role ${role}`)
      for (const q of ['select * from token_private.devices', "select token_private.canonical('{}')", "select public.token_devices_query('')", `select public.token_device_disable('${device}')`]) await expect(sql(q)).rejects.toThrow('permission denied')
      await sql('reset role')
    }
    await sql('set role anon'); await upload(snapshot()); await expect(upload({ ...snapshot(), identity: { ...snapshot().identity, deviceId: 'different-device' } })).rejects.toThrow('TOKEN_CREDENTIAL_INVALID'); await sql('reset role')
    await sql('select public.token_device_disable($1)', [device]); await expect(upload(snapshot(130, '2'))).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
  })
  test('heartbeat updates server receive time/cadence, shared read filters model rows without adding main totals', async () => {
    await reset()
    const s = snapshot(); s.content.models = { coverage: 'partial', items: [{ modelId: 'model-a', providerId: 'provider-label', metrics: { input: 20 }, cost: unknownCost }] }; await upload(s)
    await sql('select public.token_usage_heartbeat($1,$2,$3,$4)', [device, '1', 'renamed-host', 3])
    const all = (await sql('select public.token_dashboard_query($1) r', [{ startDate: '2026-01-01', endDate: '2026-12-31' }]))[0].r
    expect(all.rows).toHaveLength(1); expect(all.rows[0].metrics.total).toBe(130)
    const filtered = (await sql('select public.token_dashboard_query($1) r', [{ startDate: '2026-01-01', endDate: '2026-12-31', modelKey: '"model-a"' }]))[0].r
    expect(filtered.scope).toBe('model'); expect(filtered.rows[0].metrics).toEqual({ input: 20 }); expect(filtered.rows[0].cost.coverage).toBe('unknown')
    const devices = (await sql("select public.token_devices_query('') r"))[0].r
    expect(devices.devices[0]).toMatchObject({ hostname: 'renamed-host', syncHours: 3, overdue: false }); expect(JSON.stringify(devices)).not.toContain(token)
    await sql("update token_private.devices set last_received_at=now()-interval '7 hours'"); expect((await sql("select public.token_devices_query('') r"))[0].r.devices[0].overdue).toBe(true)
  })
  test('registration approval, polling, denied/expired/misuse, concurrent claims and recovery/rotation', async () => {
    await reset()
    const register = async (id: string, code: string, credential: string) => (await sql('select public.token_registration_start($1,$2,$3,$4,$5,$6,$7,$8) r', [id, code, hash(credential), hash(credential+'upload'), device, 'same-host', 'linux', hash(id)]))[0].r
    const id = '00000000-0000-4000-8000-000000000210', credential = randomBytes(32).toString('base64url')
    await register(id, 'ABCDEFGH', credential)
    expect((await sql('select public.token_registration_claim($1,$2) r', [id, hash('ABCDEFGH')]))[0].r.error).toBe('TOKEN_NOT_FOUND')
    expect((await sql('select public.token_registration_decide($1,$2,$3,true,false) r', [owner, id, 'ABCDEFGH']))[0].r.error).toBe('TOKEN_REBIND_REQUIRED')
    await sql('select public.token_registration_decide($1,$2,$3,true,true)', [owner, id, 'ABCDEFGH'])
    const first = (await sql('select public.token_registration_claim($1,$2) r', [id, hash(credential)]))[0].r
    expect(first).toMatchObject({ status: 'claimed', generation: '2' })
    expect((await sql('select public.token_registration_claim($1,$2) r', [id, hash(credential)]))[0].r.status).toBe('slow_down')
    await sql("update token_private.registrations set polled_at=now()-interval '6 seconds'")
    const recovered = (await sql('select public.token_registration_claim($1,$2) r', [id, hash(credential)]))[0].r
    expect(recovered).toEqual(first); await expect(upload(snapshot())).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
    await sql('select public.token_device_disable($1)', [device]); await sql("update token_private.registrations set polled_at=now()-interval '6 seconds'")
    expect((await sql('select public.token_registration_claim($1,$2) r', [id, hash(credential)]))[0].r.status).toBe('superseded')
    await sql("update token_private.registrations set expires_at=now()-interval '1 second'")
    expect((await sql('select public.token_registration_claim($1,$2) r', [id, hash(credential)]))[0].r.status).toBe('expired')
    const denied = '00000000-0000-4000-8000-000000000211'
    await register(denied, 'BCDEFGHJ', credential); await sql('select public.token_registration_decide($1,$2,$3,false,false)', [owner, denied, 'BCDEFGHJ'])
    expect((await sql('select public.token_registration_claim($1,$2) r', [denied, hash(credential)]))[0].r.status).toBe('denied')
  })
  test('summary totals/daily/models preserve partial costs and model filtering; pages have no omissions', async () => {
    await reset()
    const s = snapshot(); s.content.models = { coverage: 'partial', items: [{ modelId: null, providerId: null, metrics: { input: 20 }, cost: { currency: 'USD', apiEstimate: '0.0000000000000000001', coverage: 'unverified' } }] }
    await upload(s)
    const query = { startDate: '2026-01-01', endDate: '2026-12-31' }
    const total = (await sql('select public.token_dashboard_summary($1) r', [query]))[0].r
    expect(total.totals.metrics.total).toBe(130); expect(total.totals.costs).toEqual([unknownCost]); expect(total.daily).toHaveLength(1)
    const model = (await sql('select public.token_dashboard_summary($1) r', [{ ...query, modelKey: 'null' }]))[0].r
    expect(model.totals.metrics).toEqual({ input: 20 }); expect(model.models).toHaveLength(1)
    expect(model.totals.costs[0]).toMatchObject({ apiEstimate: '0.0000000000000000001', coverage: 'unverified' })
    await sql("insert into token_private.rollups select device_id,date '2026-01-01'+i,agent,generation,revision,content_hash,metrics,cost,model_coverage,metadata,content_updated_at,received_at from token_private.rollups cross join generate_series(0,250) i")
    const first = (await sql('select public.token_dashboard_query($1) r', [query]))[0].r
    expect(first.rows).toHaveLength(250); expect(first.nextCursor).toBeTruthy()
    const second = (await sql('select public.token_dashboard_query($1) r', [{ ...query, after: first.nextCursor }]))[0].r
    expect(second.rows).toHaveLength(2); expect(second.nextCursor).toBeNull()
    const keys = [...first.rows, ...second.rows].map(r => r.date); expect(new Set(keys).size).toBe(252)
  })
  test('summary row bound follows the full filter, so device/Agent/model narrowing recovers a broad year', { timeout: 30000 }, async () => {
    await reset(); const s=snapshot(); s.content.models={coverage:'partial',items:[{modelId:'target-model',providerId:null,metrics:{input:20},cost:unknownCost}]}; await upload(s)
    await sql("insert into token_private.devices select 'synthetic-bulk',hostname,platform,owner_id,enabled,generation,extensions.digest('synthetic-bulk-token','sha256'),created_at,bound_at,last_received_at,sync_hours from token_private.devices")
    await sql("insert into token_private.rollups select 'synthetic-bulk',date,'bulk-'||i,generation,revision,content_hash,metrics,cost,model_coverage,metadata,content_updated_at,received_at from token_private.rollups cross join generate_series(1,100001) i")
    const year={startDate:'2026-01-01',endDate:'2026-12-31'}
    await expect(sql('select public.token_dashboard_summary($1)',[year])).rejects.toThrow('TOKEN_QUERY_TOO_BROAD')
    for(const filter of [{deviceId:device},{agent:'codex'},{modelKey:'"target-model"'}]) {
      const result=(await sql('select public.token_dashboard_summary($1) r',[{...year,...filter}]))[0].r
      expect(result.rowCount).toBe(1)
    }
  })
  test('concurrent claims serialize, rate limits persist, rotation can restart revisions without permitting old credentials', async () => {
    await reset()
    const id = '00000000-0000-4000-8000-000000000212', claim = randomBytes(32).toString('base64url'), replacement = randomBytes(32).toString('base64url')
    await upload(snapshot(130, '900'))
    await sql('select public.token_registration_start($1,$2,$3,$4,$5,$6,$7,$8)', [id, 'CDEFGHJK', hash(claim), hash(replacement), device, 'host', 'linux', hash('ip')])
    await sql('select public.token_registration_decide($1,$2,$3,true,true)', [owner,id,'CDEFGHJK'])
    const clients: any[] = await Promise.all([1,2].map(async () => { const c = new pg.Client({ connectionString: process.env.TOKEN_DB_URL }); await c.connect(); return c }))
    try {
      const results = await Promise.all(clients.map(c => c.query('select public.token_registration_claim($1,$2) r', [id,hash(claim)])))
      expect(results.map(r => r.rows[0].r.status).sort()).toEqual(['claimed','slow_down'])
      expect((await sql('select generation::text from token_private.devices'))[0].generation).toBe('2')
    } finally { await Promise.all(clients.map(c => c.end())) }
    await expect(upload(snapshot(130,'901'))).rejects.toThrow('TOKEN_CREDENTIAL_INVALID')
    await sql("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-lifespace-device-token': replacement })])
    expect(await upload(snapshot(130,'1'),'2')).toMatchObject({ generation: '2', snapshotVersion: '1', result: 'unchanged' })
    let result
    for(let i=0;i<61;i++) result=(await sql('select public.token_registration_inspect($1,$2) r',[owner,'CDEFGHJK']))[0].r
    expect(result.error).toBe('TOKEN_RATE_LIMIT')
    expect((await sql("select count(*)::int n from token_private.rate_limits where count>60"))[0].n).toBe(1)
  })
  test('Worker registration through real DB, browser admission, lost claim response and independent upload credential', async () => {
    await reset(); await sql('delete from token_private.devices')
    const bindings = { SUPABASE_URL: 'https://synthetic-token.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', SUPABASE_SECRET_KEY: 'synthetic-server-only', AUTH_ALLOWED_EMAILS: 'demo@example.com' }
    const claims = { sub: owner, session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 }
    const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
    const auth = { Authorization: `Bearer ${encode({})}.${encode(claims)}.synthetic` }
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if(String(url).endsWith('/auth/v1/user')) return Response.json({ id: owner, email: 'demo@example.com', email_confirmed_at: '2026-11-15', is_anonymous: false })
      const name=String(url).split('/').at(-1)!, params=JSON.parse(String(init?.body)), keys=Object.keys(params)
      if(!/^token_[a-z_]+$/.test(name) || keys.some(k=>!/^p_[a-z_]+$/.test(k))) throw new Error('unexpected test RPC')
      await sql('set role service_role')
      try { return Response.json((await sql(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) r`,Object.values(params)))[0].r) }
      finally { await sql('reset role') }
    })
    const post = (path: string, body: unknown, browser=false) => app.request('/api/token/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(browser?auth:{})},body:JSON.stringify(body)},bindings)
    try {
      const response=await post('registrations/start',{deviceId:device,hostname:'synthetic-host',platform:'linux'}); expect(response.status).toBe(201)
      const registration=await response.json() as any
      expect((await post('registrations/inspect',{code:registration.code})).status).toBe(401)
      expect((await post('registrations/inspect',{code:registration.code},true)).status).toBe(200)
      expect((await post('registrations/decide',{requestId:registration.requestId,code:registration.code,approve:true,replaceExisting:false},true)).status).toBe(200)
      const claim={requestId:registration.requestId,claimSecret:registration.claimSecret}
      const first=await (await post('registrations/claim',claim)).json() as any
      expect(first.status).toBe('claimed')
      await sql("update token_private.registrations set polled_at=now()-interval '6 seconds'")
      expect(await (await post('registrations/claim',claim)).json()).toEqual(first)
      const stored=(await sql('select * from token_private.registrations'))[0]
      expect(stored.token_hash.toString('hex')).toBe(hash(first.uploadToken)); expect(JSON.stringify(stored)).not.toContain(first.uploadToken)
      await sql("select set_config('request.headers',$1,false)",[JSON.stringify({'x-lifespace-device-token':first.uploadToken})])
      expect(await upload(snapshot())).toMatchObject({persisted:true,generation:'1'})
    } finally { vi.unstubAllGlobals() }
  })
  test('concurrent uploads serialize and never roll back newest revision', async () => {
    await reset()
    const clients: any[] = await Promise.all([1,2,3,4].map(async () => { const c = new pg.Client({ connectionString: process.env.TOKEN_DB_URL }); await c.connect(); await c.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-lifespace-device-token': token })]); return c }))
    try {
      const results = await Promise.allSettled(clients.map(async (c: any, i: number) => c.query('select public.token_usage_upload($1,$2,$3)', ['1', snapshot(130+i, String(i+1)), await tokenUsageContentHash(content(130+i))])))
      expect(results.some((r: PromiseSettledResult<unknown>) => r.status === 'fulfilled')).toBe(true)
      expect((await sql('select revision::text,metrics from token_private.rollups'))[0]).toMatchObject({ revision: '4', metrics: { total: 133 } })
    } finally { await Promise.all(clients.map((c: any) => c.end())) }
  })
  test.skipIf(!process.env.TOKEN_DB_RPC_URL)('real PostgREST custom header, anonymous direct RPC and no business read access', async () => {
    await reset()
    const url = process.env.TOKEN_DB_RPC_URL!
    const request = async (headers: Record<string,string>) => fetch(`${url}/rpc/token_usage_upload`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ p_generation: '1', p_snapshot: snapshot(), p_hash: await tokenUsageContentHash(content()) }) })
    expect((await request({})).ok).toBe(false)
    const invalidGeneration=await fetch(`${url}/rpc/token_usage_upload`,{method:'POST',headers:{'Content-Type':'application/json','X-LifeSpace-Device-Token':token},body:JSON.stringify({p_generation:null,p_snapshot:snapshot(),p_hash:await tokenUsageContentHash(content())})}); expect(invalidGeneration.ok).toBe(false)
    const response = await request({ 'X-LifeSpace-Device-Token': token }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ persisted: true, snapshotVersion: '1' })
    expect((await fetch(`${url}/rpc/token_devices_query`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LifeSpace-Device-Token': token }, body: '{}' })).ok).toBe(false)
  })
})
