import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'

// The built production entry point runs in workerd, including pg-cloudflare's
// real TCP implementation. Only the external Auth service is substituted.
export async function verifyWorkerPostgres(client, root) {
  const connectionString = `postgres://lifespace_worker:local-test-only@127.0.0.1:${client.port}/postgres`
  let authCalls = 0
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'lifespace-pg-test',
          modules: true,
          scriptPath: resolve(root, 'dist/lifespace/index.js'),
          compatibilityDate: '2026-10-01',
          compatibilityFlags: ['nodejs_compat'],
          hyperdrives: { HYPERDRIVE: connectionString },
          bindings: {
            SUPABASE_URL: 'https://worker-test.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test-only',
            AUTH_ALLOWED_EMAILS: 'runtime@example.invalid',
          },
          outboundService: async (request) => {
            assert.equal(new URL(request.url).pathname, '/auth/v1/user', '业务数据库不能经过 HTTP')
            authCalls++
            const claims = JSON.parse(Buffer.from(request.headers.get('Authorization').split('.')[1], 'base64url').toString())
            return new RuntimeResponse(
              JSON.stringify({ id: claims.sub, email: 'runtime@example.invalid', email_confirmed_at: '2026-01-01', is_anonymous: false }),
              { headers: { 'Content-Type': 'application/json' } }
            )
          },
        },
      ],
    })
  )
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID()
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
      note: '运行时 pg',
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
    console.log(
      '通过：生产构建 workerd → pg-cloudflare → Hyperdrive 本地 binding → PostgreSQL，账户余额、跨 owner 拒绝、完成奖励及历史幂等'
    )
  } finally {
    await runtime.dispose()
  }
}
