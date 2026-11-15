import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureParent, isMissing, LocalError, noSymlinkPath, privateFile } from './local.ts'
import { hoursSchema } from './store.ts'

const label = 'com.lifespace.token-collector'
type Command = { file: string; args: string[] }
export type SchedulePlan = { files: { path: string; content: string }[]; install: Command[]; uninstall: Command[] }
function safe(value: string) { if (!isAbsolute(value) || /[\0\r\n]/.test(value)) throw new LocalError('SCHEDULE_PATH_INVALID'); return value }
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const systemd = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, () => '$$') + '"'
export function schedulePlan(kind: 'linux' | 'macos', stateDir: string, hours: number, home = homedir(), node = process.execPath, cli = fileURLToPath(new URL('./cli.js', import.meta.url)), uid = process.getuid!()): SchedulePlan {
  hoursSchema.parse(hours); [stateDir, home, node, cli].forEach(safe)
  const args = [node, cli, 'sync', '--state-dir', stateDir]
  if (kind === 'macos') {
    const path = join(home, 'Library/LaunchAgents', label + '.plist')
    return { files: [{ path, content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array><key>StartInterval</key><integer>${hours * 3600}</integer><key>RunAtLoad</key><true/><key>Umask</key><integer>63</integer></dict></plist>\n` }],
      install: [{ file: '/bin/launchctl', args: ['bootstrap', `gui/${uid}`, path] }], uninstall: [{ file: '/bin/launchctl', args: ['bootout', `gui/${uid}/${label}`] }] }
  }
  const dir = join(home, '.config/systemd/user')
  return { files: [
    { path: join(dir, label + '.service'), content: `[Unit]\nDescription=LifeSpace local token usage\n[Service]\nType=oneshot\nUMask=0077\nExecStart=${args.map(systemd).join(' ')}\n` },
    { path: join(dir, label + '.timer'), content: `[Unit]\nDescription=LifeSpace local token usage timer\n[Timer]\nOnStartupSec=5min\nOnUnitActiveSec=${hours}h\nPersistent=true\n[Install]\nWantedBy=timers.target\n` },
  ], install: [{ file: '/usr/bin/systemctl', args: ['--user', 'daemon-reload'] }, { file: '/usr/bin/systemctl', args: ['--user', 'enable', '--now', label + '.timer'] }],
  uninstall: [{ file: '/usr/bin/systemctl', args: ['--user', 'disable', '--now', label + '.timer'] }, { file: '/usr/bin/systemctl', args: ['--user', 'daemon-reload'] }] }
}
async function run(command: Command) {
  try { await promisify(execFile)(command.file, command.args, { timeout: 10000, maxBuffer: 65536 }) }
  catch { throw new LocalError('SCHEDULER_COMMAND_FAILED') }
}
export async function applySchedule(plan: SchedulePlan, install: boolean, execute = run) {
  let present = 0
  for (const file of plan.files) {
    await noSymlinkPath(file.path)
    try { await readFile(file.path); await privateFile(file.path); present++ } catch (e) { if (!isMissing(e)) throw e }
  }
  if (!install) {
    if (present === 0) return
    await execute(plan.uninstall[0])
    for (const file of plan.files) await rm(file.path, { force: true })
    for (const command of plan.uninstall.slice(1)) await execute(command)
    return
  }
  let changed = false
  for (const file of plan.files) {
    let old: string | undefined
    try { old = await readFile(file.path, 'utf8') } catch (e) { if (!isMissing(e)) throw e }
    if (old === file.content) continue
    changed = true
    await ensureParent(file.path)
    const temp = join(dirname(file.path), `.${label}.${process.pid}.tmp`)
    await writeFile(temp, file.content, { mode: 0o600, flag: 'wx' }); await rename(temp, file.path)
  }
  // Repeated installation is idempotent. For launchd a changed interval needs
  // bootout/bootstrap. An unchanged plist is successful only when the job is
  // actually loaded: a previous bootstrap may have failed after writing it.
  if (plan.install[0].file === '/bin/launchctl') {
    if (!changed) {
      try { await execute({ file: '/bin/launchctl', args: ['print', plan.uninstall[0].args[1]] }); return }
      catch { /* Retry bootstrap of an existing but not loaded plist. */ }
    } else { try { await execute(plan.uninstall[0]) } catch { /* Not installed yet. */ } }
  }
  for (const command of plan.install) await execute(command)
}
export async function scheduleStatus(kind: 'linux' | 'macos', uid = process.getuid!()) {
  if (kind === 'macos') {
    try { await run({ file: '/bin/launchctl', args: ['print', `gui/${uid}/${label}`] }); return { loaded: true } }
    catch { return { loaded: null, diagnostic: 'NOT_LOADED_OR_SCHEDULER_UNAVAILABLE' } }
  }
  const query = async (action: string) => {
    try { const r = await promisify(execFile)('/usr/bin/systemctl', ['--user', action, label + '.timer'], { timeout: 10000, maxBuffer: 65536 }); return r.stdout.trim() }
    catch { return 'inactive_or_unavailable' }
  }
  const enabled = await query('is-enabled'), active = await query('is-active')
  return { enabled: enabled === 'enabled', active: active === 'active', ...(enabled === 'inactive_or_unavailable' || active === 'inactive_or_unavailable' ? { diagnostic: 'NOT_ENABLED_OR_SCHEDULER_UNAVAILABLE' } : {}) }
}
