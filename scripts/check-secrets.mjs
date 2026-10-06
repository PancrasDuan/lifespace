import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const version = '8.30.1'
const releases = {
  'darwin-arm64': ['darwin_arm64', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'linux-x64': ['linux_x64', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
}
const mode = process.argv[2] ?? 'all'
if (!['all', 'staged'].includes(mode)) throw new Error('用法：node scripts/check-secrets.mjs [all|staged]')
const release = releases[`${process.platform}-${process.arch}`]
if (!release) throw new Error('当前支持 macOS arm64 与 Linux x64；新增平台需固定官方校验值。')
const cache = resolve('.cache/tools', `gitleaks-${version}-${release[0]}`)
const binary = join(cache, 'gitleaks')
if (!existsSync(binary)) {
  await mkdir(cache, { recursive: true })
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${release[0]}.tar.gz`
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Gitleaks 下载失败：HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(archive).digest('hex') !== release[1]) throw new Error('Gitleaks 官方包校验失败。')
  const archivePath = join(cache, 'download.tar.gz')
  await writeFile(archivePath, archive)
  execFileSync('tar', ['-xzf', archivePath, '-C', cache, 'gitleaks'])
  await chmod(binary, 0o755)
  await rm(archivePath)
}

// 报告始终脱敏；不上传报告和暂存文件，也不接受行内跳过标记。
const scratch = await mkdtemp(join(tmpdir(), 'lifespace-secret-check-'))
const flags = ['--config', resolve('.gitleaks.toml'), '--redact', '--no-banner', '--no-color', '--ignore-gitleaks-allow', '--gitleaks-ignore-path', scratch]
function scan(args, cwd = process.cwd()) {
  const report = join(scratch, 'report.json')
  const result = spawnSync(binary, [...args, ...flags, '--report-format', 'json', '--report-path', report], { stdio: 'inherit', cwd })
  if (existsSync(report)) {
    for (const finding of JSON.parse(readFileSync(report, 'utf8'))) {
      console.error(`${finding.RuleID}: ${finding.File}:${finding.StartLine}`)
    }
  }
  if (result.error || result.status !== 0) throw new Error('密钥扫描未通过；先处理脱敏报告中的发现或扫描错误。')
}
try {
  if (mode === 'staged') {
    scan(['git', '--pre-commit', '--staged', '.'])
  } else {
    scan(['git', '--log-opts=--all', '.'])
    // 只复制将进入 Git 的文件，覆盖尚未提交的新增和修改；避免扫描本机私有配置和缓存。
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    const snapshot = join(scratch, 'working-tree')
    await mkdir(snapshot)
    for (const file of files) {
      if (!existsSync(file)) continue
      const target = join(snapshot, file)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(file))
    }
    scan(['dir', '.'], snapshot)
  }
  console.log('密钥扫描通过。')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
