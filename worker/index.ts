import { Hono } from 'hono'
import { readRewardSource, readGrowth, readTaskHistory, readMigrationOptions, readPlanning, previewPlanning, commandPlanning } from './adventure/planning'
import { readTasks } from './tasks'
import { ApiError } from './upstream'
import { readWeather, searchLocations } from './weather'
import { readWeatherDetail, readAirQuality } from './weather-detail'
import { readDomainCard } from './domain-card'
import { newsSources } from '../src/shared/news-sources'
import { readNews } from './news'
import { readAiStatus } from './ai-status'
import { publicConfig, registrationHook, verifyIdentity, type AuthEnv, type Identity } from './auth'

const app = new Hono<{ Bindings: AuthEnv; Variables: { identity: Identity } }>()
app.use('/api/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
app.get('/api/auth/config', c => c.json(publicConfig(c.env)))
app.post('/api/auth/hooks/before-user-created', async c => {
  try {
    const result = await registrationHook(c.env, c.req.raw)
    return c.json(result.body, result.status)
  } catch {
    return c.json({ error: { http_code: 503, message: '注册服务暂时不可用' } }, 503)
  }
})
app.use('/api/*', async (c, next) => {
  c.set('identity', await verifyIdentity(c.env, c.req.header('Authorization')))
  await next()
})
app.get('/api/auth/me', c => c.json({ user: c.get('identity') }))
app.get('/api/adventure', readPlanning)
app.get('/api/adventure/migration-options', readMigrationOptions)
app.get('/api/adventure/task-history', readTaskHistory)
app.get('/api/adventure/growth', readGrowth)
app.get('/api/adventure/reward-source', readRewardSource)
app.post('/api/adventure/preview', previewPlanning)
app.post('/api/adventure/commands', commandPlanning)
app.get('/api/tasks/today', async c => c.json(await readTasks(c.env, c.req.query('timeZone'))))
app.get('/api/domains', async c => c.json(await readDomainCard(c.env)))
app.get('/api/ai-status', async c => c.json(await readAiStatus()))
app.get('/api/news/sources', c => c.json({ sources: newsSources }))
app.get('/api/news/source', async c => c.json(await readNews(c.env, c.req.query('id'))))
app.get('/api/weather', async c => c.json(await readWeather(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/detail', async c => c.json(await readWeatherDetail(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/air-quality', async c => c.json(await readAirQuality(c.req.query('latitude'), c.req.query('longitude'), c.req.query('timeZone'))))
app.get('/api/weather/locations', async c => c.json(await searchLocations(c.req.query('q'))))
app.onError((error, c) => {
  if (error instanceof ApiError) {
    if (error.status === 429) c.header('Retry-After', '60')
    return c.json({ error: { code: error.code, message: error.message } }, error.status)
  }
  console.error(JSON.stringify({ event: 'api_error', code: 'INTERNAL_ERROR' }))
  return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500)
})
app.notFound(c => c.req.path.startsWith('/api/')
  ? c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404)
  : c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('页面不存在', 404))
export default app
