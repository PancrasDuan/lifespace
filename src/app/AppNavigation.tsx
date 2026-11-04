import {
  ChartNoAxesCombined,
  House,
  ListTodo,
  Mountain,
  Newspaper,
  Target,
  Wallet,
} from 'lucide-react'
import { useContext } from 'react'
import { AccountMenu } from '../auth/AccountMenu'
import { VerifiedIdentityContext } from '../auth/identity'
import { PageLink } from './navigation'

export type AppPage = 'home' | 'news' | 'adventure' | 'finance'

const items = [
  { page: 'home', title: '首页', href: '/', icon: House },
  { page: 'news', title: '新闻', href: '/news', icon: Newspaper },
  { page: 'adventure', title: '人生冒险', href: '/adventure', icon: Mountain },
  { page: 'finance', title: '财务', href: '/finance', icon: Wallet },
  { title: '任务管理', icon: ListTodo },
  { title: '个人目标', icon: Target },
  { title: '股票行情', icon: ChartNoAxesCombined },
] as const

export function AppNavigation({ page }: { page: AppPage }) {
  const identity = useContext(VerifiedIdentityContext)
  return <aside className="sidebar app-navigation" aria-label="主导航">
    <PageLink className="brand-mark" href="/" aria-label="LifeSpace 首页">
      <img src="/favicon.svg" alt="" width={38} height={38} />
    </PageLink>
    <nav>
      {items.map(item => {
        const Icon = item.icon
        const content = <><Icon size={20} /><span>{item.title}</span></>
        return 'href' in item ? (
          <PageLink key={item.title} href={item.href}
            className={page === item.page ? 'nav-item active' : 'nav-item'}
            aria-current={page === item.page ? 'page' : undefined}>
            {content}
          </PageLink>
        ) : <button className="nav-item" type="button" disabled key={item.title}>{content}</button>
      })}
    </nav>
    <AccountMenu email={identity?.email} disabled={!identity} />
  </aside>
}
