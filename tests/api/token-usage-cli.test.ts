import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { build } from 'vite'
import { tokenCollectorBoundary } from '../../build-plugins/token-collector-boundary'
import { collectTokscaleUsage } from '../../tools/token-collector/tokscale-cli'
import { syntheticCodexLog, syntheticUnknownModelLog } from '../fixtures/token-usage/synthetic'

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
    schemaVersion: 1 as const, statisticsVersion: 'tokscale-codex-1',
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
