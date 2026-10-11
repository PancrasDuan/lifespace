import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { host: '127.0.0.1', watch: { usePolling: true }, fs: {
    deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
      '**/.dev.vars*', '**/.cache/**', '**/.aws/**', `${projectRoot}/.codex/**`, '**/dist/lifespace/**'],
  } },
})
