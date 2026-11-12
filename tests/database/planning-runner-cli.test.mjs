import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const runner = 'tests/support/run-planning-database.mjs'
const invoke = args => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: process.env, timeout: 300_000, maxBuffer: 20 * 1024 * 1024 })

test('browser-only without browser fails before attempting database setup', () => {
  for (const args of [['--browser-only'], ['--goal-model', '--browser-only']]) {
    const result = invoke(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--browser-only.*--browser/)
    assert.doesNotMatch(result.stdout, /通过：/)
  }
})

test('API selection reports its actual scope, never full coverage', () => {
  const result = invoke(['--goal-model', '--api', 'tests/api/adventure-category-database.test.ts'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /HTTP 筛选.*adventure-category-database\.test\.ts/)
  assert.match(result.stdout, /浏览器：未运行/)
  assert.doesNotMatch(result.stdout, /完整.*通过|通过：所选四表 HTTP／浏览器测试/)
})

test('unfiltered default runs legacy, current HTTP, migration and audit phases', () => {
  const result = invoke([])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /旧五表 SQL 回归（8 个脚本）/)
  assert.match(result.stdout, /通过：四表空库初始化/)
  const firstApiCount = result.stdout.match(/Tests\s+(\d+) passed/)
  assert.ok(firstApiCount && Number(firstApiCount[1]) >= 69, 'current HTTP suite did not run in full')
  assert.match(result.stdout, /通过：合成旧库升级至四表/)
  assert.match(result.stdout, /通过：目标控制台旧库升级至四表/)
  assert.match(result.stdout, /通过：隔离旧库迁移验收基线/)
  assert.match(result.stdout, /通过：旧库保护、四表 HTTP、历史回执、目标契约与完整迁移安全验收/)
})

test('default API selection retains other phases but does not claim complete coverage', () => {
  const result = invoke(['--api', 'tests/api/adventure-category-database.test.ts'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /HTTP 筛选.*adventure-category-database\.test\.ts/)
  assert.match(result.stdout, /四表运行范围见上方/)
  assert.match(result.stdout, /通过：隔离旧库迁移验收基线/)
  assert.doesNotMatch(result.stdout, /通过：旧库保护、四表 HTTP、历史回执、目标契约与完整迁移安全验收/)
})

test('browser-only actually runs selected browser tests and reports HTTP skipped', () => {
  for (const prefix of [['--goal-model'], []]) {
    const result = invoke([...prefix, '--browser-only', '--browser', 'tests/browser/adventure-review-fixes-database.spec.ts', '--grep', '1440px 在目标页新建行动', '--timeout=45000'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /1 passed/)
    assert.match(result.stdout, /HTTP 未运行；浏览器：已运行.*adventure-review-fixes-database\.spec\.ts/)
    assert.doesNotMatch(result.stdout, /通过：旧库保护、四表 HTTP、历史回执、目标契约与完整迁移安全验收|通过：所选四表 HTTP／浏览器测试/)
    if (!prefix.length) assert.match(result.stdout, /四表运行范围见上方/)
  }
})

test('discovery or empty-suite flags cannot masquerade as test execution', () => {
  for (const args of [['--goal-model', '--browser', '--list'], ['--goal-model', '--api', '--help'], ['--goal-model', '--api', '--passWithNoTests']]) {
    const result = invoke(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /不能.*测试/)
    assert.doesNotMatch(result.stdout, /通过：/)
  }
})
