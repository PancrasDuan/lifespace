import { Home } from '../home/Home'
import { News } from '../news/News'
import { usePagePath } from './navigation'

export function App() {
  return usePagePath() === '/news' ? <News /> : <Home />
}
