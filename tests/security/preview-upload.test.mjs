import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const run = (branch, args = [], cwd = root) => spawnSync(process.execPath, ['scripts/upload-preview.mjs', ...args], {
  cwd, encoding: 'utf8', timeout: 10000,
  env: { ...process.env, WORKERS_CI_BRANCH: branch },
})
const runDeploymentCheck = (cwd) => spawnSync(process.execPath, ['scripts/check-database-deployment.mjs'], {
  cwd, encoding: 'utf8', timeout: 10000,
})
const alignedObservability = () => ({
  enabled: true,
  head_sampling_rate: 1,
  redact_query_string: true,
  logs: { enabled: true, head_sampling_rate: 1, invocation_logs: true, persist: true },
  traces: { enabled: true, head_sampling_rate: 1, persist: true },
})
const restConfig = () => ({
  vars: { SUPABASE_URL: 'https://project-ref.supabase.co' },
  secrets: { required: ['SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY'] },
})
const makeFixture = (t, prefix, { upload = false } = {}) => {
  const fixture = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  const scripts = ['check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']
  if (upload) scripts.unshift('upload-preview.mjs')
  for (const file of scripts) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  return { fixture, path, write: (config) => writeFileSync(path, JSON.stringify(config)) }
}
const previewConfig = (preview = alignedObservability(), production = alignedObservability()) => ({
  ...restConfig(), observability: production, previews: { ...restConfig(), observability: preview },
})

test('配置 dry-run 移除生成的本地凭据文件且不调用远端部署', t => {
  const { fixture, write } = makeFixture(t, 'lifespace-preview-guard-', { upload: true })
  write(previewConfig())
  const devVars = join(fixture, 'dist/lifespace/.dev.vars')
  writeFileSync(devVars, 'SUPABASE_SECRET_KEY="local-only"\n')
  const result = run('preview', ['--dry-run'], fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /配置检查通过（未上传）/, result.stderr)
  assert.equal(existsSync(devVars), false)
})

test('生产 observability 缺少 traces 时阻断部署', t => {
  const { fixture, write } = makeFixture(t, 'lifespace-deployment-guard-')
  const observability = alignedObservability()
  observability.traces.enabled = false
  write(previewConfig(alignedObservability(), observability))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产 observability 必须启用、全量采样并持久化 traces/)
})

test('生产 observability 未持久化 logs 时阻断部署', t => {
  const { fixture, write } = makeFixture(t, 'lifespace-deployment-logs-')
  const observability = alignedObservability()
  observability.logs.persist = false
  write(previewConfig(alignedObservability(), observability))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产 observability 必须启用、全量采样并持久化 logs 与 invocation logs/)
})

test('生产与原生 Preview 的 observability 不一致时阻断部署', t => {
  const { fixture, write } = makeFixture(t, 'lifespace-deployment-parity-')
  const preview = alignedObservability()
  preview.logs.head_sampling_rate = 0.1
  write(previewConfig(preview))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产与原生 Preview 的 observability 配置必须一致/)
})

test('缺少 Supabase Data API 地址时阻断部署', t => {
  const { fixture, write } = makeFixture(t, 'lifespace-deployment-rest-')
  const rest = restConfig()
  write({ ...rest, observability: alignedObservability(), previews: { secrets: rest.secrets, observability: alignedObservability() } })
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /原生 Preview缺少 Supabase Data API 地址/)
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
