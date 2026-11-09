import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Historical single-table/cycle tests live under tests/legacy and are opt-in.
// Vitest 没有 cloudflare:workers；桩模块默认不返回 span，因此打点是无操作。
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/support/cloudflare-workers.ts', import.meta.url)) } },
  test: { include: ['tests/api/**/*.test.ts'], restoreMocks: true },
})
