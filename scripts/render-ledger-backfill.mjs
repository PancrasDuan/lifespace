import { createHash } from 'node:crypto'
import { readFile, stat, open, realpath } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
export async function renderLedgerBackfill(input) {
  const template = await readFile(new URL('db/ledger/maintenance/legacy-backfill.sql', root), 'utf8')
  const catalog = await readFile(new URL('db/ledger/maintenance/legacy-backfill-catalog.sql', root), 'utf8')
  return template
    .replace('__LEDGER124_INPUT_JSON__', () => `E'${JSON.stringify(input).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`)
    .replace('__LEDGER124_CATALOG_QUERY__', () => catalog.trim().replace(/;$/, ''))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [inputPath, outputPath, ...extra] = process.argv.slice(2)
    if (!inputPath || !outputPath || extra.length) throw new Error('usage: node scripts/render-ledger-backfill.mjs /tmp/private-input.json /tmp/private-output.sql')
    const metadata = await stat(inputPath)
    if (!metadata.isFile() || (metadata.mode & 0o077)) throw new Error('input must be a private file (0600)')
    const directory = await realpath(dirname(resolve(outputPath)))
    if (!directory.startsWith('/tmp' + sep) && directory !== '/tmp') throw new Error('output must be under /tmp')
    const sql = await renderLedgerBackfill(JSON.parse(await readFile(inputPath, 'utf8')))
    const output = await open(resolve(outputPath), 'wx', 0o600)
    try { await output.writeFile(sql) } finally { await output.close() }
    console.log(`Rendered private SQL; SHA-256 ${createHash('sha256').update(sql).digest('hex')}`)
  } catch (error) {
    // Do not echo parser errors: they may contain private input snippets.
    console.error(error instanceof SyntaxError ? 'Invalid private JSON input' : error.message)
    process.exitCode = 1
  }
}
