import { Component, Suspense, lazy, type ReactNode } from 'react'
import { AppLayout, pageTitles } from './AppLayout'
import type { AppPage } from './AppNavigation'

const pages = {
  home: lazy(async () => ({ default: (await import('../home/Home')).Home })),
  news: lazy(async () => ({ default: (await import('../news/News')).News })),
  adventure: lazy(async () => ({ default: (await import('../adventure/Adventure')).Adventure })),
  finance: lazy(async () => ({ default: (await import('../ledger/Finance')).Finance })),
}

function PageFeedback({ page, failed = false }: { page: AppPage; failed?: boolean }) {
  return <AppLayout page={page}><div className="page-feedback">
    <h1 id="page-title" tabIndex={-1}>{pageTitles[page]}</h1>
    <p role={failed ? 'alert' : 'status'}>{failed ? '页面暂时无法显示，请重新加载。' : `正在加载${pageTitles[page]}…`}</p>
    {failed && <button type="button" onClick={() => window.location.reload()}>重新加载页面</button>}
  </div></AppLayout>
}

class PageLoadBoundary extends Component<{ page: AppPage; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <PageFeedback page={this.props.page} failed /> : this.props.children }
}

export function PageContent({ page }: { page: AppPage }) {
  const Page = pages[page]
  return <PageLoadBoundary key={page} page={page}>
    <Suspense fallback={<PageFeedback page={page} />}><Page /></Suspense>
  </PageLoadBoundary>
}
