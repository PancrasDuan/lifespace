import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')
// Throwaway preview: synthetic data only, no Worker or authentication.
export default defineConfig({
  root: fileURLToPath(new URL('./src/adventure/today-prototype/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [projectRoot], deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '**/.git/**', '**/.dev.vars*', '**/.cache/**', '**/.aws/**', `${projectRoot}/.codex/**`, '**/dist/lifespace/**'] } },
})
