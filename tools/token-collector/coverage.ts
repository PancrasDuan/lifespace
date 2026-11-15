import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createZstdDecompress } from 'node:zlib'
import { compose } from 'node:stream'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing, LocalError, noSymlinkPath } from './local.ts'
import type { SourceProof } from './store.ts'

type Observation = SourceProof & { valid: boolean }
export type Inventory = { files: Observation[]; uncertain: boolean }
const roots = ['.codex/sessions', '.codex/archived_sessions', '.config/tokscale/headless/codex', 'Library/Application Support/tokscale/headless/codex']
function sourceStream(path: string) { return path.endsWith('.zst') ? compose(createReadStream(path), createZstdDecompress()) : createReadStream(path) }
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
  const initial = await lstat(path)
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
  const end = await lstat(path)
  if (initial.size !== end.size || initial.mtimeMs !== end.mtimeMs || initial.ctimeMs !== end.ctimeMs || initial.ino !== end.ino) valid = false
  return { path, hash: hash.digest('hex'), size, dates: [...dates].sort(), valid }
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
  let uncertain = false
  async function walk(path: string) {
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) { uncertain = true; return }
      if (stat.isDirectory()) {
        for (const child of (await readdir(path)).sort()) await walk(join(path, child))
      } else if (transcript(path)) {
        try { files.push(await observe(path)) } catch { uncertain = true }
      }
    } catch (e) { if (!isMissing(e)) uncertain = true }
  }
  for (const root of roots) { await noSymlinkPath(join(home, root)); await walk(join(home, root)) }
  return { files, uncertain }
}
async function prefixMatches(current: Observation, prior: SourceProof): Promise<boolean> {
  if (!current.valid || current.size < prior.size) return false
  if (current.size === prior.size) return current.hash === prior.hash
  if (prior.size === 0) return true
  const hash = createHash('sha256')
  try {
    let remaining = prior.size
    for await (const chunk of sourceStream(current.path)) {
      const bytes = chunk as Buffer; hash.update(bytes.subarray(0, remaining)); remaining -= Math.min(bytes.length, remaining)
      if (remaining === 0) break
    }
    if (remaining) return false
    return hash.digest('hex') === prior.hash
  } catch { return false }
}
export async function assessCoverage(prior: SourceProof[], before: Inventory, after: Inventory, allDates: string[], sourceDiagnostic = false) {
  const blocked = new Set<string>(), diagnostics = new Set<string>(), accepted: SourceProof[] = []
  const block = (dates: string[], code: string) => { dates.forEach(d => blocked.add(d)); diagnostics.add(code) }
  if (before.uncertain || after.uncertain || sourceDiagnostic) block(allDates, 'SOURCE_SCOPE_UNPROVEN')
  const afterByPath = new Map(after.files.map(f => [f.path, f]))
  for (const f of before.files) {
    const end = afterByPath.get(f.path)
    if (!f.valid || !end?.valid) {
      // A malformed row has no trustworthy date. Freeze the full known scope.
      block(allDates, 'SOURCE_INCOMPLETE'); continue
    }
    if (f.hash !== end.hash) { block([...f.dates, ...end.dates], 'SOURCE_CHANGED_DURING_SCAN'); continue }
    const old = prior.find(p => p.path === f.path)
    if (old && !await prefixMatches(f, old)) { block([...old.dates, ...f.dates], 'SOURCE_REWRITTEN_OR_TRUNCATED'); continue }
    accepted.push({ path: f.path, hash: f.hash, size: f.size, dates: f.dates })
  }
  for (const old of prior) {
    const current = before.files.find(f => f.path === old.path)
    if (current && await prefixMatches(current, old)) continue
    // Exact moves, archive copies and append-only relocated files preserve proof.
    const replacement = (await Promise.all(before.files.map(f => prefixMatches(f, old)))).some(Boolean)
    if (!replacement) block([...old.dates, ...(current?.dates ?? [])], 'SOURCE_MISSING_OR_CHANGED')
  }
  // Files newly appearing during execution were not in the graph's stable scope.
  for (const f of after.files) if (!before.files.some(b => b.path === f.path)) block(f.dates.length ? f.dates : allDates, 'SOURCE_CHANGED_DURING_SCAN')
  return { blocked, diagnostics: [...diagnostics], proofs: accepted }
}
