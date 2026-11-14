import type { ReactNode } from 'react'
import { AppNavigation, type AppPage } from './AppNavigation'
import './app.css'
import { usePageTitle } from './usePageTitle'

export const pageTitles = { home: '首页', news: '热点新闻', adventure: '人生冒险', finance: '财务' }

export function AppLayout({
  page,
  children,
  className = '',
}: {
  page: AppPage
  children: ReactNode
  className?: string
}) {
  usePageTitle(pageTitles[page])
  return (
    <div className={`lifespace-app theme-light ${className}`}>
      <a className="skip-link" href="#page-title">跳到主要内容</a>
      <AppNavigation page={page} />
      <main>{children}</main>
    </div>
  )
}
