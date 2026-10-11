// 本地认证界面原型：只提供固定静态文件，不调用任何业务或认证服务。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/prototype/auth', ['index.html', 'text/html; charset=utf-8']],
  ['/prototype/auth/', ['index.html', 'text/html; charset=utf-8']],
  ['/prototype/auth/gallery', ['previews/index.html', 'text/html; charset=utf-8']],
  ['/prototype/auth/home-preview.css', ['../../../src/home/home.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
])
const previewNames = JSON.parse(await readFile(new URL('previews/preview-check.json', import.meta.url), 'utf8')).captures
for (const name of [...previewNames, 'A-desktop-mobile.png', 'B-desktop-mobile.png', 'C-desktop-mobile.png']) {
  routes.set('/prototype/auth/previews/' + name, ['previews/' + name, 'image/png'])
}
createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, 'http://127.0.0.1:8793').pathname)
  if (request.method !== 'GET' || !route) { response.writeHead(404); response.end('页面不存在'); return }
  response.writeHead(200, {
    'Content-Type': route[1], 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  })
  let body = await readFile(new URL(route[0], import.meta.url))
  if (route[1].startsWith('text/css')) body = '@layer lifespace-home {\n' + body.toString().replaceAll('.lifespace-app main', '.lifespace-app .home-preview-main') + '\n}'
  response.end(body)
}).listen(8793, '127.0.0.1', () => console.log('认证原型：http://127.0.0.1:8793/prototype/auth?variant=A'))
