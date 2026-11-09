import { readFile } from 'node:fs/promises'

const config = JSON.parse(await readFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), 'utf8'))

// Business traffic uses Worker -> Supabase Data API/PostgREST. Hyperdrive is
// retained as an idle resource after the selective rollback, but it is no
// longer a deployment prerequisite. If a binding is present, it must still be
// a real resource and never carry a local connection string into deployment.
const checkRestConnection = (context, label) => {
  const raw = context?.vars?.SUPABASE_URL
  if (typeof raw !== 'string') throw new Error(`${label}缺少 Supabase Data API 地址。`)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label}的 Supabase Data API 地址无效。`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port) {
    throw new Error(`${label}的 Supabase Data API 地址必须是项目根地址。`)
  }
}
checkRestConnection(config, '生产')
checkRestConnection(config.previews, '原生 Preview')
const required = config.secrets?.required
for (const name of ['SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
  if (!Array.isArray(required) || !required.includes(name)) throw new Error(`发布前必须声明 ${name} Secret。`)
}
for (const context of [config, config.previews]) {
  for (const binding of context?.hyperdrive ?? []) {
    if (binding.binding === 'HYPERDRIVE' && (!/^[a-f0-9]{32}$/i.test(binding.id ?? '') || /^0+$/.test(binding.id))) {
      throw new Error('保留的 Hyperdrive binding 必须使用真实资源 ID。')
    }
  }
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
    head_sampling_rate: value?.logs?.head_sampling_rate,
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
if (productionObservability.logs.enabled !== true || productionObservability.logs.head_sampling_rate !== 1 || productionObservability.logs.invocation_logs !== true || productionObservability.logs.persist !== true) {
  throw new Error('生产 observability 必须启用、全量采样并持久化 logs 与 invocation logs。')
}
if (productionObservability.traces.enabled !== true || productionObservability.traces.head_sampling_rate !== 1 || productionObservability.traces.persist !== true) {
  throw new Error('生产 observability 必须启用、全量采样并持久化 traces。')
}
if (JSON.stringify(productionObservability) !== JSON.stringify(observabilityContract(config.previews?.observability))) {
  throw new Error('生产与原生 Preview 的 observability 配置必须一致。')
}
// Local credentials belong only to an ignored development environment. Even a
// retained idle binding must not carry its local URL into deployment.
for (const context of [config, config.previews]) {
  for (const item of context?.hyperdrive ?? []) delete item.localConnectionString
}
await import('./strip-worker-dev-vars.mjs')
const { writeFile } = await import('node:fs/promises')
await writeFile(new URL('../dist/lifespace/wrangler.json', import.meta.url), JSON.stringify(config))
