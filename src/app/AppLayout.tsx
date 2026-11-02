import type { ReactNode } from 'react'
import { AppNavigation, type AppPage } from './AppNavigation'
import './app.css'

export function AppLayout({
  page,
  children,
  openSettings,
  className = '',
}: {
  page: AppPage
  children: ReactNode
  className?: string
  openSettings?: () => void
}) {
  return (
    <div className={`lifespace-app theme-light ${className}`}>
      <AppNavigation page={page} openSettings={openSettings} />
      <main>{children}</main>
    </div>
  )
}
