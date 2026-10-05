import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => ({
  plugins: mode === 'prototype' ? [react()] : [react(), cloudflare()],
  server: { host: '127.0.0.1', watch: { usePolling: true } },
}))
