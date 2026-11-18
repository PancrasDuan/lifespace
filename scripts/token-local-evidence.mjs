#!/usr/bin/env node
// Read only a chosen rollup and queue descriptors. Never select meta/sources/body.
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { lstat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function localEvidence({ installation, stateDir, date, agent = 'codex', modelKey }) {
  const runtime = /^24\.(\d+)\.(\d+)$/.exec(process.versions.node)
  if (!runtime || Number(runtime[1]) < 22 || (Number(runtime[1]) === 22 && Number(runtime[2]) < 1)) throw new Error('NODE_24_22_1_REQUIRED')
  for (const path of [installation, stateDir]) {
    if (!path || !isAbsolute(path) || resolve(path) !== path) throw new Error('ABSOLUTE_PATH_REQUIRED')
  }
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('DATE_INVALID')
  if (!['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor'].includes(agent)) throw new Error('AGENT_INVALID')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (date >= today) throw new Error('COMPLETED_BEIJING_DATE_REQUIRED')
  if (modelKey !== undefined) {
    const model = JSON.parse(modelKey)
    if (!(model === null || typeof model === 'string' && model.length > 0 && model.length <= 200)
      || JSON.stringify(model) !== modelKey) throw new Error('MODEL_KEY_INVALID')
  }
  const modulePath = join(installation, 'node_modules/@lifespace/token-collector/dist')
  const { noSymlinkPath } = await import(pathToFileURL(join(modulePath, 'tools/token-collector/local.js')).href)
  const { tokenUsageSnapshotSchema, tokenUsageContentHash } = await import(pathToFileURL(join(modulePath, 'src/shared/token-usage-contract.js')).href)
  const databasePath = join(stateDir, 'state.sqlite')
  await noSymlinkPath(databasePath)
  const directory = await lstat(stateDir), file = await lstat(databasePath)
  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)
    || !file.isFile() || file.uid !== process.getuid() || file.nlink !== 1 || (file.mode & 0o077)) throw new Error('PRIVATE_STATE_REQUIRED')
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('BEGIN')
    const row = db.prepare('SELECT generation,version,hash,snapshot FROM rollups WHERE date=? AND agent=?').get(date, agent)
    if (!row) throw new Error('NO_LOCAL_ROLLUP_FOR_DATE')
    if (!/^(0|[1-9]\d{0,18})$/.test(String(row.generation))) throw new Error('LOCAL_GENERATION_INVALID')
    const snapshot = tokenUsageSnapshotSchema.parse(JSON.parse(String(row.snapshot)))
    if (snapshot.identity.date !== date || snapshot.identity.agent !== agent || snapshot.metadata.snapshotVersion !== row.version
      || await tokenUsageContentHash(snapshot.content) !== row.hash) throw new Error('LOCAL_SNAPSHOT_MISMATCH')
    const pending = db.prepare('SELECT generation,version,hash,attempts,next_at,error FROM queue WHERE date=? AND agent=? ORDER BY id').all(date, agent)
    if (pending.some(task => !/^\d{1,19}$/.test(String(task.generation)) || !/^[1-9]\d{0,39}$/.test(String(task.version))
      || !/^[a-f0-9]{64}$/.test(String(task.hash)) || (task.error !== null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(String(task.error))))) throw new Error('QUEUE_DESCRIPTOR_INVALID')
    const selected = modelKey === undefined ? undefined : snapshot.content.models.items.find(model => JSON.stringify(model.modelId) === modelKey)
    return {
      evidence: 'local_snapshot_and_queue_only',
      timeZone: 'Asia/Shanghai', ...snapshot.identity,
      generation: String(row.generation), snapshotVersion: String(row.version), contentHash: String(row.hash),
      statisticsVersion: snapshot.metadata.statisticsVersion, tool: snapshot.metadata.tool, priceVersion: snapshot.metadata.priceVersion,
      content: snapshot.content,
      ...(modelKey === undefined ? {} : { selectedModel: { modelKey, present: selected !== undefined, ...(selected ? { metrics: selected.metrics, cost: selected.cost } : {}) } }),
      pending,
      receiptEvidence: 'CLI deletes strictly matched tasks; raw upload receipts are not retained. This file is not a receipt or hosted summary.',
    }
  } finally { db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { installation: { type: 'string' }, 'state-dir': { type: 'string' }, date: { type: 'string' }, agent: { type: 'string' }, 'model-key': { type: 'string' }, help: { type: 'boolean' } } })
    if (values.help) {
      console.log(`Node >=24.22.1 <25 token-local-evidence.mjs --installation /private/install --state-dir /private/state --date YYYY-MM-DD [--agent codex|grok|hermes|claude|workbuddy|cursor] [--model-key '"model-id"' | --model-key null]`)
    } else {
      console.log(JSON.stringify(await localEvidence({ installation: values.installation, stateDir: values['state-dir'], date: values.date, agent: values.agent, modelKey: values['model-key'] }), null, 2))
    }
  } catch {
    console.error(JSON.stringify({ error: 'LOCAL_EVIDENCE_UNCONFIRMED', next: 'Check Node >=24.22.1 <25, explicit private paths, completed Beijing date, installed package, and local rollup; no raw database error is printed.' }))
    process.exitCode = 1
  }
}
