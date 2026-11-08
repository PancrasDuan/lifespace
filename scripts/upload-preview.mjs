import { spawn, execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only the integration branch deploys the fixed native Preview. Resources are
// explicitly shared; browser and MCP admission remains limited to the test owner.
const root = fileURLToPath(new URL('../', import.meta.url))
const branch = process.env.WORKERS_CI_BRANCH ?? execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
if (branch !== 'preview') throw new Error('预览部署只允许 GitHub preview 分支。')
if (process.argv.slice(2).some(value => value !== '--dry-run')) throw new Error('预览脚本只接受 --dry-run。')

await import('./check-database-deployment.mjs')
const configFile = join(root, 'dist/lifespace/wrangler.json')
const config = JSON.parse(await readFile(configFile, 'utf8'))
const preview = config.previews
if (!preview) throw new Error('缺少原生 Preview 配置。')
if (preview.hyperdrive?.find(binding => binding.binding === 'HYPERDRIVE')?.id !== config.hyperdrive.find(binding => binding.binding === 'HYPERDRIVE')?.id) throw new Error('本任务的原生 Preview 必须绑定已验收的共享 Hyperdrive。')
if (!preview.observability?.enabled || !preview.observability.logs?.enabled || !preview.observability.traces?.enabled) throw new Error('原生 Preview 必须开启日志与 traces。')
if (process.argv.includes('--dry-run')) {
  console.log('原生 Preview 部署配置检查通过（未上传）。')
  process.exit(0)
}
const child = spawn(process.execPath, [
  join(root, 'node_modules/wrangler/bin/wrangler.js'), 'preview', '--name', 'preview', '--json',
  '--config', configFile,
], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? join(root, '.cache/wrangler.log') } })
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => signal ? reject(new Error(`预览上传被 ${signal} 中断。`)) : resolve(code))
})
if (code !== 0) throw new Error(`预览上传退出码 ${code}`)
