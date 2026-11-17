import { join } from 'node:path'
import { hostname } from 'node:os'
import { collectTokscaleUsage } from './tokscale-cli.ts'
import { clearParserCache, priceFingerprint, refreshPrices } from './prices.ts'
import { privateDirectory, validatePrivateTree } from './local.ts'
import { uploadPending } from './transport.ts'
import type { Agent, Store } from './store.ts'

export async function scan(store: Store, stateDir: string, options: { rescan?: boolean; offline?: boolean } = {}) {
  const config = store.config(), configDir = join(stateDir, 'tokscale')
  await privateDirectory(configDir); await validatePrivateTree(configDir)
  // Attempt once per day, including the first run with an empty price cache.
  // Failures retain cached catalogues and never prevent local token accounting.
  const price = store.get('price') as { at: number } | undefined
  if (!options.offline && (!price || Date.now() - price.at >= 86400000)) await refreshPrices(store, configDir)
  if (options.rescan) await clearParserCache(configDir)
  const report = await collectTokscaleUsage({ homeDir: config.sourceHome, configDir, agents: config.agents }, {
    deviceId: config.deviceId, metadata: { schemaVersion: 1, statisticsVersion: 'tokscale-multi-agent-1', tool: { name: 'tokscale', version: '4.23.0' },
      priceVersion: await priceFingerprint(configDir), scannedAt: new Date().toISOString(), hostname: hostname() },
  })
  if (report.snapshots.some(snapshot => !config.agents.includes(snapshot.identity.agent as Agent))) {
    throw new Error('Tokscale 返回了未授权 Agent；未生成汇总')
  }
  // Tokscale owns source parsing and accounting. A missing graph day supplies
  // no replacement; retain its prior snapshot without manufacturing zero.
  const reported = new Set(report.snapshots.map(snapshot => `${snapshot.identity.date}\0${snapshot.identity.agent}`))
  const retainedDates = [...new Set(store.rollupKeys()
    .filter(row => config.agents.includes(row.agent as Agent) && !reported.has(`${row.date}\0${row.agent}`))
    .map(row => row.date))].sort()
  const diagnostics = [...report.diagnostics, ...(retainedDates.length ? ['GRAPH_DAY_ABSENT'] : [])]
  await validatePrivateTree(configDir)
  const prepared = await store.prepareSnapshots(report.snapshots)
  store.saveScan(prepared, diagnostics, retainedDates)
  return { snapshots: report.snapshots.length, retainedDates, diagnostics }
}
export async function synchronize(store: Store, stateDir: string, options: { rescan?: boolean; offline?: boolean } = {}) {
  // A failed/interrupted scan cannot erase existing tasks. Still attempt their
  // upload and heartbeat if connectivity is available on a subsequent run.
  let scanResult: Awaited<ReturnType<typeof scan>> | undefined
  let scanFailed = false
  try { scanResult = await scan(store, stateDir, options) }
  catch { scanFailed = true; store.set('scan', { at: Date.now(), diagnostics: ['SCAN_UNCONFIRMED'] }) }
  const upload = options.offline ? { uploaded: 0, pending: store.tasks().length, heartbeat: false } : await uploadPending(store, hostname())
  return { scan: scanResult ?? { diagnostics: ['SCAN_UNCONFIRMED'] }, scanFailed, ...upload }
}
