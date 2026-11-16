// No valid device credential is accepted or sent. No registration/data writes.
const url = new URL(process.env.TOKEN_GATEWAY_URL || '')
if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Explicit HTTPS Supabase origin required')
const apikey = process.env.TOKEN_PUBLISHABLE_KEY
if (!apikey?.startsWith('sb_publishable_')) throw Error('Publishable key required through environment')
const headers = { apikey, 'Content-Type': 'application/json', 'X-LifeSpace-Device-Token': 'synthetic-invalid-preflight' }
const target = new URL('/rest/v1/rpc/token_usage_heartbeat', url)
const options = await fetch(target, { method: 'OPTIONS', headers: { apikey, Origin: 'https://preflight.invalid', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey,content-type,x-lifespace-device-token' }, redirect: 'error', signal: AbortSignal.timeout(10000) })
// Invalid credential must fail before any device/heartbeat mutation. HTTP status
// by itself does not prove the custom header reached the SQL function.
const rejected = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ p_device: 'synthetic-invalid-preflight', p_generation: '1', p_hostname: 'synthetic-preflight', p_sync_hours: 1 }), redirect: 'error', signal: AbortSignal.timeout(10000) })
let body; try { body = await rejected.json() } catch {}
const credentialRejected = !rejected.ok && body?.message === 'TOKEN_CREDENTIAL_INVALID'
console.log(JSON.stringify({ optionsStatus: options.status, rejectionStatus: rejected.status, credentialRejected, scope: 'gateway reachability and invalid credential only; valid device upload/heartbeat/receipt remains required' }))
if (!options.ok || !credentialRejected) process.exitCode = 1
