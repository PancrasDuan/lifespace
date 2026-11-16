// Node-only boundary. Never import this module from src/ or worker/.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { adaptTokscaleGraph, tokscaleVersion, type TokenCollectionContext } from './tokscale-adapter.ts'

const exec = promisify(execFile)
const cliEntry = join(dirname(createRequire(import.meta.url).resolve('@tokscale/cli/package.json')), 'bin.js')
const absolutePath = z.string().min(1).refine(isAbsolute, '必须使用绝对路径')
const optionsSchema = z.strictObject({
  homeDir: absolutePath, configDir: absolutePath,
  since: z.iso.date().optional(), until: z.iso.date().optional(),
}).refine(value => !value.since || !value.until || value.since <= value.until, '日期范围倒置')
export type TokscaleOptions = z.infer<typeof optionsSchema>

export async function collectTokscaleUsage(input: TokscaleOptions, context: TokenCollectionContext) {
  const options = optionsSchema.parse(input)
  // A valid scanner pin overrides TZ. Never silently mislabel another zone's
  // already-aggregated day, or rewrite a user's existing settings.
  let settingsText: string | undefined
  // Upstream checks its legacy macOS layout even on Linux, for migrated homes.
  const settingsPaths = [
    join(options.homeDir, '.config/tokscale/settings.json'),
    join(options.homeDir, 'Library/Application Support/tokscale/settings.json'),
  ]
  for (const path of settingsPaths) {
    try {
      settingsText = await readFile(path, 'utf8')
      break
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('无法验证 Tokscale 时区配置')
    }
  }
  if (settingsText !== undefined) {
    try {
      const settings = z.object({ scanner: z.object({ bucketTimezone: z.string().nullish() }).optional() }).parse(JSON.parse(settingsText))
      if (settings.scanner?.bucketTimezone && settings.scanner.bucketTimezone !== 'Asia/Shanghai') throw new Error('timezone conflict')
    } catch {
      throw new Error('Tokscale scanner 配置无效或时区不是 Asia/Shanghai；未生成汇总')
    }
  }
  // An explicit profile keeps auth, prices and parser caches separate from the
  // user's profile. --home suppresses environment scan roots in this version.
  const env = {
    TZ: 'Asia/Shanghai', TOKSCALE_CONFIG_DIR: options.configDir,
    CODEX_HOME: join(options.homeDir, '.codex'),
  }
  async function run(args: string[]) {
    try {
      return await exec(process.execPath, [cliEntry, ...args], {
        // wrangler-generated ProcessEnv declares Worker secrets as required;
        // this local subprocess deliberately receives none of those secrets.
        env: env as unknown as NodeJS.ProcessEnv, timeout: 60_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
      })
    } catch {
      // Child stderr and errors can contain local paths or log fragments.
      throw new Error('Tokscale 调用失败或超出运行限制；未生成汇总')
    }
  }
  const version = await run(['--version'])
  if (version.stdout.trim() !== `tokscale ${tokscaleVersion}`) throw new Error('Tokscale CLI 版本不匹配')
  const args = ['graph', '--offline', '--home', options.homeDir, '--client', 'codex', '--no-spinner']
  if (options.since) args.push('--since', options.since)
  if (options.until) args.push('--until', options.until)
  const result = await run(args)
  try {
    const snapshots = adaptTokscaleGraph(JSON.parse(result.stdout), context)
    if (snapshots.some(snapshot => (options.since && snapshot.identity.date < options.since)
      || (options.until && snapshot.identity.date > options.until))) throw new Error('日期超出请求范围')
    return {
      snapshots,
      // Preserve that a diagnostic exists, without returning private stderr.
      diagnostics: result.stderr.trim() ? ['tokscale_diagnostic'] : [],
      // Only this exact pinned-version warning is known to concern prices.
      // Every other stderr line makes source completeness unproven.
      sourceDiagnostic: result.stderr.split('\n').filter(line => line.trim()).some(line => line.trim() !== 'tokscale: some usage is partial, unpriced, or has stale pricing; cost totals may be incomplete. Run `tokscale pricing explain --json --no-spinner` for local billing-channel details.'),
    }
  } catch {
    throw new Error('Tokscale 输出不符合已验证契约；未生成汇总')
  }
}
