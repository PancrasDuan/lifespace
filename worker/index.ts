import { Hono } from 'hono'
import { listLedger, detailLedger, createLedger, createLedgerEntry, createLedgerRefund, createLedgerTransfer, refundLedger, previewLedgerDelete, deleteLedger, listLedgerAccounts, readLedgerAccounts, createLedgerAccount, updateLedgerAccount } from './ledger'
import { readTaskList, readRewardSource, readGrowth, readTaskHistory, readMigrationOptions, readPlanning, previewPlanning, commandPlanning, lookupPlanningReceipt } from './adventure/planning'
import { readHoroscope } from './horoscope'
import { readTasks } from './tasks'
import { ApiError, apiErrorBody } from './upstream'
import { searchLocations } from './weather'
import { readWeatherDetail, readAirQuality } from './weather-detail'
import { readDomainCard } from './domain-card'
import { newsSources } from '../src/shared/news-sources'
import { readNews } from './news'
import { readAiStatus } from './ai-status'
import { publicConfig, registrationHook, verifyIdentity, type AuthEnv, type Identity } from './auth'
import { verifyAgentIdentity } from './agent-auth'
import { handleAgentMcp } from './agent-mcp'
import { beginTrace, traceErrorCode, withRootSpan } from './trace'

const app = new Hono<{ Bindings: AuthEnv; Variables: { identity: Identity } }>()
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await withRootSpan(beginTrace(c), () => next())
})
app.get('/api/auth/config', c => c.json(publicConfig(c.env)))
app.post('/api/auth/hooks/before-user-created', async c => {
  try {
    const result = await registrationHook(c.env, c.req.raw)
    return c.json(result.body, result.status)
  } catch (error) {
    traceErrorCode(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', c.req.path, c)
    return c.json({ error: { http_code: 503, message: '注册服务暂时不可用' } }, 503)
  }
})
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/agent/mcp') {
    c.set('identity', await verifyAgentIdentity(c.env, c.req.header('Cf-Access-Jwt-Assertion')))
    await next()
    return
  }
  c.set('identity', await verifyIdentity(c.env, c.req.header('Authorization'), c.req.path))
  await next()
})
app.all('/api/agent/mcp', async c => {
  const response = await handleAgentMcp(c.req.raw, {
    listAccounts: input => readLedgerAccounts(c, input),
    createEntry: input => createLedgerEntry(c, input),
    refundEntry: (id, input) => createLedgerRefund(c, id, input),
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
})
app.get('/api/auth/me', c => c.json({ user: c.get('identity') }))
app.get('/api/horoscope', async c => c.json(await readHoroscope(c.env, new URL(c.req.url).searchParams)))
app.get('/api/ledger/entries', listLedger)
app.get('/api/ledger/accounts', listLedgerAccounts)
app.post('/api/ledger/accounts', createLedgerAccount)
app.patch('/api/ledger/accounts/:id', updateLedgerAccount)
app.get('/api/ledger/entries/:id', detailLedger)
app.post('/api/ledger/entries', createLedger)
app.post('/api/ledger/transfers', createLedgerTransfer)
app.post('/api/ledger/entries/:id/refunds', refundLedger)
app.get('/api/ledger/entries/:id/delete-preview', previewLedgerDelete)
app.post('/api/ledger/entries/:id/delete', deleteLedger)
app.get('/api/adventure', readPlanning)
app.post('/api/adventure/tasks/list', readTaskList)
app.get('/api/adventure/migration-options', readMigrationOptions)
app.get('/api/adventure/task-history', readTaskHistory)
app.get('/api/adventure/growth', readGrowth)
app.get('/api/adventure/reward-source', readRewardSource)
app.get('/api/adventure/compatibility', c => c.json({ model: 'goal-categories', version: 1, receiptLookup: true, legacyRetry: false }))
app.post('/api/adventure/legacy-retry', () => { throw new ApiError('CLIENT_UPDATE_REQUIRED', '旧页面操作结果可能未知，请不要刷新或重新提交，请联系维护人员核对。', 503) })
app.post('/api/adventure/preview', previewPlanning)
app.post('/api/adventure/receipts/lookup', lookupPlanningReceipt)
app.post('/api/adventure/commands', commandPlanning)
app.get('/api/tasks/today', async c => c.json(await readTasks(c.env, c.req.query('timeZone'))))
app.get('/api/domains', async c => c.json(await readDomainCard(c.env)))
app.get('/api/ai-status', async c => c.json(await readAiStatus()))
app.get('/api/news/sources', c => c.json({ sources: newsSources }))
app.get('/api/news/source', async c => c.json(await readNews(c.env, c.req.query('id'))))
app.get('/api/weather/detail', async c => c.json(await readWeatherDetail(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/air-quality', async c => c.json(await readAirQuality(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/locations', async c => c.json(await searchLocations(c.req.query('q'))))
app.onError((error, c) => {
  traceErrorCode(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', c.req.path, c)
  if (error instanceof ApiError) {
    if (error.status === 429) c.header('Retry-After', '60')
    return c.json(apiErrorBody(error), error.status)
  }
  console.error(JSON.stringify({ event: 'api_error', code: 'INTERNAL_ERROR' }))
  return c.json(apiErrorBody(error), 500)
})
app.notFound(c => {
  if (!c.req.path.startsWith('/api/')) return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('页面不存在', 404)
  traceErrorCode('NOT_FOUND', c.req.path, c)
  return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404)
})
export default app
