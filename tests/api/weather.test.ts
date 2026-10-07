import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('天气接口返回城市当地当天的温度及降雨信息', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T14:00:00Z'))
  vi.stubGlobal('fetch', async () => Response.json({ timezone: 'Asia/Shanghai', current: { temperature_2m: 23, weather_code: 3 }, daily: { time: ['2026-10-05'], temperature_2m_max: [26], temperature_2m_min: [19], precipitation_probability_max: [65] } }))
  const response = await app.request('/api/weather?latitude=31.23&longitude=121.47&timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ date: '2026-10-05', timeZone: 'Asia/Shanghai', fetchedAt: '2026-10-05T14:00:00.000Z', temperature: 23, weatherCode: 3, temperatureMin: 19, temperatureMax: 26, precipitationProbability: 65 })
})

test('城市搜索保留同名城市的地区和坐标，空结果返回空列表', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ results: [{ id: 1796236, name: '上海', admin1: '上海市', country: '中国', latitude: 31.22, longitude: 121.45, timezone: 'Asia/Shanghai' }] }))
  const response = await app.request('/api/weather/locations?q=%E4%B8%8A%E6%B5%B7', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ locations: [{ id: '1796236', name: '上海', region: '上海市 · 中国', latitude: 31.22, longitude: 121.45, timeZone: 'Asia/Shanghai' }] })
})

test.each(['/api/weather?latitude=91&longitude=0&timeZone=Asia%2FShanghai', '/api/weather?latitude=&longitude=0&timeZone=Asia%2FShanghai', '/api/weather/locations?q=a'])('拒绝无效天气参数：%s', async path => {
  const response = await app.request(path, {}, {})
  expect(response.status).toBe(400)
})

test('城市搜索无匹配时返回空列表', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}))
  expect(await (await app.request('/api/weather/locations?q=未知城市', {}, {})).json()).toEqual({ locations: [] })
})

test('数据源超时与连接失效不会暴露原始响应', async () => {
  vi.stubGlobal('fetch', async () => { throw new DOMException('secret-detail', 'TimeoutError') })
  const timedOut = await app.request('/api/weather?latitude=0&longitude=0&timeZone=Asia%2FShanghai', {}, {})
  expect(timedOut.status).toBe(504)
  expect(await timedOut.text()).not.toContain('secret-detail')
  vi.stubGlobal('fetch', async () => new Response('private-token', { status: 401 }))
  const rejected = await app.request('/api/weather?latitude=0&longitude=0&timeZone=Asia%2FShanghai', {}, {})
  expect(rejected.status).toBe(502)
  expect(await rejected.json()).toEqual({ error: { code: 'SOURCE_CONNECTION_INVALID', message: '数据源连接失效，请检查服务端配置' } })
})

test('来源返回非法时区时报告来源内容错误，而非内部服务错误', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ timezone: 'Invalid/Zone', current: { temperature_2m: 23, weather_code: 3 }, daily: { time: ['2026-10-06'], temperature_2m_max: [26], temperature_2m_min: [19], precipitation_probability_max: [65] } }))
  const response = await app.request('/api/weather?latitude=31&longitude=121&timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_INVALID_RESPONSE' } })
})

test('天气使用指定地区时区，并拒绝来源时区不一致', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T14:00:00Z'))
  let receivedZone: string | null = null
  vi.stubGlobal('fetch', async (input: URL) => {
    receivedZone = input.searchParams.get('timezone')
    return Response.json({ timezone: 'Asia/Shanghai', current: { temperature_2m: 23, weather_code: 3 }, daily: { time: ['2026-10-05'], temperature_2m_max: [26], temperature_2m_min: [19], precipitation_probability_max: [65] } })
  })
  const response = await app.request('/api/weather?latitude=31.23&longitude=121.47&timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(200)
  expect(receivedZone).toBe('Asia/Shanghai')
  expect((await app.request('/api/weather?latitude=31.23&longitude=121.47&timeZone=America%2FNew_York', {}, {})).status).toBe(502)
  expect((await app.request('/api/weather?latitude=31.23&longitude=121.47&timeZone=Invalid', {}, {})).status).toBe(400)
})
