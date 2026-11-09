import { mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { verifiedGithubAsset } from './github-release.mjs'

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('CI 工具安装仅支持 Linux x64；本地按文档指定现有 PostgREST')
const directory = new URL('../.cache/postgrest/', import.meta.url)
await mkdir(directory, { recursive: true })
const archive = await verifiedGithubAsset({
  repository: 'PostgREST/postgrest',
  tag: 'v13.0.7',
  asset: 'postgrest-v13.0.7-linux-static-x86-64.tar.xz',
  sha256: '4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b',
})
const path = new URL('archive.tar.xz', directory)
await writeFile(path, archive)
execFileSync('tar', ['-xJf', path.pathname, '-C', directory.pathname, 'postgrest'])
await rm(path)
