import type { ReactNode } from 'react'
import {
  ChartNoAxesCombined,
  Mountain,
  House,
  ListTodo,
  Newspaper,
  Settings2,
  Target,
  Wallet,
} from 'lucide-react'
import { PageLink } from './navigation'
import './app.css'

export function AppLayout({
  page,
  children,
  openSettings,
  className = '',
}: {
  page: 'home' | 'news' | 'adventure' | 'finance'
  children: ReactNode
  className?: string
  openSettings?: () => void
}) {
  return (
    <div className={`lifespace-app theme-light ${className}`}>
      <aside className="sidebar" aria-label="主导航">
        <PageLink className="brand-mark" href="/" aria-label="LifeSpace 首页">
          <img src="/favicon.svg" alt="" width={38} height={38} />
        </PageLink>
        <nav>
          <PageLink
            className={page === 'home' ? 'nav-item active' : 'nav-item'}
            href="/"
            aria-current={page === 'home' ? 'page' : undefined}
          >
            <House size={20} />
            <span>首页</span>
          </PageLink>
          <PageLink
            className={page === 'news' ? 'nav-item active' : 'nav-item'}
            href="/news"
            aria-current={page === 'news' ? 'page' : undefined}
          >
            <Newspaper size={20} />
            <span>新闻</span>
          </PageLink>
          <PageLink
            className={page === 'adventure' ? 'nav-item active' : 'nav-item'}
            href="/adventure"
            aria-current={page === 'adventure' ? 'page' : undefined}
          >
            <Mountain size={20} />
            <span>人生冒险</span>
          </PageLink>
          {[
            { title: '任务管理', icon: ListTodo },
            { title: '个人目标', icon: Target },
            { title: '财务', icon: Wallet },
            { title: '股票行情', icon: ChartNoAxesCombined },
          ].map(({ title, icon: Icon }) => title === '财务' ? (
            <PageLink
              key={title}
              className={page === 'finance' ? 'nav-item active' : 'nav-item'}
              href="/finance"
              aria-current={page === 'finance' ? 'page' : undefined}
            >
              <Icon size={20} />
              <span>{title}</span>
            </PageLink>
          ) : (
            <button className="nav-item" disabled key={title}>
              <Icon size={20} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        {openSettings && (
          <button
            className="nav-settings"
            aria-label="打开设置"
            onClick={openSettings}
          >
            <Settings2 size={20} />
            <span>设置</span>
          </button>
        )}
      </aside>
      <main>{children}</main>
    </div>
  )
}
