import { AppLayout } from '../app/AppLayout'
import { useQueries, useQuery, type Query } from '@tanstack/react-query'
import { api } from '../home/api'
import { newsFreshMs, type NewsResult } from '../shared/news-contracts'
import { NewsCard } from './NewsCard'
import { RotateCw } from 'lucide-react'
import './news.css'
import { useState } from 'react'
import { createNewsReader } from './read-news'

function freshness(query: Query<NewsResult>) {
  const data = query.state.data
  return data ? Math.max(0, newsFreshMs - Math.max(0, query.state.dataUpdatedAt - Date.parse(data.fetchedAt))) : newsFreshMs
}

export function News() {
  const [readNews] = useState(createNewsReader)
  const metadata = useQuery({ queryKey: ['news-sources'], queryFn: ({ signal }) => api.newsSources(signal), staleTime: Infinity, retry: false, refetchOnWindowFocus: false })
  const sources = metadata.data?.sources.filter(source => source.defaultEnabled).sort((a, b) => a.order - b.order) ?? []
  const queries = useQueries({ queries: sources.map(source => ({
    queryKey: ['news', source.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => readNews(source.id, signal),
    staleTime: freshness, retry: false as const, refetchOnWindowFocus: false,
  })) })
  const refreshing = queries.some(query => query.isFetching)
  return <AppLayout page="news"><div className="news-page"><header className="masthead">
    <div className="page-kicker"><span className="live-dot" />LifeSpace · 每日阅读</div>
    <h1>热点新闻</h1><p>把值得关注的消息放在一起</p>
  </header>
    <div className="news-toolbar"><span>按来源浏览 · {sources.length} 个榜单</span>
      <button aria-label="刷新全部新闻" disabled={refreshing || !sources.length} onClick={() => { for (const query of queries) void query.refetch() }}><RotateCw size={15} className={refreshing ? 'spinning' : ''} />{refreshing ? '正在获取' : '全部刷新'}</button>
    </div>
    {metadata.isPending && <p className="news-page-state">正在读取新闻来源…</p>}
    {metadata.isError && <div role="alert" className="news-page-state"><p>{metadata.error.message}</p><button onClick={() => { void metadata.refetch() }}>重试新闻来源</button></div>}
    <section className="news-grid" aria-label="新闻榜单">{sources.map((source, index) => <NewsCard key={source.id} source={source} query={queries[index]} />)}</section>
    <p className="page-note">榜单有各自的更新节奏，刷新可能读取缓存。</p>
  </div></AppLayout>
}
