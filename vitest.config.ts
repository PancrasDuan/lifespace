import { defineConfig } from 'vitest/config'

// The legacy JSON/cycle engine remains archived in source but is not the current adventure backend.
export default defineConfig({ test: { include: ['tests/api/**/*.test.ts'], exclude: ['tests/api/adventure-domain.test.ts', 'tests/api/adventure-storage.test.ts'], restoreMocks: true } })
