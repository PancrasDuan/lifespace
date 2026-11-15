import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const sources = ['db/adventure/create-planning.sql', 'db/adventure/list-tasks.sql', 'db/adventure/migrations/20261115082114_recurring_tasks.sql']
// Produce a single transaction for an empty database. Do not send the pieces
// separately: source scripts contain their own transaction boundaries.
export async function buildRecurringInstall() {
  const parts = await Promise.all(sources.map(async path => {
    const sql = (await readFile(resolve(root, path), 'utf8')).replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '')
    return `-- Source: ${path}\n${sql}`
  }))
  return `-- Empty database only; coordinated recurring Worker release required.\nbegin;\n${parts.join('\n')}\ncommit;\n`
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/build-adventure-recurring-install.mjs <output.sql>')
  const sql = await buildRecurringInstall()
  await writeFile(process.argv[2], sql)
  console.log(`Wrote ${Buffer.byteLength(sql)} bytes to ${process.argv[2]}`)
}
