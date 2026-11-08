import { readFile } from 'node:fs/promises'

const config = JSON.parse(await readFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), 'utf8'))
const binding = config.hyperdrive?.find((value) => value.binding === 'HYPERDRIVE')
if (!binding || !/^[a-f0-9]{32}$/i.test(binding.id) || /^0+$/.test(binding.id)) {
  throw new Error('发布前须完成 #149 数据库权限与 Hyperdrive 配置验收，并写入真实 binding ID。')
}

// Production and the native Preview must ship the same observability contract.
// Without this guard a future top-level edit could silently restore traces=false
// or drop persistence/redaction while the Preview block stays correct.
const observabilityContract = (value) => ({
  enabled: value?.enabled,
  head_sampling_rate: value?.head_sampling_rate,
  redact_query_string: value?.redact_query_string,
  logs: {
    enabled: value?.logs?.enabled,
    invocation_logs: value?.logs?.invocation_logs,
    persist: value?.logs?.persist,
  },
  traces: {
    enabled: value?.traces?.enabled,
    head_sampling_rate: value?.traces?.head_sampling_rate,
    persist: value?.traces?.persist,
  },
})
const productionObservability = observabilityContract(config.observability)
if (productionObservability.enabled !== true || productionObservability.head_sampling_rate !== 1 || productionObservability.redact_query_string !== true) {
  throw new Error('生产 observability 必须开启、全量采样并脱敏查询串。')
}
if (productionObservability.logs.enabled !== true || productionObservability.logs.invocation_logs !== true || productionObservability.logs.persist !== true) {
  throw new Error('生产 observability 必须启用并持久化 logs 与 invocation logs。')
}
if (productionObservability.traces.enabled !== true || productionObservability.traces.head_sampling_rate !== 1 || productionObservability.traces.persist !== true) {
  throw new Error('生产 observability 必须启用、全量采样并持久化 traces。')
}
if (JSON.stringify(productionObservability) !== JSON.stringify(observabilityContract(config.previews?.observability))) {
  throw new Error('生产与原生 Preview 的 observability 配置必须一致。')
}
// Local credentials belong only to an ignored development environment. Even a
// configured local URL must not be written into the deployment configuration.
for (const context of [config, config.previews]) {
  for (const item of context?.hyperdrive ?? []) delete item.localConnectionString
}
await import('./strip-worker-dev-vars.mjs')
const { writeFile } = await import('node:fs/promises')
await writeFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), JSON.stringify(config))
