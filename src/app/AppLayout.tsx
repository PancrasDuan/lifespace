import type { ReactNode } from 'react'
import { ChartNoAxesCombined, House, ListTodo, Newspaper, Settings2, Target, Wallet } from 'lucide-react'
import { PageLink } from './navigation'
import './app.css'

export function AppLayout({ page, children, openSettings }: { page: 'home' | 'news'; children: ReactNode; openSettings?: () => void }) {
  return <div className="lifespace-app theme-light">
    <aside className="sidebar" aria-label="主导航">
      <PageLink className="brand-mark" href="/" aria-label="LifeSpace 首页"><img src="/favicon.svg" alt="" width={38} height={38} /></PageLink>
      <nav>
        <PageLink className={page === 'home' ? 'nav-item active' : 'nav-item'} href="/" aria-current={page === 'home' ? 'page' : undefined}><House size={20} /><span>首页</span></PageLink>
        <PageLink className={page === 'news' ? 'nav-item active' : 'nav-item'} href="/news" aria-current={page === 'news' ? 'page' : undefined}><Newspaper size={20} /><span>新闻</span></PageLink>
        {[{ title: '任务管理', icon: ListTodo }, { title: '个人目标', icon: Target }, { title: '财务', icon: Wallet }, { title: '股票行情', icon: ChartNoAxesCombined }].map(({ title, icon: Icon }) => <button className="nav-item" disabled key={title}><Icon size={20} /><span>{title}</span></button>)}
      </nav>
      {openSettings && <button className="nav-settings" aria-label="打开设置" onClick={openSettings}><Settings2 size={20} /><span>设置</span></button>}
    </aside>
    <main>{children}</main>
  </div>
}
