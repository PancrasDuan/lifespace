import { PageContent } from './PageContent'
import { usePagePath } from './navigation'
import { AuthGate } from '../auth/AuthGate'
import { McpAuthorization, McpGrants } from '../auth/McpAuthorization'
import { useEffect } from 'react'
import { rememberTokenConfirmation } from '../auth/token-confirmation-return'

export function App() {
  const path = usePagePath()
  useEffect(() => { rememberTokenConfirmation() }, [path])
  return (
    <AuthGate>
      {path === '/oauth/authorize' ? <McpAuthorization /> : path === '/oauth/grants' ? <McpGrants /> : <PageContent page={path === '/token' || path === '/token/devices/confirm' ? 'token' : path === '/finance' ? 'finance' : path === '/adventure' ? 'adventure' : path === '/news' ? 'news' : 'home'} />}
    </AuthGate>
  )
}
