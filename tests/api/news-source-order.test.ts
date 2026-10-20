import { describe, expect, it, vi } from 'vitest'
import { loadSourceOrder, mergeVisibleOrder, resolveSourceOrder, saveSourceOrder, sourceOrderKey } from '../../src/news/source-order'
import type { NewsSource } from '../../src/shared/news-sources'

const sources: NewsSource[] = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, label: id, defaultEnabled: true, order: index + 1 }))

describe('新闻卡片顺序', () => {
  it('按来源 order 回退默认，忽略未知 ID，去重并在末尾补齐新增来源', () => {
    expect(resolveSourceOrder([...sources].reverse(), null)).toEqual(['a', 'b', 'c', 'd'])
    expect(resolveSourceOrder(sources, ['c', 'retired', 'a', 'c'])).toEqual(['c', 'a', 'b', 'd'])
    expect(resolveSourceOrder(sources, [])).toEqual(['a', 'b', 'c', 'd'])
    expect(resolveSourceOrder([], ['c'])).toEqual([])
  })

  it('移动可见来源时保留隐藏来源位置，包括非相邻隐藏项', () => {
    const order = ['a', 'hidden1', 'b', 'hidden2', 'c', 'd']
    expect(mergeVisibleOrder(order, ['d', 'b', 'a', 'c'])).toEqual(['d', 'hidden1', 'b', 'hidden2', 'a', 'c'])
    expect(mergeVisibleOrder(order, [])).toEqual(order)
    expect(order).toEqual(['a', 'hidden1', 'b', 'hidden2', 'c', 'd'])
  })

  it.each([null, '{bad', '{}', '42', '["a",42]'])('配置 %s 缺失或损坏时回退', stored => {
    vi.stubGlobal('localStorage', { getItem: () => stored })
    try { expect(loadSourceOrder()).toBeNull() } finally { vi.unstubAllGlobals() }
  })

  it('独立读写排序键，写入失败不会抛出异常', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => '["c","a","c"]', setItem })
    try {
      expect(loadSourceOrder()).toEqual(['c', 'a'])
      expect(saveSourceOrder(['c', 'a'])).toBe(true)
      expect(setItem).toHaveBeenCalledWith(sourceOrderKey, '["c","a"]')
      setItem.mockImplementation(() => { throw new Error('denied') })
      expect(saveSourceOrder(['a'])).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it('浏览器拒绝读取时回退且不会阻断页面', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    try { expect(loadSourceOrder()).toBeNull() } finally { vi.unstubAllGlobals() }
  })
})
