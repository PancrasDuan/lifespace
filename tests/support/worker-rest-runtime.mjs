import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'

// The built production entry point runs in workerd. It must reach PostgREST over
// HTTP; no Hyperdrive binding is installed, so an accidental pg path fails here.
export async function verifyWorkerRest(runtimeUrl, root) {
  const target = new URL(runtimeUrl)
  let authCalls = 0
  const restCalls = []
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'lifespace-rest-test',
          modules: true,
          scriptPath: resolve(root, 'dist/lifespace/index.js'),
          compatibilityDate: '2026-10-01',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            SUPABASE_URL: 'https://worker-test.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only',
            SUPABASE_SECRET_KEY: 'sb_secret_local-test-only',
            AUTH_ALLOWED_EMAILS: 'runtime@example.invalid',
          },
          outboundService: async (request) => {
            const url = new URL(request.url)
            if (url.pathname === '/auth/v1/user') {
              const token = request.headers.get('Authorization')?.split(' ')[1]
              assert.ok(token, 'Auth request must carry the user token')
              const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
              authCalls++
              return new RuntimeResponse(
                JSON.stringify({
                  id: claims.sub,
                  email: 'runtime@example.invalid',
                  email_confirmed_at: '2026-01-01',
                  is_anonymous: false,
                }),
                { headers: { 'Content-Type': 'application/json' } }
              )
            }
            if (url.pathname.startsWith('/rest/v1/rpc/')) {
              restCalls.push(url.pathname.slice('/rest/v1/rpc/'.length))
              const destination = new URL(url.pathname.replace(/^\/rest\/v1/, ''), target)
              const headers = new Headers(request.headers)
              headers.delete('host')
              return fetch(destination, {
                method: request.method,
                headers,
                body: request.method === 'GET' ? undefined : await request.text(),
                redirect: 'manual',
              })
            }
            throw new Error(`Unexpected Worker request: ${url.pathname}`)
          },
        },
      ],
    })
  )
  const owner = crypto.randomUUID()
  const other = crypto.randomUUID()
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const request = async (path, body, identity = owner) => {
    const response = await runtime.dispatchFetch('https://worker.invalid' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${encode({ alg: 'HS256' })}.${encode({ sub: identity, session_id: identity, exp: 4102444800 })}.test`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const accountInput = { requestId: crypto.randomUUID(), name: '运行时账户', balanceCents: 1000 }
    const account = await request('/api/ledger/accounts', accountInput)
    assert.equal(account.status, 200, JSON.stringify(account.body))
    assert.deepEqual(await request('/api/ledger/accounts', accountInput), account)
    const create = {
      requestId: crypto.randomUUID(),
      direction: 'expense',
      amountCents: -100,
      occurredAt: '2026-01-01T00:00:00Z',
      accountId: account.body.accountId,
      categoryCode: 'dining',
      note: '运行时 REST',
    }
    assert.equal((await request('/api/ledger/entries', create)).status, 200)
    assert.equal((await request('/api/ledger/accounts')).body.accounts[0].balanceCents, 900)
    assert.equal(
      (await request('/api/ledger/entries', { ...create, requestId: crypto.randomUUID() }, other)).body.error.code,
      'ACCOUNT_NOT_FOUND'
    )
    const state = await request('/api/adventure')
    assert.equal(state.status, 200, JSON.stringify(state.body))
    const task = await request('/api/adventure/commands', {
      requestId: crypto.randomUUID(),
      expectedVersion: state.body.version,
      command: { type: 'createTask', title: '运行时任务', description: '', plannedOn: state.body.today, destination: '' },
    })
    assert.equal(task.status, 200, JSON.stringify(task.body))
    const complete = {
      requestId: crypto.randomUUID(),
      expectedVersion: task.body.version,
      command: { type: 'completeTask', id: task.body.result.entityId },
    }
    const done = await request('/api/adventure/commands', complete)
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(await request('/api/adventure/commands', complete), done)
    assert.equal((await request('/api/adventure/growth')).body.growth.totalXp, 1)
    assert.ok(authCalls >= 10)
    for (const name of ['ledger_account_create', 'ledger_create', 'adventure_planning_command', 'adventure_growth_read'])
      assert.ok(restCalls.includes(name), `missing REST RPC ${name}`)
    console.log(
      '通过：生产构建 workerd → 业务 fetch → 本机真实 PostgREST → PostgreSQL；账户余额、跨 owner 拒绝、完成奖励及历史幂等'
    )
  } finally {
    await runtime.dispose()
  }
}
