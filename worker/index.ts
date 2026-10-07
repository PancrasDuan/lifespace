import { Hono } from 'hono'
import { readTasks } from './tasks'
import { ApiError } from './upstream'
import { readWeather, searchLocations } from './weather'
import { readDomainCard } from './domain-card'
import { newsSources } from '../src/shared/news-sources'
import { readNews } from './news'
import { readAiStatus } from './ai-status'

const app = new Hono<{ Bindings: Partial<CloudflareEnv> }>()
app.use('/api/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
app.get('/api/tasks/today', async c => c.json(await readTasks(c.env, c.req.query('timeZone'))))
app.get('/api/domains', async c => c.json(await readDomainCard(c.env)))
app.get('/api/ai-status', async c => c.json(await readAiStatus()))
app.get('/api/news/sources', c => c.json({ sources: newsSources }))
app.get('/api/news/source', async c => c.json(await readNews(c.env, c.req.query('id'))))
app.get('/api/weather', async c => c.json(await readWeather(c.req.query('latitude'), c.req.query('longitude'))))
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
