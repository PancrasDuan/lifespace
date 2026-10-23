import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/legacy/**/*.test.ts'], restoreMocks: true } })
