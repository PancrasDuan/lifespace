import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'
import { readFile, rm, writeFile } from 'node:fs/promises'

const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    // The Vite plugin serializes local dev vars beside the Worker bundle for preview.
    // Never leave that generated secret file on disk after a production build.
    {
      name: 'remove-development-credentials',
      apply: 'build',
      async closeBundle() {
        const file = new URL('./dist/lifespace/.dev.vars', import.meta.url)
        await rm(file, { force: true })
        const configFile = new URL('./dist/lifespace/wrangler.json', import.meta.url)
        const config = JSON.parse(await readFile(configFile, 'utf8'))
        for (const binding of config.hyperdrive ?? []) delete binding.localConnectionString
        await writeFile(configFile, JSON.stringify(config))
      },
    },
  ],
  server: { host: '127.0.0.1', watch: { usePolling: true }, fs: {
    deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
      '**/.dev.vars*', '**/.cache/**', '**/.aws/**', `${projectRoot}/.codex/**`, '**/dist/lifespace/**'],
  } },
})
