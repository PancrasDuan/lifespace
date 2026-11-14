import { PageContent } from './PageContent'
import { usePagePath } from './navigation'
import { AuthGate } from '../auth/AuthGate'
import { McpAuthorization, McpGrants } from '../auth/McpAuthorization'

export function App() {
  const path = usePagePath()
  return (
    <AuthGate>
      {path === '/oauth/authorize' ? <McpAuthorization /> : path === '/oauth/grants' ? <McpGrants /> : <PageContent page={path === '/finance' ? 'finance' : path === '/adventure' ? 'adventure' : path === '/news' ? 'news' : 'home'} />}
    </AuthGate>
  )
}
