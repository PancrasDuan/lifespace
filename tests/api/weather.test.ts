import { afterEach, expect, test, vi } from 'vitest'
import app from './authenticated-app'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('已下线的天气摘要接口返回 404，不请求上游', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const response = await app.request('/api/weather?latitude=31.23&longitude=121.47&timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  expect(fetch).not.toHaveBeenCalled()
})

test('城市搜索保留同名城市的地区和坐标，空结果返回空列表', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ results: [{ id: 1796236, name: '上海', admin1: '上海市', country: '中国', latitude: 31.22, longitude: 121.45, timezone: 'Asia/Shanghai' }] }))
  const response = await app.request('/api/weather/locations?q=%E4%B8%8A%E6%B5%B7', {}, {})
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ locations: [{ id: '1796236', name: '上海', region: '上海市 · 中国', latitude: 31.22, longitude: 121.45, timeZone: 'Asia/Shanghai' }] })
})

test('城市搜索拒绝无效关键词', async () => {
  expect((await app.request('/api/weather/locations?q=a', {}, {})).status).toBe(400)
})

test('城市搜索无匹配时返回空列表', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}))
  expect(await (await app.request('/api/weather/locations?q=未知城市', {}, {})).json()).toEqual({ locations: [] })
})
