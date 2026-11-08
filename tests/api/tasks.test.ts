import { afterEach, expect, test, vi } from 'vitest'
import app from './authenticated-app'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('任务来源尚未配置时返回明确状态，不伪装成空任务', async () => {
  const response = await app.request('/api/tasks/today?timeZone=Asia%2FShanghai', {}, {})
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: { code: 'TASKS_NOT_CONFIGURED', message: '任务来源尚未配置' } })
})

test('无效任务时区返回输入错误', async () => {
  expect((await app.request('/api/tasks/today?timeZone=Invalid%2FZone', {}, {})).status).toBe(400)
})
