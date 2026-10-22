import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { startHoroscopeWorker, horoscopeTestToken, horoscopeTestUser } from './tests/fixtures/horoscope-worker'

// 显式启动的本地测试预览；默认 Vite/Worker 构建不加载此配置。
export default defineConfig(async () => {
  const worker = await startHoroscopeWorker({ longText: true })
  const session = { access_token: horoscopeTestToken, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: 4102444800, user: { ...horoscopeTestUser, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-11' } }
  return {
    plugins: [react(), {
      name: 'local-horoscope-preview',
      transformIndexHtml: () => [
        { tag: 'script', children: `localStorage.setItem('sb-auth-test-auth-token', ${JSON.stringify(JSON.stringify(session))});`, injectTo: 'head-prepend' },
        { tag: 'div', attrs: { style: 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:10000;padding:8px 16px;border-radius:20px;background:#c5dfb7;color:#183329;font:12px sans-serif;pointer-events:none' }, children: '开发预览 · 受控测试数据 · 未连接真实 ALAPI/KV', injectTo: 'body' },
      ],
      configureServer(server: ViteDevServer) {
        server.httpServer?.once('close', () => { void worker.close() })
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/api/') && !req.url.startsWith('/api/horoscope') && !req.url.startsWith('/api/auth/')) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { code: 'PREVIEW_NOT_CONFIGURED', message: '此预览仅配置星座数据' } }))
          } else next()
        })
      },
    }],
    server: { watch: { usePolling: true }, host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api/horoscope': worker.url, '/api/auth/': worker.url },
      fs: { deny: ['.env', '.env.*', '**/.dev.vars*', '**/.git/**', '**/.cache/**', '**/*.{pem,key}', '**/dist/lifespace/**'] } },
  }
})
