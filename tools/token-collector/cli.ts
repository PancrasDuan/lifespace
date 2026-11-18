#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { hostname, homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { defaultStateDir, LocalError, noSymlinkPath, platform, requireNode24, systemDeviceId } from './local.ts'
import { agentsSchema, configSchema, hoursSchema, Store, supportedAgents, type Agent } from './store.ts'
import { claimRegistration, endpoint, registrationDisplay, startRegistration } from './transport.ts'
import { synchronize } from './collector.ts'
import { refreshPrices } from './prices.ts'
import { applySchedule, schedulePlan, scheduleStatus } from './schedule.ts'

process.umask(0o077)
const help = `LifeSpace usage collector 0.1.6 (Node >=24.22.1 <25, Tokscale 4.23.0)
init --server https://lifespace.example [--source-home /absolute/home] [--agents codex,grok] [--replace]
authorize [--wait]                 Continue saved browser authorization
sync [--rescan] [--offline]        Scan all history; upload immutable queue
sources list                       Show locally authorized Agent sources
sources add --agents claude        Add explicit sources
sources set --agents codex,grok    Replace sources with an explicit list
status                            Local redacted diagnostics
prices refresh                    Refresh official Tokscale price caches
timer install|uninstall|status [--hours 1|3|6|8|12|24] [--apply]
upgrade --archive /absolute/release.tgz --prefix /absolute/install [--apply]
All stateful commands accept --state-dir /absolute/private/directory.
Timer/upgrade print a plan unless --apply is explicitly supplied.
init --test-loopback permits numeric loopback HTTP for isolated tests only.
All supported Agent sources are collected by default; pass --agents to narrow.
State written before 0.1.6 must be re-initialized with init --replace.
`
function parseAgents(value: string | undefined, fallback: Agent[]): Agent[] {
  if (value === undefined) return fallback
  if (!value.trim()) throw new LocalError('AGENTS_REQUIRED')
  const parsed = agentsSchema.safeParse(value.split(',').map(item => item.trim()))
  if (!parsed.success) throw new LocalError('AGENTS_INVALID')
  return parsed.data
}
async function main() {
  requireNode24()
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'state-dir': { type: 'string' }, server: { type: 'string' }, 'source-home': { type: 'string' }, hours: { type: 'string' },
    agents: { type: 'string' },
    'test-loopback': { type: 'boolean' }, replace: { type: 'boolean' }, wait: { type: 'boolean' }, rescan: { type: 'boolean' }, offline: { type: 'boolean' },
    apply: { type: 'boolean' }, archive: { type: 'string' }, prefix: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' },
  } })
  if (values.help || values.version || !positionals.length) { console.log(help); return }
  const stateDir = resolve(values['state-dir'] ?? defaultStateDir())
  const store = await Store.open(stateDir)
  try {
    const command = positionals[0]
    if (command === 'status') { console.log(JSON.stringify(store.status(), null, 2)); return }
    if (command === 'init') {
      const deviceId = await systemDeviceId(), prior = store.get('config')
      if (prior && !values.replace) throw new LocalError('ALREADY_INITIALIZED_USE_AUTHORIZE_OR_REPLACE')
      const priorConfig = prior ? store.legacyConfig() : undefined
      const server = endpoint(values.server ?? priorConfig?.server ?? '', values['test-loopback'] === true).href
      if (new URL(server).pathname !== '/') throw new LocalError('SERVER_ORIGIN_REQUIRED')
      const sourceHome = values['source-home'] ?? priorConfig?.sourceHome ?? homedir(); if (!isAbsolute(sourceHome)) throw new LocalError('SOURCE_HOME_ABSOLUTE_REQUIRED')
      if (priorConfig && priorConfig.deviceId !== deviceId) throw new LocalError('SYSTEM_ID_CHANGED')
      // Sources are never inherited: init always states them explicitly.
      const agents = parseAgents(values.agents, [...supportedAgents])
      const agentsMode = values.agents === undefined ? 'all' : 'explicit'
      const config = configSchema.parse({ deviceId, server, sourceHome: resolve(sourceHome), hours: hoursSchema.parse(Number(values.hours ?? priorConfig?.hours ?? 1)), loopback: values['test-loopback'] === true, agents, agentsMode })
      if (priorConfig && (config.server !== priorConfig.server || config.sourceHome !== priorConfig.sourceHome)) throw new LocalError('EXISTING_PROFILE_SCOPE_CANNOT_CHANGE')
      store.set('config', config)
      console.log(JSON.stringify(await startRegistration(store, config, hostname(), platform())))
      return
    }
    const config = store.config()
    if (command === 'sources') {
      const action = positionals[1]
      if (!['list', 'add', 'set'].includes(action)) throw new LocalError('COMMAND_INVALID')
      if (action === 'list') { console.log(JSON.stringify({ agents: config.agents, agentsMode: config.agentsMode, supported: supportedAgents })); return }
      if (values.agents === undefined) throw new LocalError('AGENTS_REQUIRED')
      const requested = parseAgents(values.agents, [])
      if (action === 'set') {
        const agents = agentsSchema.parse(requested)
        store.set('config', { ...config, agents, agentsMode: 'explicit' })
        console.log(JSON.stringify({ agents, agentsMode: 'explicit' }))
        return
      }
      if (config.agentsMode === 'all') {
        console.log(JSON.stringify({ agents: config.agents, agentsMode: config.agentsMode, added: [] }))
        return
      }
      const added = requested.filter(agent => !config.agents.includes(agent))
      const agents = agentsSchema.parse([...config.agents, ...added])
      store.set('config', { ...config, agents, agentsMode: 'explicit' })
      console.log(JSON.stringify({ agents, agentsMode: 'explicit', added }))
      return
    }
    if (command === 'authorize') {
      if (!store.get('registration')) throw new LocalError('REGISTRATION_MISSING_RUN_INIT_REPLACE')
      console.log(JSON.stringify(registrationDisplay(store)))
      for (;;) {
        const result = await claimRegistration(store)
        console.log(JSON.stringify(result))
        if (!values.wait || !result.waitMs) break
        await new Promise(r => setTimeout(r, Math.min(result.waitMs!, 10000)))
      }
    } else if (command === 'sync') {
      const result = await synchronize(store, stateDir, { rescan: values.rescan, offline: values.offline })
      console.log(JSON.stringify(result))
      if (result.scanFailed || (!values.offline && (!result.heartbeat || result.pending))) process.exitCode = 1
    } else if (command === 'prices' && positionals[1] === 'refresh') {
      console.log(JSON.stringify({ result: await refreshPrices(store, join(stateDir, 'tokscale')) }))
    } else if (command === 'timer') {
      const action = positionals[1]
      if (!['install', 'uninstall', 'status'].includes(action)) throw new LocalError('COMMAND_INVALID')
      const hours = hoursSchema.parse(Number(values.hours ?? config.hours))
      const plan = schedulePlan(platform(), stateDir, hours)
      if (action === 'status') { console.log(JSON.stringify({ configured: store.get('schedule') ?? null, system: await scheduleStatus(platform()), plan }, null, 2)); return }
      console.log(JSON.stringify({ action, hours, plan }, null, 2))
      if (values.apply) {
        await applySchedule(plan, action === 'install')
        store.transaction(() => { store.set('config', { ...config, hours }); store.set('schedule', { installed: action === 'install', hours }) })
      }
    } else if (command === 'upgrade') {
      const archive = values.archive, prefix = values.prefix
      if (!archive || !prefix || !isAbsolute(archive) || !isAbsolute(prefix) || !archive.endsWith('.tgz')) throw new LocalError('UPGRADE_LOCAL_ARCHIVE_AND_PREFIX_REQUIRED')
      await noSymlinkPath(archive); await noSymlinkPath(prefix)
      const npm = join(resolve(process.execPath, '..'), 'npm')
      const args = ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', archive]
      console.log(JSON.stringify({ executable: npm, args, next: 'Use the installed lifespace-usage to inspect status and reinstall timer with the same --state-dir.' }))
      if (values.apply) {
        try { await promisify(execFile)(npm, args, { timeout: 120000, maxBuffer: 1024 * 1024, env: { PATH: `${resolve(process.execPath, '..')}:/usr/bin:/bin`, HOME: homedir() } as unknown as NodeJS.ProcessEnv }) }
        catch { throw new LocalError('UPGRADE_INSTALL_FAILED_STATE_PRESERVED') }
      }
    } else throw new LocalError('COMMAND_INVALID')
  } finally { store.close() }
}
main().catch(error => { console.error(JSON.stringify({ error: error instanceof LocalError ? error.code : 'COMMAND_FAILED' })); process.exitCode = 1 })
