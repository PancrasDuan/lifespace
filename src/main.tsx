import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Home } from './home/Home'
import './home/home.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000, refetchOnWindowFocus: true } } })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Home /></QueryClientProvider>)
