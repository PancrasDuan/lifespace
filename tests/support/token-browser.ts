import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'

// The page loads the real Vite/React app. Only same-origin API transport is
// redirected to the isolated Worker HTTP server; no API response is fabricated.
export async function withTokenBrowser(workerUrl: string, accessToken: string, owner: string, run: (page: Page) => Promise<void>) {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('Missing local address')
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()))
  const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, WRANGLER_LOG_PATH: './test-results/token-browser-vite.log', CLOUDFLARE_DEV_REGISTRY_PATH: './test-results/token-browser-registry' }, stdio: 'ignore' })
  let browser
  try {
    const origin = `http://127.0.0.1:${port}`, deadline = Date.now() + 30000
    for (;;) {
      try { if ((await fetch(origin)).ok) break } catch {}
      if (Date.now() >= deadline || vite.exitCode !== null) throw new Error('Isolated browser app failed to start')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    browser = await chromium.launch({ env: { ...process.env, ...(process.env.TOKEN_BROWSER_TMPDIR ? { TMPDIR: process.env.TOKEN_BROWSER_TMPDIR } : {}) }, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' })
    await context.addInitScript(({ accessToken, owner }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: accessToken, refresh_token: 'isolated-browser-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: owner, email: 'collector@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }))
    }, { accessToken, owner })
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const response = await fetch(workerUrl + url.pathname + url.search, { method: request.method(), headers: request.headers(), ...(request.method() !== 'GET' ? { body: request.postData() } : {}) })
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
    const page = await context.newPage()
    await run(page)
  } finally {
    await browser?.close()
    if (vite.exitCode === null) { vite.kill('SIGTERM'); await once(vite, 'exit') }
  }
}
