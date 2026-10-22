import { defineConfig } from 'vitest/config'

// Historical single-table/cycle tests live under tests/legacy and are opt-in.
export default defineConfig({ test: { include: ['tests/api/**/*.test.ts'], restoreMocks: true } })
