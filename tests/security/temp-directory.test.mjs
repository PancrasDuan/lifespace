import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

test('安全验证在不存在 macOS 临时目录的环境下仍完成全部检查', { timeout: 95000 }, () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const probe = new URL('../fixtures/linux-temp-directory.mjs', import.meta.url).href
  const result = spawnSync(process.execPath, ['scripts/check-security.mjs'], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${probe}` },
    encoding: 'utf8', timeout: 90000, maxBuffer: 4000000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(readFileSync(new URL('../../.cache/security-report.json', import.meta.url), 'utf8'))
  assert.equal(report.checks.length, 5)
  assert(report.checks.every(check => check.passed))
})
