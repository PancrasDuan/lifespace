import { publicAuthConfig } from './auth/config'

// Start both loads together. AuthGate handles config errors and offers a retry.
void publicAuthConfig().catch(() => {})
void import('./main')
