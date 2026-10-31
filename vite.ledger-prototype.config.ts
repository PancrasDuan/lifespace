import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

// Throwaway frontend preview: no Worker, authentication or business API bindings.
export default defineConfig({
  root: fileURLToPath(new URL('./src/ledger/prototype/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: true,
    watch: { usePolling: true },
    fs: {
      allow: [projectRoot],
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
        '**/.git/**', '**/.dev.vars*', '**/.cache/**', '**/.aws/**',
        `${projectRoot}/.codex/**`, '**/dist/lifespace/**',
      ],
    },
  },
})
