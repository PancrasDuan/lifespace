import { spawn, execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Candidate versions share production resources. Restrict both browser and MCP
// admission to the dedicated test owner without changing the active version.
const email = z.email().parse(process.env.LIFESPACE_PREVIEW_TEST_EMAIL?.trim().toLowerCase())
const root = fileURLToPath(new URL('../', import.meta.url))
const branch = process.env.WORKERS_CI_BRANCH ?? execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
if (!branch || branch === 'main') throw new Error('预览上传需要明确的非 main 分支。')
if (process.argv.slice(2).some(value => value !== '--dry-run')) throw new Error('预览脚本只接受 --dry-run。')
const alias = branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
if (!alias) throw new Error('无法生成预览分支别名。')

await import('./check-database-deployment.mjs')
const configFile = join(root, 'dist/lifespace/wrangler.json')
const config = JSON.parse(await readFile(configFile, 'utf8'))
if (config.vars?.PREVIEW_TEST_EMAIL !== '') throw new Error('正式配置必须显式清空 PREVIEW_TEST_EMAIL，请重新构建。')
const child = spawn(process.execPath, [
  join(root, 'node_modules/wrangler/bin/wrangler.js'), 'versions', 'upload',
  '--config', configFile,
  '--var', `PREVIEW_TEST_EMAIL:${email}`, '--keep-vars', '--preview-alias', alias,
  ...process.argv.slice(2),
], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? join(root, '.cache/wrangler.log') } })
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => signal ? reject(new Error(`预览上传被 ${signal} 中断。`)) : resolve(code))
})
if (code !== 0) throw new Error(`预览上传退出码 ${code}`)
