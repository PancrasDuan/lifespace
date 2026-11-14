import { PageContent } from './PageContent'
import { usePagePath } from './navigation'
import { AuthGate } from '../auth/AuthGate'

export function App() {
  const path = usePagePath()
  return (
    <AuthGate>
      <PageContent page={path === '/finance' ? 'finance' : path === '/adventure' ? 'adventure' : path === '/news' ? 'news' : 'home'} />
    </AuthGate>
  )
}
