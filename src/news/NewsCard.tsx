import { Newspaper, RotateCw } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { NewsResult } from '../shared/news-contracts'
import type { NewsSource } from '../shared/news-sources'

function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function NewsCard({ source, query }: { source: NewsSource; query: UseQueryResult<NewsResult, Error> }) {
  const data = query.data
  return <article className="news-card" aria-label={source.label} aria-busy={query.isFetching}>
    <header className="news-card-heading">
      <div><Newspaper size={17} /><h2>{source.label}</h2></div>
      <button aria-label={'刷新' + source.label} onClick={() => { void query.refetch() }} disabled={query.isFetching}>
        <RotateCw size={15} className={query.isFetching ? 'spinning' : ''} />
      </button>
    </header>
    {query.isError && <p role="alert" className="news-error">{data ? '上次成功结果 · 本次刷新失败：' : ''}{query.error.message}</p>}
    <div className="news-list" tabIndex={0} aria-label={source.label + '榜单'}>
      {data?.items.length ? <ol>{data.items.map(item => <li key={item.rank + ':' + item.id}>
        <span className="news-rank">{item.rank}</span><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
      </li>)}</ol> : <p className="news-state">{data ? '暂无热点' : query.isError ? '暂未取得榜单，可点击刷新重试' : '正在加载榜单…'}</p>}
    </div>
    <footer className="news-card-footer">
      <span>{data ? '获取时间 ' + time(data.fetchedAt) : '尚未获取'}</span>
      {data && <span>{data.cacheHit ? 'LifeSpace 缓存' : data.upstreamStatus === 'cache' ? '来源缓存' : '来源返回'} · {data.sourceUpdatedAt ? '上游报告 ' + time(data.sourceUpdatedAt) : '上游未报告时间'}</span>}
    </footer>
  </article>
}
