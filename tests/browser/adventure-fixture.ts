import type { BrowserContext, Route } from '@playwright/test'
import { Hono } from 'hono'
import { getAdventure, adventureCommand } from '../../worker/adventure/http'
import { verifyIdentity, type AuthEnv, type Identity } from '../../worker/auth'
import { ApiError } from '../../worker/upstream'
const app = new Hono<{ Bindings: AuthEnv; Variables: { identity: Identity } }>()
app.use('/api/*', async (c, next) => {
  c.set('identity', await verifyIdentity(c.env, c.req.header('Authorization')))
  await next()
})
app.get('/api/adventure', getAdventure)
app.post('/api/adventure/commands', adventureCommand)
app.onError((error, c) =>
  error instanceof ApiError
    ? c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    : c.json(
        { error: { code: 'INTERNAL_ERROR', message: '测试接口出错' } },
        500,
      ),
)
import {
  initialState,
  type AdventureState,
  type AdventureCommand,
  executeCommand,
} from '../../src/shared/adventure'
import type { StoredState } from '../../worker/adventure/store'

const owner = '00000000-0000-4000-8000-000000000001'
const encode = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: owner, session_id: '00000000-0000-4000-8000-000000000002', exp: 4102444800 })}.test-signature`

// 浏览器经过真实 Worker 鉴权、严格命令、领域逻辑和 CAS 存储适配器。
// 仅在外部 Auth/PostgREST 和时钟边界提供确定输入，不模拟自己的奖励事务。
export async function adventureFixture(
  context: BrowserContext,
  today = '2026-10-19',
) {
  let day = today,
    row: StoredState | undefined,
    serial = Promise.resolve()
  let loseResponse = false
  const envelopes: { requestId: string; command: AdventureCommand }[] = []
  const database = async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/user')
      return Response.json({
        id: owner,
        email: 'demo@example.com',
        email_confirmed_at: '2026-10-01',
        is_anonymous: false,
      })
    if (url.pathname !== '/rest/v1/adventure_states')
      throw new Error('Unexpected external endpoint')
    const requestedOwner = url.searchParams.get('owner_id')?.slice(3)
    if (init.method === 'POST') {
      if (!row) row = JSON.parse(String(init.body)) as StoredState
      return Response.json([])
    }
    if (init.method === 'PATCH') {
      const version = Number(url.searchParams.get('version')?.slice(3))
      if (!row || row.owner_id !== requestedOwner || row.version !== version)
        return Response.json([])
      row = { ...row, ...JSON.parse(String(init.body)) } as StoredState
      return Response.json([row])
    }
    return Response.json(row?.owner_id === requestedOwner ? [row] : [])
  }
  const handler = async (route: Route) => {
    const request = route.request(),
      upstream = globalThis.fetch,
      originalNow = Date.now
    globalThis.fetch = database
    Date.now = () => new Date(`${day}T04:00:00Z`).getTime()
    try {
      const body = request.postData()
      const envelope = body
        ? (JSON.parse(body) as { requestId: string; command: AdventureCommand })
        : undefined
      if (envelope) envelopes.push(envelope)
      const response = await app.request(
        new URL(request.url()).pathname,
        {
          method: request.method(),
          body: body ?? undefined,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
        {
          SUPABASE_URL: 'https://adventure-test.supabase.co',
          SUPABASE_SECRET_KEY: 'sb_secret_fake-adventure-browser',
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake-adventure-browser',
          AUTH_ALLOWED_EMAILS: 'demo@example.com',
        },
      )
      if (
        loseResponse &&
        envelope &&
        envelope.command.type !== 'refresh' &&
        response.ok
      ) {
        loseResponse = false
        await route.abort('connectionreset')
        return
      }
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      })
    } finally {
      globalThis.fetch = upstream
      Date.now = originalNow
    }
  }
  await context.route('**/api/adventure**', (route) => {
    const operation = serial.then(() => handler(route))
    serial = operation.catch(() => {})
    return operation
  })
  return {
    envelopes,
    setToday(value: string) {
      day = value
    },
    loseNextResponse() {
      loseResponse = true
    },
    seed(commands: AdventureCommand[], seedDay = day) {
      let state: AdventureState = row?.state || initialState()
      let result
      for (const command of commands) {
        const execution = executeCommand(state, command, {
          today: seedDay,
          now: `${seedDay}T04:00:00Z`,
        })
        state = execution.state
        result = execution.result
      }
      row = {
        owner_id: owner,
        state,
        version: (row?.version ?? 0) + 1,
        journal: {},
      }
      return result!
    },
  }
}
