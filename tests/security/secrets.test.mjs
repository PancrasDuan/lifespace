import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { verifiedGithubAsset } from '../../scripts/github-release.mjs'

const project = process.cwd()
test('官方备用下载仍执行固定摘要检查，并拒绝缺失资产', async () => {
  const archive = Buffer.from('synthetic-release-archive')
  const calls = []
  const options = {
    repository: 'example/tool',
    tag: 'v1',
    asset: 'tool.tar.gz',
    sha256: createHash('sha256').update(archive).digest('hex'),
  }
  const native = globalThis.fetch
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(String(url))
      if (String(url).startsWith('https://github.com/')) return new Response(null, { status: 504 })
      if (String(url).includes('/tags/')) return Response.json({ assets: [{ name: options.asset, id: 123 }] })
      assert.equal(new Headers(init.headers).get('Accept'), 'application/octet-stream')
      return new Response(archive)
    }
    assert.deepEqual(await verifiedGithubAsset(options), archive)
    assert.deepEqual(calls, [
      'https://github.com/example/tool/releases/download/v1/tool.tar.gz',
      'https://api.github.com/repos/example/tool/releases/tags/v1',
      'https://api.github.com/repos/example/tool/releases/assets/123',
    ])
    globalThis.fetch = async () => new Response(Buffer.from('corrupt archive'))
    await assert.rejects(verifiedGithubAsset(options), /SHA-256/)
    globalThis.fetch = async (url) =>
      String(url).startsWith('https://github.com/') ? new Response(null, { status: 504 }) : Response.json({ assets: [] })
    await assert.rejects(verifiedGithubAsset(options), /缺少指定资产/)
  } finally {
    globalThis.fetch = native
  }
})
test('提交钩子拒绝假密钥并脱敏；删除后的历史密钥仍会阻止全量检查', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'lifespace-secret-fixture-'))
  const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' })
  const token = 'cfsd_' + 'fixtureOnlyNeverValid'.repeat(2)
  try {
    await mkdir(join(fixture, 'scripts'))
    await cp(join(project, 'scripts/check-secrets.mjs'), join(fixture, 'scripts/check-secrets.mjs'))
    await cp(join(project, 'scripts/github-release.mjs'), join(fixture, 'scripts/github-release.mjs'))
    await cp(join(project, '.gitleaks.toml'), join(fixture, '.gitleaks.toml'))
    await writeFile(join(fixture, '.gitignore'), '.cache/\n')
    await mkdir(join(fixture, '.cache'))
    await symlink(resolve('.cache/tools'), join(fixture, '.cache/tools'), 'dir')
    git('init', '-q')
    git('config', 'user.name', 'Security fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'core.hooksPath', join(project, '.githooks'))
    git('add', '.')
    git('commit', '-qm', 'benign fixture')
    await writeFile(join(fixture, 'example.txt'), token)
    git('add', 'example.txt')
    const rejected = spawnSync('git', ['commit', '-qm', 'fake credential'], { cwd: fixture, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0, '提交钩子必须拒绝密钥')
    assert.match(rejected.stdout + rejected.stderr, /dnshe-api-key/)
    assert.ok(!(rejected.stdout + rejected.stderr).includes(token), '输出不能出现假密钥原文')
    // 仅测试仓库绕过钩子制造历史泄露，再删除；验证 CI 扫描历史的能力。
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture history with fake credential')
    await rm(join(fixture, 'example.txt'))
    git('add', '-u')
    git('commit', '-qm', 'remove fake credential')
    const history = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], { cwd: fixture, encoding: 'utf8' })
    assert.notEqual(history.status, 0, '历史中的已删除密钥仍须阻止检查')
    assert.match(history.stdout + history.stderr, /dnshe-api-key/)
    assert.ok(!(history.stdout + history.stderr).includes(token))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
