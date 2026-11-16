import { readFile } from 'node:fs/promises'

// Run on the built production config before Wrangler can auto-provision resources.
// The repository keeps a placeholder until the user provides an approved namespace ID.
const config = JSON.parse(await readFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), 'utf8'))
const namespaces = config.kv_namespaces ?? []
const authBindings = namespaces.filter(binding => binding.binding === 'AUTH_KV')
const auth = authBindings[0]
const others = namespaces.filter(binding => binding.binding !== 'AUTH_KV').map(binding => binding.id)
if (authBindings.length !== 1 || !/^[a-f0-9]{32}$/.test(auth?.id ?? '') || others.includes(auth.id)) {
  console.error('发布已停止：须先批准并核对独立 AUTH_KV namespace，再将真实 ID 纳入配置；不会自动创建生产资源。')
  process.exit(1)
}
if (config.secrets?.required?.includes('AUTH_ALLOWED_EMAILS')) {
  console.error('发布已停止：AUTH_ALLOWED_EMAILS 必须从 Worker runtime secrets 移除，改由 AUTH_KV 读取。')
  process.exit(1)
}
if (config.vars?.AUTH_ALLOWED_EMAILS !== undefined || namespaces.some(binding => binding.binding === 'AUTH_ALLOWED_EMAILS')) {
  console.error('发布已停止：不得以普通变量或 KV binding 保留旧 AUTH_ALLOWED_EMAILS 配置。')
  process.exit(1)
}
console.log('AUTH_KV 发布配置检查通过。')
