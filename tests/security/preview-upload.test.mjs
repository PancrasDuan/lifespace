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

test('配置 dry-run 清理两层本地连接串且不调用远端部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-preview-guard-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['upload-preview.mjs', 'check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const binding = { binding: 'HYPERDRIVE', id: '11111111111111111111111111111111', localConnectionString: 'local-only' }
  const rest = restConfig()
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  writeFileSync(path, JSON.stringify({ ...rest, hyperdrive: [binding], observability: alignedObservability(), previews: { ...rest, hyperdrive: [binding], observability: alignedObservability() } }))
  const result = run('preview', ['--dry-run'], fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /配置检查通过（未上传）/, result.stderr)
  const config = JSON.parse(readFileSync(path, 'utf8'))
  assert(!Object.hasOwn(config.hyperdrive[0], 'localConnectionString'))
  assert(!Object.hasOwn(config.previews.hyperdrive[0], 'localConnectionString'))
})

test('生产 observability 缺少 traces 时阻断部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-deployment-guard-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const binding = { binding: 'HYPERDRIVE', id: '11111111111111111111111111111111' }
  const rest = restConfig()
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  const observability = alignedObservability()
  observability.traces.enabled = false
  writeFileSync(path, JSON.stringify({ ...rest, hyperdrive: [binding], observability, previews: { ...rest, hyperdrive: [binding], observability: alignedObservability() } }))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产 observability 必须启用、全量采样并持久化 traces/)
})

test('生产 observability 未持久化 logs 时阻断部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-deployment-logs-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const binding = { binding: 'HYPERDRIVE', id: '11111111111111111111111111111111' }
  const rest = restConfig()
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  const observability = alignedObservability()
  observability.logs.persist = false
  writeFileSync(path, JSON.stringify({ ...rest, hyperdrive: [binding], observability, previews: { ...rest, hyperdrive: [binding], observability: alignedObservability() } }))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产 observability 必须启用、全量采样并持久化 logs 与 invocation logs/)
})

test('生产与原生 Preview 的 observability 不一致时阻断部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-deployment-parity-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const binding = { binding: 'HYPERDRIVE', id: '11111111111111111111111111111111' }
  const rest = restConfig()
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  const preview = alignedObservability()
  preview.logs.head_sampling_rate = 0.1
  writeFileSync(path, JSON.stringify({ ...rest, hyperdrive: [binding], observability: alignedObservability(), previews: { ...rest, hyperdrive: [binding], observability: preview } }))
  const result = runDeploymentCheck(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /生产与原生 Preview 的 observability 配置必须一致/)
})

test('缺少 Supabase Data API 地址时阻断部署', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'lifespace-deployment-rest-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'scripts'))
  mkdirSync(join(fixture, 'dist/lifespace'), { recursive: true })
  for (const file of ['check-database-deployment.mjs', 'strip-worker-dev-vars.mjs']) cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  const rest = restConfig()
  const path = join(fixture, 'dist/lifespace/wrangler.json')
  writeFileSync(path, JSON.stringify({ ...rest, observability: alignedObservability(), previews: { secrets: rest.secrets, observability: alignedObservability() } }))
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
