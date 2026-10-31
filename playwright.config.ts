import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT || 5175)

export default defineConfig({
  testDir: 'tests/browser', timeout: 15000, fullyParallel: false, workers: 1,
  outputDir: '.cache/test-results',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : undefined, timezoneId: 'Asia/Shanghai', viewport: { width: 952, height: 954 }, trace: 'retain-on-failure' },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, env: { WRANGLER_LOG_PATH: './.cache/wrangler-test.log', MINIFLARE_REGISTRY_PATH: './.cache/test-registry' } },
})
