import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { z } from 'zod'
import { tokenUploadReceiptSchema, tokenUploadSchema } from '../../src/shared/token-backend-contract.ts'
import { tokenUsageContentHash, type TokenUsageSnapshot } from '../../src/shared/token-usage-contract.ts'
import { LocalError, privateDirectory, privateFile } from './local.ts'

export const hoursSchema = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(8), z.literal(12), z.literal(24)])
export const supportedAgents = ['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor'] as const
export const agentSchema = z.enum(supportedAgents)
export type Agent = z.infer<typeof agentSchema>
export const agentsSchema = z.array(agentSchema).min(1).max(6).superRefine((value, ctx) => {
  if (new Set(value).size !== value.length) ctx.addIssue({ code: 'custom', message: 'Agent 来源不能重复' })
})
const configObjectSchema = z.strictObject({
  deviceId: z.string(), server: z.string(), sourceHome: z.string(), hours: hoursSchema, loopback: z.boolean(),
  // Optional only for reading state written before multi-Agent support.
  agents: agentsSchema.optional(),
})
export const configSchema = configObjectSchema.transform(value => ({ ...value, agents: value.agents ?? ['codex'] }))
export type Config = z.infer<typeof configSchema>
export const credentialSchema = z.strictObject({ deviceId: z.string(), generation: z.string().regex(/^[1-9]\d{0,18}$/), uploadToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  upload: z.strictObject({ url: z.string(), publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/), header: z.literal('X-LifeSpace-Device-Token') }) })
export type Credential = z.infer<typeof credentialSchema>
export type QueueTask = { id: number; date: string; agent: string; generation: string; version: string; hash: string; body: string; attempts: number; next_at: number; error: string | null }

export class Store {
  private constructor(readonly db: DatabaseSync, private readonly lock: DatabaseSync) {}
  static async open(dir: string): Promise<Store> {
    await privateDirectory(dir)
    for (const name of ['run.sqlite', 'state.sqlite', 'state.sqlite-journal', 'run.sqlite-journal']) {
      // Sidecars are checked too: SQLite must not follow a pre-existing link.
      await privateFile(join(dir, name))
    }
    const lock = new DatabaseSync(join(dir, 'run.sqlite'))
    try { lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS held (id INTEGER)') }
    catch { lock.close(); throw new LocalError('COLLECTOR_BUSY') }
    try {
      const db = new DatabaseSync(join(dir, 'state.sqlite'))
      const schemaVersion = Number(db.prepare('PRAGMA user_version').get()!.user_version)
      if (schemaVersion !== 0 && schemaVersion !== 1) { db.close(); throw new LocalError('LOCAL_SCHEMA_UPGRADE_REQUIRED') }
      db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rollups (date TEXT NOT NULL, agent TEXT NOT NULL, generation TEXT NOT NULL, version TEXT NOT NULL, hash TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(date,agent));
        CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY, date TEXT NOT NULL, agent TEXT NOT NULL, generation TEXT NOT NULL, version TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(date,agent,generation,version));
        CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, proof TEXT NOT NULL);`)
      // Retain the legacy table for in-place upgrades; source proofs no longer
      // gate accounting or receive reads/writes from the collector.
      if (schemaVersion === 0) db.exec('PRAGMA user_version=1')
      return new Store(db, lock)
    } catch (e) { lock.close(); if (e instanceof LocalError) throw e; throw new LocalError('LOCAL_DATABASE_FAILED') }
  }
  close() { this.db.close(); this.lock.close() }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  get(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)
    return row ? JSON.parse(String(row.value)) : undefined
  }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
  remove(key: string) { this.db.prepare('DELETE FROM meta WHERE key=?').run(key) }
  config(): Config { return configSchema.parse(this.get('config')) }
  credential(): Credential | undefined { const v = this.get('credential'); return v === undefined ? undefined : credentialSchema.parse(v) }
  dates(): string[] { return this.db.prepare('SELECT DISTINCT date FROM rollups').all().map(r => String(r.date)) }
  rollupKeys(): Array<{ date: string; agent: string }> {
    return this.db.prepare('SELECT date,agent FROM rollups ORDER BY date,agent').all()
      .map(row => ({ date: String(row.date), agent: String(row.agent) }))
  }
  tasks(): QueueTask[] { return this.db.prepare('SELECT * FROM queue ORDER BY id').all() as unknown as QueueTask[] }
  async prepareSnapshots(snapshots: TokenUsageSnapshot[]) {
    return Promise.all(snapshots.map(async snapshot => ({ snapshot, hash: await tokenUsageContentHash(snapshot.content) })))
  }
  saveScan(prepared: Awaited<ReturnType<Store['prepareSnapshots']>>, diagnostics: string[], retainedDates: string[] = [], now = Date.now()) {
    this.transaction(() => {
      const credential = this.credential()
      for (const { snapshot, hash } of prepared) {
        const { date, agent } = snapshot.identity
        if (snapshot.identity.deviceId !== this.config().deviceId) throw new LocalError('IDENTITY_MISMATCH')
        const old = this.db.prepare('SELECT * FROM rollups WHERE date=? AND agent=?').get(date, agent) as
          { generation?: string; version?: string; hash?: string; snapshot?: string } | undefined
        const oldStatisticsVersion = old?.snapshot === undefined
          ? undefined
          : (JSON.parse(String(old.snapshot)) as TokenUsageSnapshot).metadata.statisticsVersion
        // Compare the latest assigned content, including unconfirmed requests.
        // A metadata-only version bump still creates a new ordered snapshot.
        if (old?.hash === hash && oldStatisticsVersion === snapshot.metadata.statisticsVersion) continue
        const generation = credential?.generation ?? '0'
        const version = old?.generation === generation ? String(BigInt(String(old.version)) + 1n) : '1'
        const versioned = { ...snapshot, metadata: { ...snapshot.metadata, snapshotVersion: version } }
        this.db.prepare('INSERT INTO rollups VALUES (?,?,?,?,?,?) ON CONFLICT(date,agent) DO UPDATE SET generation=excluded.generation, version=excluded.version, hash=excluded.hash, snapshot=excluded.snapshot').run(date, agent, generation, version, hash, JSON.stringify(versioned))
        if (credential) this.enqueue(versioned, hash, credential.generation)
      }
      this.set('scan', { at: now, retainedDates, diagnostics })
    })
  }
  private enqueue(snapshot: TokenUsageSnapshot, hash: string, generation: string) {
    const request = tokenUploadSchema.parse({ p_generation: generation, p_snapshot: snapshot, p_hash: hash })
    const body = JSON.stringify(request)
    if (Buffer.byteLength(body) > 700_000) throw new LocalError('SNAPSHOT_TOO_LARGE')
    this.db.prepare('INSERT INTO queue(date,agent,generation,version,hash,body) VALUES (?,?,?,?,?,?)').run(snapshot.identity.date, snapshot.identity.agent, generation, snapshot.metadata.snapshotVersion!, hash, body)
  }
  activate(value: Credential) {
    const credential = credentialSchema.parse(value)
    if (credential.deviceId !== this.config().deviceId) throw new LocalError('IDENTITY_MISMATCH')
    this.transaction(() => {
      const prior = this.credential()
      if (prior?.generation !== credential.generation) {
        // Explicit browser-approved generation supersedes old requests; retain latest content.
        this.db.exec('DELETE FROM queue')
        const rows = this.db.prepare('SELECT snapshot,hash FROM rollups').all()
        for (const row of rows) {
          const snapshot = JSON.parse(String(row.snapshot)) as TokenUsageSnapshot
          snapshot.metadata.snapshotVersion = '1'
          this.db.prepare('UPDATE rollups SET generation=?,version=?,snapshot=? WHERE date=? AND agent=?').run(credential.generation, '1', JSON.stringify(snapshot), snapshot.identity.date, snapshot.identity.agent)
          this.enqueue(snapshot, String(row.hash), credential.generation)
        }
      }
      this.set('credential', credential); this.remove('registration'); this.set('authorization', 'claimed')
    })
  }
  acknowledge(task: QueueTask, value: unknown): boolean {
    const parsed = tokenUploadReceiptSchema.safeParse(value)
    if (!parsed.success) return false
    const r = parsed.data, config = this.config()
    if (r.deviceId !== config.deviceId || r.date !== task.date || r.agent !== task.agent || r.generation !== task.generation || r.snapshotVersion !== task.version || r.contentHash !== task.hash) return false
    return Number(this.db.prepare('DELETE FROM queue WHERE id=? AND date=? AND agent=? AND generation=? AND version=? AND hash=?').run(task.id, r.date, r.agent, r.generation, r.snapshotVersion, r.contentHash).changes) === 1
  }
  retry(task: QueueTask, code: string, now = Date.now()) {
    const attempts = Math.min(task.attempts + 1, 1000000)
    const delay = Math.min(3_600_000, 5000 * 2 ** Math.min(attempts - 1, 10))
    this.db.prepare('UPDATE queue SET attempts=?,next_at=?,error=? WHERE id=?').run(attempts, now + delay, code, task.id)
  }
  status() {
    const configured = this.get('config') !== undefined
    return { configured, authorized: this.credential() !== undefined, authorization: this.get('authorization') ?? 'not_started',
      agents: configured ? this.config().agents : null,
      rollups: Number(this.db.prepare('SELECT count(*) n FROM rollups').get()!.n), pending: this.tasks().length,
      errors: [...new Set(this.tasks().map(t => t.error).filter(Boolean))], scan: this.get('scan') ?? null, heartbeat: this.get('heartbeat') ?? null,
      price: this.get('price') ?? null, schedule: this.get('schedule') ?? null }
  }
}
