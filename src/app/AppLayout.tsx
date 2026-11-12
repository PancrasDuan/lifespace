import type { ReactNode } from 'react'
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
  return (
    <div className={`lifespace-app theme-light ${className}`}>
      <AppNavigation page={page} />
      <main>{children}</main>
    </div>
  )
}
