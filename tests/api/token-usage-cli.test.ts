import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { build } from 'vite'
import { tokenCollectorBoundary } from '../../build-plugins/token-collector-boundary'
import { collectTokscaleUsage, tokscaleDiagnostics } from '../../tools/token-collector/tokscale-cli'
import { syntheticClaudeLog, syntheticCodexLog, syntheticUnknownModelLog } from '../fixtures/token-usage/synthetic'

const temporaryDirs: string[] = []
afterEach(async () => { await Promise.all(temporaryDirs.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function profile() {
  const root = await mkdtemp(join(tmpdir(), 'lifespace-token-206-'))
  temporaryDirs.push(root)
  const homeDir = join(root, 'synthetic-home')
  const configDir = join(root, 'synthetic-config')
  await mkdir(join(homeDir, '.codex', 'sessions'), { recursive: true })
  await mkdir(configDir)
  return { homeDir, configDir }
}
const context = {
  deviceId: 'synthetic-device-206', metadata: {
    schemaVersion: 1 as const, statisticsVersion: 'tokscale-multi-agent-1',
    tool: { name: 'tokscale' as const, version: '4.23.0' }, priceVersion: null,
    scannedAt: '2026-11-15T04:00:00Z',
  },
}

test('固定 CLI + 合成日志：北京跨日、日期筛选、已知缓存/推理、未知模型/价格及空扫描', async () => {
  const options = await profile()
  expect((await collectTokscaleUsage(options, context)).snapshots).toEqual([])
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'unknown.jsonl'), syntheticUnknownModelLog())
  const report = await collectTokscaleUsage({ ...options, since: '2026-11-14', until: '2026-11-15' }, context)
  expect(report.snapshots.map(row => [row.identity.date, row.content.metrics.total])).toEqual([['2026-11-14', 130], ['2026-11-15', 700]])
  expect(report.snapshots[0].content.metrics).toEqual({ input: 100, output: 30, total: 130, cacheRead: 20, reasoning: 10 })
  expect(report.snapshots.every(row => row.content.cost.coverage === 'unknown')).toBe(true)
  expect(report.snapshots[1].content.models.items.find(row => row.modelId === null)?.metrics.total).toBe(50)
  expect(report.diagnostics).toEqual(['TOKSCALE_PRICING_WARNING'])
  expect(JSON.stringify(report)).not.toContain(options.homeDir)
  const filtered = await collectTokscaleUsage({ ...options, since: '2026-11-15', until: '2026-11-15' }, context)
  expect(filtered.snapshots).toHaveLength(1)
  expect(filtered.snapshots[0].content.metrics.total).toBe(700)
})

test('实际 CLI 离线合成价格缓存：API估算与未计价分开；重复扫描复用缓存而非累加', async () => {
  const options = await profile()
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  await mkdir(join(options.configDir, 'cache'))
  await writeFile(join(options.configDir, 'cache', 'pricing-litellm.json'), JSON.stringify({
    timestamp: Math.floor(Date.now() / 1000), data: {
      'gpt-5.5': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, cache_read_input_token_cost: 0.0000001 },
    },
  }))
  const first = await collectTokscaleUsage(options, context)
  const second = await collectTokscaleUsage(options, context)
  expect(first.snapshots).toEqual(second.snapshots)
  expect(first.snapshots[0].content.cost.coverage).toBe('unverified')
  expect(Number(first.snapshots[0].content.cost.apiEstimate)).toBeCloseTo(0.000142, 12)
  expect(first.snapshots[1].content.cost.coverage).toBe('partial')
  expect(first.snapshots[1].content.models.items.find(row => row.modelId === 'synthetic-unpriced-206')?.cost.apiEstimate).toBeNull()
})

test('非法日期、相对路径和倒置范围在执行CLI前拒绝', async () => {
  const options = await profile()
  await expect(collectTokscaleUsage({ ...options, since: '2026-02-30' }, context)).rejects.toThrow()
  await expect(collectTokscaleUsage({ ...options, homeDir: '.' }, context)).rejects.toThrow()
  await expect(collectTokscaleUsage({ ...options, since: '2026-11-16', until: '2026-11-15' }, context)).rejects.toThrow()
})

test('实际 CLI 部分价格仍给 estimated，适配器保留金额但不承诺完整计价', async () => {
  const options = await profile()
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  await mkdir(join(options.configDir, 'cache'))
  await writeFile(join(options.configDir, 'cache', 'pricing-litellm.json'), JSON.stringify({
    timestamp: Math.floor(Date.now() / 1000), data: { 'gpt-5.5': { input_cost_per_token: 0.000001 } },
  }))
  const report = await collectTokscaleUsage(options, context)
  expect(Number(report.snapshots[0].content.cost.apiEstimate)).toBeGreaterThan(0)
  expect(report.snapshots[0].content.cost.coverage).toBe('unverified')
})

test('只把显式授权 Agent 传给 Tokscale；默认仅 codex，缺少其他来源目录不影响扫描', async () => {
  const options = await profile()
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  const explicit = await collectTokscaleUsage({ ...options, agents: ['codex'] }, context)
  expect(explicit.snapshots.map(row => row.identity.agent)).toEqual(['codex', 'codex'])
  const combined = await collectTokscaleUsage({ ...options, agents: ['codex', 'grok', 'hermes'] }, context)
  expect(combined.snapshots.map(row => [row.identity.date, row.identity.agent])).toEqual([['2026-11-14', 'codex'], ['2026-11-15', 'codex']])
  expect(JSON.stringify(combined)).not.toContain(options.homeDir)
  await expect(collectTokscaleUsage({ ...options, agents: ['grok', 'grok'] }, context)).rejects.toThrow()
  await expect(collectTokscaleUsage({ ...options, agents: [] }, context)).rejects.toThrow()
  await expect(collectTokscaleUsage({ ...options, agents: ['future'] as any }, context)).rejects.toThrow()
})

test('Claude 只按 --home 读取合成会话，且不转发外部 CLAUDE_CONFIG_DIR', async () => {
  const options = await profile()
  await mkdir(join(options.homeDir, '.claude/projects/-synthetic'), { recursive: true })
  await writeFile(join(options.homeDir, '.claude/projects/-synthetic/synthetic.jsonl'), syntheticClaudeLog())
  const emptyConfig = join(options.homeDir, 'empty-claude-config')
  await mkdir(emptyConfig)
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = emptyConfig
  try {
    const report = await collectTokscaleUsage({ ...options, agents: ['claude'] }, context)
    expect(report.snapshots.map(row => [row.identity.date, row.identity.agent, row.content.metrics.total])).toEqual([['2026-11-15', 'claude', 190]])
    expect(report.snapshots[0].content.metrics).toEqual({ input: 150, output: 40, total: 190, cacheRead: 20, cacheWrite: 30, reasoning: 0 })
    expect(report.snapshots[0].content.models.items[0].modelId).toBe('synthetic-claude-model')
    expect(JSON.stringify(report)).not.toContain(options.homeDir)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})

test('WorkBuddy 合成 SQLite 按 --home 读取，空库或仅有 sessions 表不报错', async () => {
  const options = await profile()
  await mkdir(join(options.homeDir, '.workbuddy'), { recursive: true })
  const database = join(options.homeDir, '.workbuddy/workbuddy.db')
  let db = new DatabaseSync(database)
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT)')
  db.close()
  expect((await collectTokscaleUsage({ ...options, agents: ['workbuddy'] }, context)).snapshots).toEqual([])
  db = new DatabaseSync(database)
  db.exec('CREATE TABLE session_usage (session_id TEXT, used INTEGER, updated_at INTEGER)')
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('synthetic-workbuddy-235', 'synthetic-workbuddy-model', '/synthetic')
  db.prepare('INSERT INTO session_usage VALUES (?,?,?)').run('synthetic-workbuddy-235', 42, 1794697200000)
  db.close()
  const report = await collectTokscaleUsage({ ...options, agents: ['workbuddy'] }, context)
  expect(report.snapshots.map(row => [row.identity.date, row.identity.agent, row.content.metrics.total])).toEqual([['2026-11-15', 'workbuddy', 42]])
  expect(report.snapshots[0].content.metrics).toEqual({ input: 42, output: 0, total: 42, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  expect(report.snapshots[0].content.models.items[0].modelId).toBe('synthetic-workbuddy-model')
})

test('Cursor 只读已有缓存；缺失或损坏时返回空图与固定缓存告警，不联网登录', async () => {
  const options = await profile()
  for (const content of [undefined, '{bad json\n']) {
    const cache = join(options.homeDir, '.config/tokscale/cursor-cache')
    if (content === undefined) await rm(cache, { recursive: true, force: true })
    else {
      await mkdir(cache, { recursive: true })
      await writeFile(join(cache, 'usage-synthetic.json'), content)
    }
    const report = await collectTokscaleUsage({ ...options, agents: ['cursor'] }, context)
    expect(report.snapshots).toEqual([])
    expect(report.diagnostics).toContain('TOKSCALE_CURSOR_CACHE_UNAVAILABLE')
    expect(JSON.stringify(report)).not.toContain(options.homeDir)
  }
})

test('Cursor 的固定缓存告警即使没有路径也归入专用诊断，不回显原文', async () => {
  expect(tokscaleDiagnostics("Warning: Cursor usage requires Tokscale's Cursor API cache at an unavailable path; run `tokscale cursor login`.\n"))
    .toEqual(['TOKSCALE_CURSOR_CACHE_UNAVAILABLE'])
  expect(tokscaleDiagnostics("Warning: Cursor usage requires Tokscale's Cursor API cache.\n")).toEqual(['TOKSCALE_CURSOR_CACHE_UNAVAILABLE'])
})

test('已有时区固定值不能被 TZ 悄悄覆盖；拒绝冲突并保留原配置', async () => {
  const options = await profile()
  const settingsDir = join(options.homeDir, '.config', 'tokscale')
  await mkdir(settingsDir, { recursive: true })
  const settingsPath = join(settingsDir, 'settings.json')
  const conflicting = JSON.stringify({ scanner: { bucketTimezone: 'UTC' } })
  await writeFile(settingsPath, conflicting)
  await expect(collectTokscaleUsage(options, context)).rejects.toThrow(/时区不是 Asia\/Shanghai/)
  expect(await readFile(settingsPath, 'utf8')).toBe(conflicting)
  await writeFile(settingsPath, JSON.stringify({ scanner: { bucketTimezone: null } }))
  expect((await collectTokscaleUsage(options, context)).snapshots).toEqual([])
  await writeFile(settingsPath, JSON.stringify({ scanner: { bucketTimezone: 'Asia/Shanghai' } }))
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  expect((await collectTokscaleUsage(options, context)).snapshots.map(row => row.identity.date)).toEqual(['2026-11-14', '2026-11-15'])
})

test('Linux 也会读取迁移home的旧配置，拒绝旧UTC pin并用北京pin实际跨日', async () => {
  const options = await profile()
  const legacyDir = join(options.homeDir, 'Library/Application Support/tokscale')
  await mkdir(legacyDir, { recursive: true })
  const legacyPath = join(legacyDir, 'settings.json')
  const utc = JSON.stringify({ scanner: { bucketTimezone: 'UTC' } })
  await writeFile(legacyPath, utc)
  await writeFile(join(options.homeDir, '.codex', 'sessions', 'synthetic.jsonl'), syntheticCodexLog())
  await expect(collectTokscaleUsage(options, context)).rejects.toThrow(/时区不是 Asia\/Shanghai/)
  expect(await readFile(legacyPath, 'utf8')).toBe(utc)
  await writeFile(legacyPath, JSON.stringify({ scanner: { bucketTimezone: 'Asia/Shanghai' } }))
  expect((await collectTokscaleUsage(options, context)).snapshots.map(row => [row.identity.date, row.content.metrics.total]))
    .toEqual([['2026-11-14', 130], ['2026-11-15', 650]])
  // Canonical settings take precedence over the legacy fallback on both OSes.
  await writeFile(legacyPath, utc)
  await mkdir(join(options.homeDir, '.config/tokscale'), { recursive: true })
  await writeFile(join(options.homeDir, '.config/tokscale/settings.json'), JSON.stringify({ scanner: { bucketTimezone: 'Asia/Shanghai' } }))
  expect((await collectTokscaleUsage(options, context)).snapshots[1].identity.date).toBe('2026-11-15')
})

test('Vite 浏览器/Worker 环境禁止打包 Node collector，纯共享契约可供两端导入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lifespace-token-bundle-'))
  temporaryDirs.push(root)
  const entry = join(root, 'entry.ts')
  for (const nodeModule of ['tools/token-collector/tokscale-cli.ts', 'tools/token-collector/tokscale-adapter.ts']) {
    await writeFile(entry, `import ${JSON.stringify(join(process.cwd(), nodeModule))}`)
    await expect(build({
      configFile: false, logLevel: 'silent', plugins: [tokenCollectorBoundary()],
      build: { write: false, lib: { entry, formats: ['es'] } },
    })).rejects.toThrow(/仅供 Node CLI/)
  }
  await writeFile(entry, `export { tokenUsageSnapshotHash } from ${JSON.stringify(join(process.cwd(), 'src/shared/token-usage-contract.ts'))}`)
  await expect(build({
    configFile: false, logLevel: 'silent', plugins: [tokenCollectorBoundary()],
    build: { write: false, lib: { entry, formats: ['es'] } },
  })).resolves.toBeDefined()
  const source = await readFile('src/shared/token-usage-contract.ts', 'utf8')
  expect(source).not.toMatch(/from ['"]node:|from ['"].*token-collector|from ['"]@tokscale/)
})
