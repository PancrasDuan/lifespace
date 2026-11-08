import { readFile } from 'node:fs/promises'

const config = JSON.parse(await readFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), 'utf8'))
const binding = config.hyperdrive?.find((value) => value.binding === 'HYPERDRIVE')
if (!binding || !/^[a-f0-9]{32}$/i.test(binding.id) || /^0+$/.test(binding.id)) {
  throw new Error('发布前须完成 #149 数据库权限与 Hyperdrive 配置验收，并写入真实 binding ID。')
}
// Local credentials belong only to an ignored development environment. Even a
// configured local URL must not be written into the deployment configuration.
for (const context of [config, config.previews]) {
  for (const item of context?.hyperdrive ?? []) delete item.localConnectionString
}
await import('./strip-worker-dev-vars.mjs')
const { writeFile } = await import('node:fs/promises')
await writeFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), JSON.stringify(config))
