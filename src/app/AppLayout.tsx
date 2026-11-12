import { useEffect, useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { AppNavigation, type AppPage } from './AppNavigation'
import './app.css'

export function AppLayout({
  page,
  children,
  className = '',
}: {
  page: AppPage
  children: ReactNode
  className?: string
}) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  useEffect(() => {
    if (!className.includes('goal-view')) setNavigationOpen(false)
  }, [className])
  return (
    <div className={`lifespace-app theme-light ${className}${navigationOpen ? ' navigation-open' : ''}`}>
      {className.includes('goal-view') && <button type="button" className="goal-mobile-navigation" aria-label={navigationOpen ? '关闭导航' : '打开导航'}
        aria-controls="app-primary-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(value => !value)}><Menu size={19} /></button>}
      <AppNavigation page={page} />
      <main>{children}</main>
    </div>
  )
}
