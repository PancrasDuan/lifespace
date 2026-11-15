import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { sha256, validatePrivateTree } from './local.ts'
import type { Store } from './store.ts'

const entry = join(dirname(createRequire(import.meta.url).resolve('@tokscale/cli/package.json')), 'bin.js')
const catalogs = ['pricing-litellm.json', 'pricing-openrouter.json', 'pricing-models-dev.json']
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, ordered(v)]))
  return value
}
export async function priceFingerprint(configDir: string): Promise<string | null> {
  const values: string[] = []
  for (const name of catalogs) {
    try { const v = JSON.parse(await readFile(join(configDir, 'cache', name), 'utf8')); if (v.data && typeof v.data === 'object' && !Array.isArray(v.data) && Object.keys(v.data).length && v.timestamp <= Date.now() / 1000) values.push(name + ':' + sha256(JSON.stringify(ordered(v.data)))) }
    catch { /* Missing/corrupt catalogs are reported by the actual upstream CLI. */ }
  }
  return values.length ? 'tokscale-catalogs-sha256:' + sha256(values.join('\n')) : null
}
export async function refreshPrices(store: Store, configDir: string) {
  await validatePrivateTree(configDir)
  const started = Date.now()
  const previous = await priceFingerprint(configDir)
  let result = 'updated'
  try {
    // No report, scan home, credentials or local usage is supplied to this
    // command. Pinned upstream downloads its public catalogues only.
    await promisify(execFile)(process.execPath, [entry, 'pricing', 'refresh', '--json', '--no-spinner'], {
      env: { HOME: configDir, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TOKSCALE_CONFIG_DIR: configDir, TZ: 'Asia/Shanghai',
        // Standard transport configuration only; no service/API credentials.
        ...Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR'].filter(k => process.env[k]).map(k => [k, process.env[k]])),
      } as unknown as NodeJS.ProcessEnv, timeout: 60_000, maxBuffer: 1024 * 1024,
    })
  } catch { result = 'refresh_failed_retained_cache' }
  await validatePrivateTree(configDir)
  const fingerprint = await priceFingerprint(configDir)
  if (result !== 'updated' && fingerprint !== null && fingerprint !== previous) result = 'partial_refresh_retained_cache'
  store.set('price', { at: started, result, fingerprint })
  return result
}
export async function clearParserCache(configDir: string) {
  await validatePrivateTree(configDir)
  for (const name of ['source-message-cache-v2', 'source-message-cache.bin']) await rm(join(configDir, 'cache', name), { recursive: true, force: true })
}
