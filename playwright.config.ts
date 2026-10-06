import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/browser', timeout: 15000, fullyParallel: false, workers: 1,
  outputDir: '.cache/test-results',
  use: { baseURL: 'http://127.0.0.1:5175', headless: true, timezoneId: 'Asia/Shanghai', viewport: { width: 952, height: 954 }, trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false, env: { WRANGLER_LOG_PATH: './.cache/wrangler-test.log', MINIFLARE_REGISTRY_PATH: './.cache/test-registry' } },
})
