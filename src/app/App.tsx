import { Home } from '../home/Home'
import { News } from '../news/News'
import { usePagePath } from './navigation'
import { AuthGate } from '../auth/AuthGate'

export function App() {
  const path = usePagePath()
  return <AuthGate>{path === '/news' ? <News /> : <Home />}</AuthGate>
}
