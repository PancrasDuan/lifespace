import { AppLayout } from '../app/AppLayout'
import { useQueries, useQuery, type Query } from '@tanstack/react-query'
import { api } from '../home/api'
import { newsFreshMs, type NewsResult } from '../shared/news-contracts'
import { NewsCard } from './NewsCard'
import { RotateCw, Settings2 } from 'lucide-react'
import './news.css'
import { useState } from 'react'
import { createNewsReader } from './read-news'
import { NewsSourceSettings } from './NewsSourceSettings'
import { loadSourceSelection, saveSourceSelection } from './source-selection'

function freshness(query: Query<NewsResult>) {
  const data = query.state.data
  if (data?.stale) return 0
  return data ? Math.max(0, newsFreshMs - Math.max(0, query.state.dataUpdatedAt - Date.parse(data.fetchedAt))) : newsFreshMs
}

export function News() {
  const [readNews] = useState(createNewsReader)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selection, setSelection] = useState(loadSourceSelection)
  const [unsaved, setUnsaved] = useState(false)
  const metadata = useQuery({ queryKey: ['news-sources'], queryFn: ({ signal }) => api.newsSources(signal), staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const allSources = metadata.data?.sources.slice().sort((a, b) => a.order - b.order) ?? []
  const sources = allSources.filter(source => selection === null ? source.defaultEnabled : selection.includes(source.id))
  const enabled = sources.map(source => source.id)
  const change = (id: string, checked: boolean) => {
    const next = checked ? [...new Set([...enabled, id])] : enabled.filter(value => value !== id)
    setSelection(next)
    setUnsaved(!saveSourceSelection(next))
  }
  const queries = useQueries({ queries: sources.map(source => ({
    queryKey: ['news', source.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => readNews(source.id, signal),
    staleTime: freshness, retry: false as const, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })) })
  const refreshing = queries.some(query => query.isFetching)
  return <AppLayout page="news" openSettings={() => setSettingsOpen(true)}><div className="news-page"><header className="masthead">
    <div className="page-kicker"><span className="live-dot" />LifeSpace · 每日阅读</div>
    <h1>热点新闻</h1><p>把值得关注的消息放在一起</p>
  </header>
    <div className="news-toolbar"><span>按来源浏览 · {sources.length} 个榜单</span>
      <div className="news-toolbar-actions"><button aria-label="刷新全部新闻" disabled={refreshing || !sources.length} onClick={() => { for (const query of queries) void query.refetch() }}><RotateCw size={15} className={refreshing ? 'spinning' : ''} />{refreshing ? '正在获取' : '全部刷新'}</button>
        <button aria-label="新闻来源设置" disabled={!allSources.length} onClick={() => setSettingsOpen(true)}><Settings2 size={15} />来源设置</button></div>
    </div>
    {metadata.isPending && <p className="news-page-state">正在读取新闻来源…</p>}
    {metadata.isError && <div role="alert" className="news-page-state"><p>{metadata.error.message}</p><button onClick={() => { void metadata.refetch() }}>重试新闻来源</button></div>}
    {unsaved && <p role="alert" className="news-error">来源选择未保存，仅在当前页面生效。</p>}
    {metadata.isSuccess && !sources.length && <div className="news-page-state"><h2>未启用来源</h2><p>打开来源设置，选择要浏览的榜单。</p><button onClick={() => setSettingsOpen(true)}>打开新闻来源设置</button></div>}
    <section className="news-grid" aria-label="新闻榜单">{sources.map((source, index) => <NewsCard key={source.id} source={source} query={queries[index]} />)}</section>
    {settingsOpen && <NewsSourceSettings sources={allSources} enabled={enabled} change={change} unsaved={unsaved} close={() => setSettingsOpen(false)} />}
  </div></AppLayout>
}
