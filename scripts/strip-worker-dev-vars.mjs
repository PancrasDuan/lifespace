import { rm } from 'node:fs/promises'

// Vite 插件生成的 .dev.vars 仅供本地 preview；部署产物不能携带本地凭据。
await rm(new URL('../dist/lifespace/.dev.vars', import.meta.url), { force: true })
