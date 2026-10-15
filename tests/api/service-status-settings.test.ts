import { afterEach, expect, test, vi } from 'vitest'
import { loadServiceSelection, normalizeServiceSelection, saveServiceSelection, serviceStatusStorageKey } from '../../src/home/service-status-settings'
const storage = (raw: string | null) => {
  const values = new Map(raw === null ? [] : [[serviceStatusStorageKey, raw]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  return values
}
afterEach(() => vi.unstubAllGlobals())

test.each([null, '{broken', 'null', '{}', '["openai",1]'])('缺失或损坏配置 %s 默认 OpenAI 和 xAI', raw => {
  storage(raw)
  expect(loadServiceSelection()).toEqual(['openai', 'xai'])
})
test('空选择保留、未知来源忽略、重复选择按固定顺序去重', () => {
  storage('[]'); expect(loadServiceSelection()).toEqual([])
  storage('["tailscale","openai","future-provider","tailscale"]')
  expect(loadServiceSelection()).toEqual(['openai', 'tailscale'])
  expect(normalizeServiceSelection(['xai','xai','unknown'])).toEqual(['xai'])
})
test('保存后读取一致，不改其他设置键', () => {
  const values = storage(null)
  saveServiceSelection(['openai', 'tailscale'])
  expect(loadServiceSelection()).toEqual(['openai', 'tailscale'])
  expect([...values.keys()]).toEqual([serviceStatusStorageKey])
})
test('读取存储失败仍给出默认，写入失败交由界面明确提示', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable') }, setItem: () => { throw new Error('unavailable') } })
  expect(loadServiceSelection()).toEqual(['openai', 'xai'])
  expect(() => saveServiceSelection(['tailscale'])).toThrow('unavailable')
})
