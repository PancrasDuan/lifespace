import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// 1.2.4 has three diagnostic paths outside onError that log client-controlled
// identifiers and raw exceptions. Keep protocol code intact; redact only those
// diagnostics. npm verifies the package tarball, and this patch verifies its file.
const target = new URL('../node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js', import.meta.url)
const original = '961c356f2f2474ecbe76cb5eda1f4e06d02c9a4185a016756628a9a7e05f4a54'
const replacements = [
  ['console.warn(`Failed to revoke grant ${options.grantId} after tokenExchangeCallback answered invalid_grant:`, revokeError);', 'console.warn("OAuth provider cleanup failed");'],
  ['console.warn(`Failed to renew client registration ${client.clientId}:`, error);', 'console.warn("OAuth provider registration renewal failed");'],
  ['console.warn(`CIMD fetch failed for ${clientId}:`, error instanceof Error ? error.message : error);', 'console.warn("OAuth provider CIMD lookup failed");'],
]
let source = await readFile(target, 'utf8')
const hash = text => createHash('sha256').update(text).digest('hex')
if (hash(source) === original) {
  for (const [from, to] of replacements) {
    if (source.split(from).length !== 2) throw new Error('OAuth provider diagnostic patch did not match the pinned version')
    source = source.replace(from, to)
  }
  await writeFile(target, source)
} else {
  // Reverse only the exact replacements, then verify the original fingerprint.
  let restored = source
  for (const [from, to] of replacements) restored = restored.replace(to, from)
  if (hash(restored) !== original) throw new Error('OAuth provider source changed; review the pinned diagnostic patch before installation')
}
console.log('OAuth provider diagnostic redaction verified (1.2.4).')
