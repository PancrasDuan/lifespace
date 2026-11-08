import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const run = (branch, args = [], cwd = root) => spawnSync(process.execPath, ['scripts/upload-preview.mjs', ...args], {
  cwd, encoding: 'utf8', timeout: 10000,
  env: { ...process.env, WORKERS_CI_BRANCH: branch },
})

test('配置 dry-run 清理两层本地连接串且不调用远端部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-preview-guard-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['upload-preview.mjs', 'check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const binding = { binding: 'HYPERDRIVE', id: '11111111111111111111111111111111', localConnectionString: 'local-only' }
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  writeFileSync(path, JSON.stringify({ hyperdrive: [binding], previews: { hyperdrive: [binding], observability: { enabled: true, logs: { enabled: true }, traces: { enabled: true } } } }))
  const result = run('preview', ['--dry-run'], fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /配置检查通过（未上传）/)
  const config = JSON.parse(readFileSync(path, 'utf8'))
  assert(!Object.hasOwn(config.hyperdrive[0], 'localConnectionString'))
  assert(!Object.hasOwn(config.previews.hyperdrive[0], 'localConnectionString'))
})

test('预览脚本拒绝 main 与其他功能分支，且不会走到上传阶段', () => {
  for (const branch of ['main', 'codex/test-preview']) {
    const result = run(branch, ['--dry-run'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /预览部署只允许 GitHub preview 分支/)
  }
})

test('预览不接受覆盖目标配置或上传命令的额外参数', () => {
  const result = run('preview', ['--config', 'another-worker.json'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /预览脚本只接受 --dry-run/)
})
