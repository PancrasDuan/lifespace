import { readFile } from 'node:fs/promises'

// Run on the built production config before Wrangler can auto-provision resources.
// An unbound namespace is valid for local work, never for a production deploy.
const config = JSON.parse(await readFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), 'utf8'))
const namespace = config.kv_namespaces?.find(binding => binding.binding === 'OAUTH_KV')
if (!/^[a-f0-9]{32}$/.test(namespace?.id ?? '') || namespace.id === config.kv_namespaces?.find(binding => binding.binding === 'HOROSCOPE_KV')?.id) {
  console.error('发布已停止：须先批准并核对独立 OAUTH_KV namespace，再将真实 ID 纳入配置；不会自动创建生产资源。')
  process.exit(1)
}
if (config.vars?.MCP_OAUTH_ISSUER !== 'https://lifespace.onepeace.cc.cd') {
  console.error('发布已停止：MCP_OAUTH_ISSUER 必须为已批准的生产规范地址。')
  process.exit(1)
}
console.log('MCP OAuth 发布配置检查通过。')
