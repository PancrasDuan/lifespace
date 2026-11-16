import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

export class LocalError extends Error {
  constructor(readonly code: string) { super(code) }
}
export function requireNode24(version = process.versions.node) {
  // Keep the tested stable runtime boundary before any CLI state is opened.
  // Tokscale owns source decoding; this guard does not audit source files.
  const match = /^24\.(\d+)\.(\d+)$/.exec(version)
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 1)) throw new LocalError('NODE_24_22_1_REQUIRED')
}
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
export function platform(): 'linux' | 'macos' {
  if (process.platform === 'linux') return 'linux'
  if (process.platform === 'darwin') return 'macos'
  throw new LocalError('UNSUPPORTED_PLATFORM')
}
export function defaultStateDir() {
  return platform() === 'macos' ? join(homedir(), 'Library/Application Support/LifeSpace/token') : join(homedir(), '.local/share/lifespace-token')
}
export async function noSymlinkPath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new LocalError('UNSAFE_PATH')
  const parts = path.slice(parse(path).root.length).split('/').filter(Boolean)
  let cursor = parse(path).root
  for (const part of parts) {
    cursor = join(cursor, part)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new LocalError('UNSAFE_SYMLINK') }
    catch (e) { if (!isMissing(e)) throw e }
  }
}
export function isMissing(e: unknown): boolean { return e !== null && typeof e === 'object' && 'code' in e && e.code === 'ENOENT' }
export async function privateDirectory(path: string) {
  await noSymlinkPath(path)
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) throw new LocalError('UNSAFE_DIRECTORY_PERMISSIONS')
}
export async function privateFile(path: string) {
  await noSymlinkPath(path)
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.close()
  } catch (e) { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e }
  const stat = await lstat(path)
  if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new LocalError('UNSAFE_FILE_PERMISSIONS')
}
export async function validatePrivateTree(path: string): Promise<void> {
  await privateDirectory(path)
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await validatePrivateTree(child)
    else await privateFile(child)
  }
}
// Version 1: ASCII domain + platform + canonical lower-case hardware identifier.
// The original identifier never leaves this function's caller or appears in errors.
export function deriveDeviceId(raw: string, kind: 'linux' | 'macos'): string {
  const value = raw.trim().toLowerCase()
  const valid = kind === 'linux' ? /^[a-f0-9]{32}$/.test(value) : /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
  if (!valid || /^[0-]+$/.test(value) || /^[f-]+$/.test(value)) throw new LocalError('SYSTEM_ID_INVALID')
  return 'lsd1_' + sha256(`lifespace-token-device-v1\0${kind}\0${value}`)
}
export async function systemDeviceId(): Promise<string> {
  const kind = platform()
  try {
    if (kind === 'linux') return deriveDeviceId(await readFile('/etc/machine-id', 'utf8'), kind)
    const { stdout } = await promisify(execFile)('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 5000, maxBuffer: 65536, encoding: 'utf8' })
    const value = /"IOPlatformUUID"\s*=\s*"([a-fA-F0-9-]+)"/.exec(stdout)?.[1]
    return deriveDeviceId(value ?? '', kind)
  } catch { throw new LocalError('SYSTEM_ID_UNAVAILABLE') }
}
export async function ensureParent(path: string) { await noSymlinkPath(path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }) }
