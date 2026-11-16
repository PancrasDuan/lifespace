import { test, expect } from 'vitest'
import { createServer } from 'vite'
import { createServer as tcpServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sensitiveFileDeny } from '../../build-plugins/sensitive-file-deny'

test('isolated preview denies synthetic credential files and ignores dotenv without blocking public assets', async () => {
  // Keep the fixture itself outside test-results, whose entire subtree must be denied.
  const root = await realpath(await mkdtemp('/tmp/token219-http-policy-'))
  const files = ['.aws/credentials', '.codex/auth.json', '.npmrc', '.yarnrc.yml', 'gateway.pem', 'gateway.key', 'bundle.pfx', '.dev.vars', '.env.local', 'test-results/state.sqlite', 'dist/lifespace/wrangler.json']
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    for (const file of files) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), 'synthetic-private-marker') }
    await writeFile(join(root, '.env'), 'VITE_TOKEN219_DOTENV_PROBE=synthetic-private-marker\n')
    await writeFile(join(root, 'public-check.txt'), 'synthetic-public-asset')
    const socket = tcpServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
    const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()))
    server = await createServer({ root, configFile: false, envDir: false, logLevel: 'silent', server: { host: '127.0.0.1', port, strictPort: true, ws: false, hmr: false, fs: { deny: sensitiveFileDeny(root, ['**/test-results/**']) } } })
    await server.listen()
    expect(server.config.env.VITE_TOKEN219_DOTENV_PROBE).toBeUndefined()
    for (const file of [...files, '.env']) {
      const response = await fetch(`http://127.0.0.1:${port}/${file}`)
      expect(response.status, file).toBe(403)
      expect(await response.text(), file).not.toContain('synthetic-private-marker')
    }
    expect(await (await fetch(`http://127.0.0.1:${port}/public-check.txt`)).text()).toBe('synthetic-public-asset')
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }) }
})
