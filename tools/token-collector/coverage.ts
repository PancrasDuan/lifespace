import { constants, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createZstdDecompress } from 'node:zlib'
import { compose } from 'node:stream'
import { lstat, open, readdir, readFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing, LocalError, noSymlinkPath } from './local.ts'
import type { SourceProof } from './store.ts'

type Observation = SourceProof & { valid: boolean; stamp: string }
export type Inventory = { files: Observation[]; uncertain: boolean; directories: Record<string, string> }
function stamp(value: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
}
const roots = ['.codex/sessions', '.codex/archived_sessions', '.config/tokscale/headless/codex', 'Library/Application Support/tokscale/headless/codex']
function sourceStream(path: string, handle?: FileHandle) {
  const input = handle ? handle.createReadStream({ autoClose: false }) : createReadStream(path)
  return path.endsWith('.zst') ? compose(input, createZstdDecompress()) : input
}
function transcript(path: string) {
  const name = path.split('/').at(-1)!, marker = name.indexOf('.jsonl')
  if (marker <= 0) return false
  const normalized = name.replace(/\.zst$/, '')
  const stem = normalized.endsWith('.jsonl') ? normalized.slice(0, -6) : normalized.split(/\.jsonl\.(?:deleted|reset)\./)[0]
  if (stem !== normalized && /.+\.checkpoint\.[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stem)) return false
  const suffix = name.slice(marker + 6)
  return suffix === '' || suffix.startsWith('.') && !suffix.endsWith('.json') && !suffix.endsWith('.json.migrated')
}
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
function date(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return undefined
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return undefined
  return dateFormatter.format(new Date(ms))
}
async function observe(path: string): Promise<Observation> {
  const initial = await lstat(path, { bigint: true })
  if (!initial.isFile() || initial.isSymbolicLink()) throw new LocalError('SOURCE_UNREADABLE')
  const hash = createHash('sha256'), dates = new Set<string>()
  let size = 0, line = '', valid = true, lastByte = -1
  // Inspect only envelope timestamps and JSON well-formedness. Never extract or
  // retain token events, IDs, text or a second set of statistics.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  function consume(text: string) {
    line += text
    if (line.length > 16 * 1024 * 1024) throw new LocalError('SOURCE_LINE_TOO_LARGE')
    let end: number
    while ((end = line.indexOf('\n')) !== -1) {
      const raw = line.slice(0, end); line = line.slice(end + 1)
      if (!raw.trim()) continue
      try {
        const envelope: unknown = JSON.parse(raw)
        if (!envelope || typeof envelope !== 'object' || !('timestamp' in envelope) || !('type' in envelope)) { valid = false; continue }
        const day = date(envelope.timestamp)
        if (day) dates.add(day); else valid = false
        // Tokscale may anchor a resumed turn to started_at (Unix seconds),
        // which can belong to a different day than every envelope timestamp.
        // This is coverage metadata only; counters still come from Tokscale.
        const p = 'payload' in envelope ? envelope.payload : undefined
        if (envelope.type === 'event_msg' && p && typeof p === 'object' && 'type' in p && p.type === 'task_started' && 'started_at' in p && typeof p.started_at === 'number') {
          const seconds = Math.trunc(p.started_at), ms = seconds * 1000
          if (!Number.isSafeInteger(seconds) || !Number.isFinite(ms) || Math.abs(ms) > 8640000000000000) valid = false
          else { const anchored = date(new Date(ms).toISOString()); if (anchored) dates.add(anchored); else valid = false }
        }
      } catch { valid = false }
    }
  }
  for await (const chunk of sourceStream(path)) {
    const bytes = chunk as Buffer; hash.update(bytes); size += bytes.length; lastByte = bytes.at(-1) ?? lastByte
    if (size > 512 * 1024 * 1024) throw new LocalError('SOURCE_TOO_LARGE')
    consume(decoder.decode(bytes, { stream: true }))
  }
  consume(decoder.decode())
  if (line.length || (size > 0 && lastByte !== 10)) valid = false
  const end = await lstat(path, { bigint: true })
  if (stamp(initial) !== stamp(end)) valid = false
  return { path, hash: hash.digest('hex'), size, dates: [...dates].sort(), valid, stamp: stamp(initial) }
}
export async function inventory(home: string): Promise<Inventory> {
  await noSymlinkPath(home)
  for (const settings of ['.config/tokscale/settings.json', 'Library/Application Support/tokscale/settings.json']) {
    try {
      const value = JSON.parse(await readFile(join(home, settings), 'utf8'))
      // This release proves only the pinned default roots. Expanding them needs
      // matching inventory support, not silently trusting an incomplete graph.
      if (value?.scanner?.extraScanPaths && Object.values(value.scanner.extraScanPaths).some(v => !Array.isArray(v) || v.length)) throw new LocalError('EXTRA_SOURCE_PATHS_UNSUPPORTED')
      break
    } catch (e) { if (!isMissing(e)) throw new LocalError(e instanceof LocalError ? e.code : 'SCANNER_SETTINGS_INVALID') }
  }
  const files: Observation[] = []
  const directories: Record<string, string> = {}
  let uncertain = false
  async function walk(path: string) {
    try {
      const stat = await lstat(path, { bigint: true })
      if (stat.isSymbolicLink()) { uncertain = true; return }
      if (stat.isDirectory()) {
        directories[path] = stamp(stat)
        for (const child of (await readdir(path)).sort()) await walk(join(path, child))
      } else if (transcript(path)) {
        try { files.push(await observe(path)) } catch { uncertain = true }
      }
    } catch (e) { if (!isMissing(e)) uncertain = true }
  }
  for (const root of roots) {
    const target = join(home, root); await noSymlinkPath(target)
    // Moving an entire ancestor can leave every child's inode/ctime intact.
    // Include all ancestors and directory entries, including absent roots.
    let cursor = home
    for (const part of ['', ...root.split('/')]) {
      if (part) cursor = join(cursor, part)
      try { directories[cursor] = stamp(await lstat(cursor, { bigint: true })) }
      catch (e) { directories[cursor] = 'absent'; if (!isMissing(e)) uncertain = true }
    }
    await walk(target)
  }
  return { files, uncertain, directories }
}
async function prefixMatches(current: Observation, prior: SourceProof): Promise<boolean> {
  if (!current.valid || current.size < prior.size) return false
  if (current.size === prior.size) return current.hash === prior.hash
  if (prior.size === 0) return true
  const hash = createHash('sha256')
  let handle: FileHandle | undefined
  try {
    handle = await open(current.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    // Bind this later prefix read to the exact object inventoried around the
    // graph. A restored/replaced path must not lend bytes to an older report.
    if (stamp(await handle.stat({ bigint: true })) !== current.stamp) return false
    let remaining = prior.size
    for await (const chunk of sourceStream(current.path, handle)) {
      const bytes = chunk as Buffer; hash.update(bytes.subarray(0, remaining)); remaining -= Math.min(bytes.length, remaining)
      if (remaining === 0) break
    }
    if (remaining) return false
    return stamp(await handle.stat({ bigint: true })) === current.stamp && hash.digest('hex') === prior.hash
  } catch { return false }
  finally { await handle?.close().catch(() => {}) }
}
export async function assessCoverage(prior: SourceProof[], before: Inventory, after: Inventory, allDates: string[], sourceDiagnostic = false) {
  const blocked = new Set<string>(), diagnostics = new Set<string>(), accepted: SourceProof[] = []
  const block = (dates: string[], code: string) => { dates.forEach(d => blocked.add(d)); diagnostics.add(code) }
  if (before.uncertain || after.uncertain || sourceDiagnostic) block(allDates, 'SOURCE_SCOPE_UNPROVEN')
  if (JSON.stringify(Object.entries(before.directories).sort()) !== JSON.stringify(Object.entries(after.directories).sort())) block(allDates, 'SOURCE_TREE_CHANGED_DURING_SCAN')
  const afterByPath = new Map(after.files.map(f => [f.path, f]))
  for (const f of before.files) {
    const end = afterByPath.get(f.path)
    if (!f.valid || !end?.valid) {
      // A malformed row has no trustworthy date. Freeze the full known scope.
      block(allDates, 'SOURCE_INCOMPLETE'); continue
    }
    if (f.hash !== end.hash || f.stamp !== end.stamp) { block([...f.dates, ...end.dates], 'SOURCE_CHANGED_DURING_SCAN'); continue }
    const old = prior.find(p => p.path === f.path)
    if (old && !await prefixMatches(f, old)) { block([...old.dates, ...f.dates], 'SOURCE_REWRITTEN_OR_TRUNCATED'); continue }
    accepted.push({ path: f.path, hash: f.hash, size: f.size, dates: f.dates, coverageVersion: 1 })
  }
  for (const old of prior) {
    const current = before.files.find(f => f.path === old.path)
    if (current && await prefixMatches(current, old)) continue
    // Exact moves, archive copies and append-only relocated files preserve proof.
    const replacement = (await Promise.all(before.files.map(f => prefixMatches(f, old)))).some(Boolean)
    if (!replacement) block(old.coverageVersion === 1 ? [...old.dates, ...(current?.dates ?? [])] : allDates, old.coverageVersion === 1 ? 'SOURCE_MISSING_OR_CHANGED' : 'SOURCE_LEGACY_SCOPE_UNPROVEN')
  }
  // Files newly appearing during execution were not in the graph's stable scope.
  for (const f of after.files) if (!before.files.some(b => b.path === f.path)) block(f.dates.length ? f.dates : allDates, 'SOURCE_CHANGED_DURING_SCAN')
  return { blocked, diagnostics: [...diagnostics], proofs: accepted }
}
