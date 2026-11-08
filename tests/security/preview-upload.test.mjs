import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const run = (email, branch, args = []) => spawnSync(process.execPath, ['scripts/upload-preview.mjs', ...args], {
  cwd: root, encoding: 'utf8', timeout: 10000,
  env: { ...process.env, LIFESPACE_PREVIEW_TEST_EMAIL: email, WORKERS_CI_BRANCH: branch },
})

test('预览未指定有效测试邮箱时拒绝上传', () => {
  for (const email of ['', 'not-an-email']) {
    const result = run(email, 'codex/test-preview')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid email address/)
  }
})

test('预览脚本拒绝 main，且不会走到需要构建产物的上传阶段', () => {
  const result = run('preview@example.com', 'main', ['--dry-run'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /预览上传需要明确的非 main 分支/)
})

test('预览不接受覆盖目标配置或上传命令的额外参数', () => {
  const result = run('preview@example.com', 'codex/test-preview', ['--config', 'another-worker.json'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /预览脚本只接受 --dry-run/)
})
