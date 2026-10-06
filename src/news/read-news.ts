import { api } from '../home/api'
import type { NewsResult } from '../shared/news-contracts'

// 队列属于当前新闻页；Query 的取消信号同时终止排队和正在读取的请求。
export function createNewsReader() {
  let active = 0
  const queued: Array<() => void> = []
  function drain() {
    while (active < 3 && queued.length) queued.shift()!()
  }
  return (id: string, signal: AbortSignal) => new Promise<NewsResult>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => {
      const index = queued.indexOf(start)
      if (index >= 0) queued.splice(index, 1)
      reject(signal.reason)
    }
    const start = () => {
      active++
      signal.removeEventListener('abort', cancel)
      api.newsSource(id, signal).then(resolve, reject).finally(() => { active--; drain() })
    }
    signal.addEventListener('abort', cancel, { once: true })
    queued.push(start)
    drain()
  })
}
