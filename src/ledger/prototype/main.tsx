import '../../home/home.css'
import '../../app/app.css'
import { createRoot } from 'react-dom/client'
import { LedgerPrototype } from './LedgerPrototype'

createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? <LedgerPrototype /> : <p>此原型仅供本地开发预览。</p>,
)
