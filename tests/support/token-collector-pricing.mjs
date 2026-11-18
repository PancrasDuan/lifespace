import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { Store } from '../../tools/token-collector/dist/tools/token-collector/store.js'
import { scan } from '../../tools/token-collector/dist/tools/token-collector/collector.js'
import { refreshPrices } from '../../tools/token-collector/dist/tools/token-collector/prices.js'

// Explicit online probe. CI's reliability checks use deterministic synthetic
// catalogues; this separately verifies the real public upstream acquisition.
process.umask(0o077)
const root = await mkdtemp(join(tmpdir(), 'token-collector-real-prices-'))
let store
try {
  const home = join(root, 'home'), state = join(root, 'state')
  await mkdir(join(home, '.codex/sessions'), { recursive: true })
  await writeFile(join(home, '.codex/sessions/synthetic.jsonl'), [
    { timestamp: '2026-11-15T00:00:00Z', type: 'session_meta', payload: { id: 'synthetic-real-pricing-213' } },
    { timestamp: '2026-11-15T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { timestamp: '2026-11-15T00:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 30 }, last_token_usage: { input_tokens: 100, output_tokens: 30 } } } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n')
  store = await Store.open(state)
  store.set('config', { deviceId: 'synthetic-price-213', server: 'https://example.invalid/', sourceHome: home, hours: 1, loopback: false, agents: ['codex', 'grok', 'hermes', 'claude', 'workbuddy', 'cursor'], agentsMode: 'all' })
  await scan(store, state, { offline: true })
  const latest = () => JSON.parse(store.db.prepare('select snapshot from rollups').get().snapshot)
  assert.equal(latest().content.cost.coverage, 'unknown')
  const first = await refreshPrices(store, join(state, 'tokscale'))
  assert(store.get('price').fingerprint, 'no official price cache acquired; online probe is not verified')
  await scan(store, state, { offline: true, rescan: true })
  assert.equal(latest().content.metrics.total, 130)
  assert.equal(latest().content.cost.coverage, 'unverified')
  assert(Number(latest().content.cost.apiEstimate) > 0)
  const second = await refreshPrices(store, join(state, 'tokscale'))
  assert(store.get('price').fingerprint)
  console.log(JSON.stringify({ initial: 'unknown without cache', first, second, realCliCost: latest().content.cost, tokens: 130, rawUsageSentToCatalogs: false }))
} finally { store?.close(); await rm(root, { recursive: true, force: true }) }
