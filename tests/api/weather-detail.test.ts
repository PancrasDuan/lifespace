import { afterEach, expect, test, vi } from 'vitest'
import app from '../../worker/index'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const now = 1791295200 // 2026-10-06 14:00 UTC
function forecast() {
  return { timezone: 'Asia/Shanghai', current: { time: now, temperature_2m: 23, weather_code: 3, apparent_temperature: 24, relative_humidity_2m: 70, pressure_msl: 1014, precipitation: 0, wind_speed_10m: 2, wind_direction_10m: 90, is_day: 0 }, hourly: { time: [now - 3600, now, now + 3600], temperature_2m: [20, 23, null], weather_code: [3, 3, null], precipitation_probability: [5, 10, null], is_day: [0, 0, 0] }, daily: { time: [1791216000, 1791302400], temperature_2m_max: [26, 27], temperature_2m_min: [19, 20], precipitation_probability_max: [65, 70], weather_code: [3, 61], sunrise: [1791237600, 1791324000], sunset: [1791280800, 1791367200], precipitation_sum: [0, 5] } }
}

test('天气详情以城市时区转换日期，从当前小时开始返回预报并保留缺失指标', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T14:00:00Z'))
  vi.stubGlobal('fetch', async () => Response.json(forecast()))
  const response = await app.request('/api/weather/detail?latitude=39.9&longitude=116.4&timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ date: '2026-10-06', temperature: 23, humidity: 70, currentTime: now, hourly: [{ time: now, temperature: 23 }, { time: now + 3600, temperature: null }], daily: [{ date: '2026-10-06', temperatureMax: 26 }, { date: '2026-10-07', temperatureMax: 27 }] })
})

test('错位的逐时字段与过期日期不成为有效预报', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T14:00:00Z'))
  const data = forecast(); data.hourly.temperature_2m.pop()
  vi.stubGlobal('fetch', async () => Response.json(data))
  const path = '/api/weather/detail?latitude=39.9&longitude=116.4&timeZone=Asia%2FShanghai'
  expect((await app.request(path, {}, {})).status).toBe(502)
  vi.stubGlobal('fetch', async () => Response.json(forecast()))
  vi.setSystemTime(new Date('2026-10-07T14:00:00Z'))
  expect((await app.request(path, {}, {})).status).toBe(502)
})

test('当地小时并非 UTC 整点时仍包含当前小时，空值不变为零', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T14:50:00Z'))
  const data = forecast(); data.timezone = 'Asia/Kathmandu'; data.daily.time = data.daily.time.map(time => time + 8100)
  data.hourly.time = [now - 2700, now + 900, now + 4500]
  data.hourly.temperature_2m = [20, null, 22]
  vi.stubGlobal('fetch', async () => Response.json(data))
  const response = await app.request('/api/weather/detail?latitude=27.7&longitude=85.3&timeZone=Asia%2FKathmandu', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ hourly: [{ time: now + 900, temperature: null }, { time: now + 4500, temperature: 22 }] })
})

test('空气质量保留美制指数和空值，来源失效不暴露原始内容', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T14:00:00Z'))
  vi.stubGlobal('fetch', async () => Response.json({ timezone: 'Asia/Shanghai', current: { time: now, us_aqi: 130, pm2_5: 42.5, pm10: null } }))
  const path = '/api/weather/air-quality?latitude=39.9&longitude=116.4&timeZone=Asia%2FShanghai'
  expect(await (await app.request(path, {}, {})).json()).toMatchObject({ timeZone: 'Asia/Shanghai', usAqi: 130, pm25: 42.5, pm10: null, time: now })
  vi.stubGlobal('fetch', async () => new Response('private-upstream-detail', { status: 503 }))
  const response = await app.request(path, {}, {})
  expect(response.status).toBe(502); expect(await response.text()).not.toContain('private-upstream-detail')
})

test.each(['latitude=91&longitude=0&timeZone=Asia%2FShanghai', 'latitude=0&longitude=0&timeZone=Invalid'])('详情与AQI拒绝非法参数：%s', async params => {
  expect((await app.request(`/api/weather/detail?${params}`, {}, {})).status).toBe(400)
  expect((await app.request(`/api/weather/air-quality?${params}`, {}, {})).status).toBe(400)
})
