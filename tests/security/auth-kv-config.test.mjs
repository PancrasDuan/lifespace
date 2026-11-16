import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'scripts/check-auth-kv-config.mjs')
const otherId = '57e73bb16a73477d9c307458e0d119ba'

async function fixture(config) {
  const dir = await mkdtemp(join(tmpdir(), 'lifespace-auth-kv-config-'))
  await mkdir(join(dir, 'scripts'))
  await mkdir(join(dir, 'dist/lifespace'), { recursive: true })
  await cp(script, join(dir, 'scripts/check-auth-kv-config.mjs'))
  await writeFile(join(dir, 'dist/lifespace/wrangler.json'), JSON.stringify(config))
  return dir
}

function run(dir) {
  try {
    return { status: 0, output: execFileSync(process.execPath, [join(dir, 'scripts/check-auth-kv-config.mjs')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const base = (overrides = {}) => ({
  kv_namespaces: [{ binding: 'HOROSCOPE_KV', id: otherId }, { binding: 'AUTH_KV', id: '0123456789abcdef0123456789abcdef' }],
  secrets: { required: ['SUPABASE_SECRET_KEY'] },
  ...overrides,
})

test('AUTH_KV 门禁拒绝占位、重复、缺失、旧 secret 和旧普通变量', async () => {
  for (const config of [
    base({ kv_namespaces: [{ binding: 'AUTH_KV', id: 'replace_with_32_hex_character_namespace_id' }] }),
    base({ kv_namespaces: [{ binding: 'HOROSCOPE_KV', id: otherId }, { binding: 'AUTH_KV', id: otherId }] }),
    base({ kv_namespaces: [{ binding: 'HOROSCOPE_KV', id: otherId }] }),
    base({ secrets: { required: ['AUTH_ALLOWED_EMAILS'] } }),
    base({ vars: { AUTH_ALLOWED_EMAILS: 'synthetic@example.invalid' } }),
    base({ kv_namespaces: [{ binding: 'AUTH_ALLOWED_EMAILS', id: '0123456789abcdef0123456789abcdef' }] }),
  ]) {
    const dir = await fixture(config)
    try {
      const result = run(dir)
      assert.equal(result.status, 1)
      assert.match(result.output, /发布已停止/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }
})

test('AUTH_KV 门禁接受独立有效 namespace 且已移除旧 secret', async () => {
  const dir = await fixture(base())
  try {
    const result = run(dir)
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /检查通过/)
    assert.match(await readFile(join(dir, 'dist/lifespace/wrangler.json'), 'utf8'), /AUTH_KV/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
