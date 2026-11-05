import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const probe = new URL('../fixtures/security-cleanup-race.mjs', import.meta.url).href

function runPortable(t, race = 'once', unsafeAsset = false) {
  const sandbox = mkdtempSync(join(realpathSync(tmpdir()), 'lifespace-cleanup-test-'))
  t.after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 1 }))
  const repo = join(sandbox, 'repo')
  const temporaryRoot = join(sandbox, 'tmp')
  const eventsPath = join(sandbox, 'events.jsonl')
  const env = {
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
    HOME: join(sandbox, 'home'), TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot,
    CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: './.cache/wrangler-security.log', CLOUDFLARE_DEV_REGISTRY_PATH: './.cache/security-registry',
    NODE_OPTIONS: `--import=${probe}`, SECURITY_CLEANUP_TMP: temporaryRoot,
    SECURITY_CLEANUP_EVENTS: eventsPath, SECURITY_CLEANUP_RACE: race,
  }
  mkdirSync(temporaryRoot)
  mkdirSync(env.HOME)
  // 复制当前受 Git 管理的源码，不复制本地配置、报告、产物或依赖缓存。
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
  for (const path of tracked) {
    const destination = join(repo, path)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(root, path), destination)
  }
  if (unsafeAsset) {
    const markerPath = 'public/cleanup-regression-marker.txt'
    writeFileSync(join(repo, markerPath), 'SECURITY_TEST_ALAPI_TOKEN_20261022')
    tracked.push(markerPath)
    tracked.sort()
  }
  execFileSync('git', ['init', '--quiet'], { cwd: repo, env })
  execFileSync('git', ['add', '--', ...tracked], { cwd: repo, env })
  assert.deepEqual(execFileSync('git', ['ls-files', '-z'], { cwd: repo, env }).toString().split('\0').filter(Boolean), tracked)
  // 只读复用安装包，Vite 的 .vite / .vite-temp 写入本轮私有 node_modules 根。
  mkdirSync(join(repo, 'node_modules'))
  for (const entry of readdirSync(join(root, 'node_modules'))) {
    if (!entry.startsWith('.')) symlinkSync(join(root, 'node_modules', entry), join(repo, 'node_modules', entry), 'dir')
  }
  const reportPath = join(repo, '.cache/security-report.json')
  assert(!existsSync(reportPath), '本轮必须从没有安全报告的副本开始')
  const result = spawnSync(process.execPath, ['--test', 'tests/security/temp-directory.test.mjs'], {
    cwd: repo, env, encoding: 'utf8', timeout: 95000, maxBuffer: 4000000,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  assert.ifError(result.error)
  assert.equal(result.signal, null, output)
  assert(existsSync(eventsPath), output)
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const created = events.filter(event => event.event === 'created')
  assert.equal(created.length, 1, '必须触达本轮唯一真实 fixture')
  const fixture = created[0].path
  assert.equal(dirname(fixture), temporaryRoot)
  assert.equal(events.filter(event => event.event === 'cleanup-start' && event.path === fixture).length, 1)
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined
  t.diagnostic(JSON.stringify({ status: result.status, checks: report?.checks.length, events, fixtureExists: existsSync(fixture) }))
  if (result.status !== 0) t.diagnostic(`portable 失败输出（以下负例应保持非零）：\n${output}`)
  return { result, output, events, fixture, report }
}

test('安全检查全部通过后的一次晚写可恢复，portable 成功且实际删除 fixture', { timeout: 100000 }, t => {
  const { result, output, events, fixture, report } = runPortable(t)
  assert.equal(events.filter(event => event.event === 'late-write').length, 1)
  assert.equal(report?.checks.length, 7, output)
  assert(report.checks.every(check => check.passed))
  assert.equal(result.status, 0, output)
  assert(events.some(event => event.event === 'cleanup-end' && event.exists === false))
  assert(!existsSync(fixture))
})

test('持续晚写耗尽有限重试后仍返回真实 ENOTEMPTY 并阻断 portable', { timeout: 100000 }, t => {
  const { result, output, events, fixture, report } = runPortable(t, 'persistent')
  assert(events.filter(event => event.event === 'late-write').length > 1, '冲突必须持续超过一次重试')
  assert.equal(report?.checks.length, 7, output)
  assert(report.checks.every(check => check.passed))
  assert.equal((output.match(/通过：/g) ?? []).length, 7, output)
  assert.equal(result.status, 1, output)
  assert.match(output, /ENOTEMPTY: directory not empty, rmdir/)
  assert.match(output, /1 !== 0/)
  assert(events.some(event => event.event === 'cleanup-failed' && event.code === 'ENOTEMPTY' && event.syscall === 'rmdir' && event.path === fixture))
  assert(!events.some(event => event.event === 'cleanup-end'))
  assert(existsSync(fixture))
})

test('真实前端资源安全检查失败仍阻断 portable，即使一次晚写清理恢复', { timeout: 100000 }, t => {
  const { result, output, events, fixture, report } = runPortable(t, 'once', true)
  assert.equal(events.filter(event => event.event === 'late-write').length, 1)
  assert.equal(result.status, 1, output)
  assert.match(output, /安全验证未通过（已完成 1 项）：前端构建资源含虚构凭据/)
  assert.match(output, /1 !== 0/)
  assert.equal(report, undefined, '安全检查失败不得留下本轮成功报告')
  assert(events.some(event => event.event === 'cleanup-end' && event.exists === false))
  assert(!existsSync(fixture))
})
