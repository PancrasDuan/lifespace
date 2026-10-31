import { Finance } from '../ledger/Finance'
import { Adventure } from '../adventure/Adventure'
import { Home } from '../home/Home'
import { News } from '../news/News'
import { usePagePath } from './navigation'
import { AuthGate } from '../auth/AuthGate'

export function App() {
  const path = usePagePath()
  return (
    <AuthGate>
      {path === '/finance' ? <Finance /> : path === '/adventure' ? (
        <Adventure />
      ) : path === '/news' ? (
        <News />
      ) : (
        <Home />
      )}
    </AuthGate>
  )
}
