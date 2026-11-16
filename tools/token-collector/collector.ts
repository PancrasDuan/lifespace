import { join } from 'node:path'
import { hostname } from 'node:os'
import { collectTokscaleUsage } from './tokscale-cli.ts'
import { assessCoverage, inventory } from './coverage.ts'
import { clearParserCache, priceFingerprint, refreshPrices } from './prices.ts'
import { privateDirectory, validatePrivateTree } from './local.ts'
import { uploadPending } from './transport.ts'
import type { Store } from './store.ts'

export async function scan(store: Store, stateDir: string, options: { rescan?: boolean; offline?: boolean } = {}) {
  const config = store.config(), configDir = join(stateDir, 'tokscale')
  await privateDirectory(configDir); await validatePrivateTree(configDir)
  // Attempt once per day, including the first run with an empty price cache.
  // Failures retain cached catalogues and never prevent local token accounting.
  const price = store.get('price') as { at: number } | undefined
  if (!options.offline && (!price || Date.now() - price.at >= 86400000)) await refreshPrices(store, configDir)
  if (options.rescan) await clearParserCache(configDir)
  const before = await inventory(config.sourceHome)
  const report = await collectTokscaleUsage({ homeDir: config.sourceHome, configDir }, {
    deviceId: config.deviceId, metadata: { schemaVersion: 1, statisticsVersion: 'tokscale-codex-1', tool: { name: 'tokscale', version: '4.23.0' },
      priceVersion: await priceFingerprint(configDir), scannedAt: new Date().toISOString(), hostname: hostname() },
  })
  const after = await inventory(config.sourceHome)
  const allDates = [...new Set([...store.dates(), ...report.snapshots.map(s => s.identity.date), ...before.files.flatMap(f => f.dates), ...after.files.flatMap(f => f.dates)])]
  const coverage = await assessCoverage(store.sources(), before, after, allDates, report.sourceDiagnostic)
  // Empty graph days cannot prove intentional zero usage under this upstream
  // contract; preserve their last value instead of manufacturing zero snapshots.
  for (const day of store.dates()) if (!report.snapshots.some(s => s.identity.date === day)) coverage.blocked.add(day)
  if (store.dates().some(day => !report.snapshots.some(s => s.identity.date === day))) coverage.diagnostics.push('GRAPH_DAY_ABSENT')
  await validatePrivateTree(configDir)
  const prepared = await store.prepareSnapshots(report.snapshots)
  store.saveScan(prepared, coverage.proofs, coverage.blocked, [...coverage.diagnostics, ...report.diagnostics])
  return { dates: report.snapshots.length, blockedDates: [...coverage.blocked].sort(), diagnostics: [...coverage.diagnostics, ...report.diagnostics] }
}
export async function synchronize(store: Store, stateDir: string, options: { rescan?: boolean; offline?: boolean } = {}) {
  // A failed/interrupted scan cannot erase existing tasks. Still attempt their
  // upload and heartbeat if connectivity is available on a subsequent run.
  let scanResult: Awaited<ReturnType<typeof scan>> | undefined
  let scanFailed = false
  try { scanResult = await scan(store, stateDir, options) }
  catch { scanFailed = true; store.set('scan', { at: Date.now(), diagnostics: ['SCAN_UNCONFIRMED'], blockedDates: store.dates() }) }
  const upload = options.offline ? { uploaded: 0, pending: store.tasks().length, heartbeat: false } : await uploadPending(store, hostname())
  return { scan: scanResult ?? { diagnostics: ['SCAN_UNCONFIRMED'] }, scanFailed, ...upload }
}
