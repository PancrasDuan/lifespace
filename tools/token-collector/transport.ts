import { z } from 'zod'
import { LocalError } from './local.ts'
import { type Config, type Credential, type Store } from './store.ts'

export class TransportError extends LocalError { constructor(code: string, readonly retryable: boolean) { super(code) } }
export function endpoint(value: string, loopback = false): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new LocalError('ENDPOINT_INVALID') }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new LocalError('ENDPOINT_REQUIRES_HTTPS')
  return url
}
export async function request(url: URL, body: string, headers: Record<string, string> = {}): Promise<unknown> {
  // fetch follows no redirects, even to the same origin: never forward a secret.
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
      redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    if (response.status >= 300 && response.status < 400) throw new TransportError('REDIRECT_REJECTED', false)
    const reader = response.body?.getReader()
    if (!reader) throw new TransportError('RESPONSE_INVALID', true)
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > 65536) { await reader.cancel(); throw new TransportError('RESPONSE_TOO_LARGE', false) }
      chunks.push(value)
    }
    let value: unknown
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new TransportError('RESPONSE_INVALID', true) }
    if (!response.ok) {
      const known = z.object({ message: z.enum(['TOKEN_CREDENTIAL_INVALID', 'TOKEN_STALE_VERSION', 'TOKEN_VERSION_CONFLICT', 'TOKEN_HASH_MISMATCH', 'TOKEN_INVALID']) }).safeParse(value)
      if (known.success) throw new TransportError(known.data.message, false)
      throw new TransportError(response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'SERVER_TEMPORARY' : response.status === 401 || response.status === 403 ? 'CREDENTIAL_REJECTED' : 'REQUEST_REJECTED', response.status === 429 || response.status >= 500)
    }
    return value
  } catch (e) { if (e instanceof LocalError) throw e; throw new TransportError('NETWORK_UNCONFIRMED', true) }
}
const registrationSchema = z.strictObject({ requestId: z.uuid(), code: z.string().regex(/^[A-Z2-9]{8}$/), claimSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresIn: z.literal(600), interval: z.literal(5), verificationPath: z.literal('/token/devices/confirm'), expiresAt: z.number(), nextPollAt: z.number() })
const startedSchema = registrationSchema.omit({ expiresAt: true, nextPollAt: true })
const claimedSchema = z.strictObject({ status: z.literal('claimed'), deviceId: z.string(), generation: z.string(), uploadToken: z.string(), tokenExpiresAt: z.null(),
  upload: z.strictObject({ url: z.string(), publishableKey: z.string(), header: z.literal('X-LifeSpace-Device-Token') }) })
const pendingSchema = z.strictObject({ status: z.enum(['pending', 'slow_down', 'denied', 'expired', 'superseded']), interval: z.literal(5).optional() })
export async function startRegistration(store: Store, config: Config, hostname: string, platform: 'linux' | 'macos', now = Date.now()) {
  const server = endpoint(config.server, config.loopback)
  if (server.pathname !== '/') throw new LocalError('SERVER_ORIGIN_REQUIRED')
  const value = startedSchema.parse(await request(new URL('/api/token/registrations/start', server), JSON.stringify({ deviceId: config.deviceId, hostname, platform })))
  // Commit before printing the code or performing the first claim.
  store.transaction(() => {
    store.set('registration', { ...value, expiresAt: now + value.expiresIn * 1000, nextPollAt: now }); store.set('authorization', 'pending')
  })
  return { code: value.code, url: new URL(value.verificationPath, server).href }
}
export function registrationDisplay(store: Store) {
  const value = registrationSchema.parse(store.get('registration'))
  return { code: value.code, url: new URL(value.verificationPath, store.config().server).href }
}
export async function claimRegistration(store: Store, now = Date.now()): Promise<{ status: string; waitMs?: number }> {
  const value = registrationSchema.parse(store.get('registration')), config = store.config()
  if (now >= value.expiresAt) { store.set('authorization', 'expired'); return { status: 'expired' } }
  if (now < value.nextPollAt) return { status: 'wait', waitMs: value.nextPollAt - now }
  // Persist rate-limit state even when the response is lost or process crashes.
  store.set('registration', { ...value, nextPollAt: now + 5000 })
  const result = await request(new URL('/api/token/registrations/claim', endpoint(config.server, config.loopback)), JSON.stringify({ requestId: value.requestId, claimSecret: value.claimSecret }))
  const claimed = claimedSchema.safeParse(result)
  if (claimed.success) {
    validateCredential(claimed.data, config)
    const { status: _status, tokenExpiresAt: _expiry, ...credential } = claimed.data
    store.activate(credential)
    return { status: 'claimed' }
  }
  const state = pendingSchema.parse(result)
  store.set('authorization', state.status)
  if (state.status === 'slow_down') store.set('registration', { ...value, nextPollAt: now + 10000 })
  return { status: state.status, ...(state.status === 'pending' || state.status === 'slow_down' ? { waitMs: state.status === 'slow_down' ? 10000 : 5000 } : {}) }
}
export function validateCredential(credential: Credential, config: Config) {
  const upload = endpoint(credential.upload.url, config.loopback)
  if (upload.pathname !== '/rest/v1/rpc/token_usage_upload') throw new LocalError('UPLOAD_PATH_INVALID')
  if (credential.deviceId !== config.deviceId) throw new LocalError('IDENTITY_MISMATCH')
  // HTTPS URLs come only from the configured Worker claim response. Local test
  // endpoints remain restricted to numeric loopback addresses.
}
export async function uploadPending(store: Store, hostname: string, now = Date.now(), limit = 100) {
  const credential = store.credential()
  if (!credential) return { uploaded: 0, pending: store.tasks().length, heartbeat: false }
  const config = store.config(); validateCredential(credential, config)
  const url = endpoint(credential.upload.url, config.loopback)
  const headers = { apikey: credential.upload.publishableKey, [credential.upload.header]: credential.uploadToken }
  let uploaded = 0, attempted = 0
  const deferred = new Set<string>()
  for (const task of store.tasks()) {
    if (task.generation !== credential.generation) continue
    const key = JSON.stringify([task.date, task.agent])
    if (deferred.has(key)) continue
    // A later version must never overtake an unconfirmed predecessor merely
    // because that predecessor is backing off. Other identities may proceed.
    if (task.next_at > now) { deferred.add(key); continue }
    if (attempted++ >= limit) break
    try {
      const value = await request(url, task.body, headers)
      if (!store.acknowledge(task, value)) throw new TransportError('RECEIPT_MISMATCH', false)
      uploaded++
    } catch (e) {
      const code = e instanceof LocalError ? e.code : 'UPLOAD_UNCONFIRMED'
      store.retry(task, code, now)
      // Preserve every immutable request. Bound attempts per run and stop on
      // network/credential/conflict errors instead of hammering later tasks.
      break
    }
  }
  let heartbeat = false
  try {
    const value = z.strictObject({ persisted: z.literal(true), deviceId: z.string(), generation: z.string(), receivedAt: z.string() }).parse(await request(new URL('/rest/v1/rpc/token_usage_heartbeat', url), JSON.stringify({ p_device: config.deviceId, p_generation: credential.generation, p_hostname: hostname, p_sync_hours: config.hours }), headers))
    if (value.deviceId !== config.deviceId || value.generation !== credential.generation) throw new LocalError('RECEIPT_MISMATCH')
    heartbeat = true; store.set('heartbeat', { at: now, result: 'persisted' })
  } catch (e) { store.set('heartbeat', { at: now, result: e instanceof LocalError ? e.code : 'HEARTBEAT_UNCONFIRMED' }) }
  return { uploaded, pending: store.tasks().length, heartbeat }
}
