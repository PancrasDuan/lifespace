// Local-only demo verification; synthetic RSA keys and synthetic accounts.
import assert from 'node:assert/strict'
import worker from './worker.mjs'

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
jwk.kid = 'demo-key'
const savedFetch = globalThis.fetch
globalThis.fetch = async () => Response.json({ keys: [jwk] })
const env = { TEAM_DOMAIN: 'https://demo.cloudflareaccess.com', ACCESS_AUD: 'demo-audience', CLIENT_A: 'client-a', CLIENT_B: 'client-b' }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function signed(client, overrides = {}) {
  const head = encode({ alg: 'RS256', kid: 'demo-key' })
  const claims = encode({ iss: env.TEAM_DOMAIN, aud: [env.ACCESS_AUD], exp: Math.floor(Date.now() / 1000) + 60, sub: '', common_name: client, ...overrides })
  const message = `${head}.${claims}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(message))
  return `${message}.${Buffer.from(signature).toString('base64url')}`
}
async function request(token, message) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers['cf-access-jwt-assertion'] = token
  return worker.fetch(new Request('https://demo.invalid/mcp', { method: 'POST', headers, body: JSON.stringify(message) }), env)
}
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params })
const tokenA = await signed('client-a')
const tokenB = await signed('client-b', { aud: env.ACCESS_AUD })
assert.equal((await (await request(tokenA, rpc('initialize'))).json()).result.protocolVersion, '2025-11-25')
assert.equal((await (await request(tokenA, rpc('tools/list'))).json()).result.tools.length, 2)
const accounts = rpc('tools/call', { name: 'list_demo_accounts', arguments: {} })
const resultA = await (await request(tokenA, accounts)).json()
const resultB = await (await request(tokenB, accounts)).json()
assert.equal(JSON.parse(resultA.result.content[0].text).owner, '模拟用户 A')
assert.equal(JSON.parse(resultB.result.content[0].text).owner, '模拟用户 B')
const cross = rpc('tools/call', { name: 'preview_demo_entry', arguments: { account: '模拟账户 B', amountCents: -3500 } })
assert.equal((await (await request(tokenA, cross)).json()).result.isError, true)
assert.equal((await request(null, accounts)).status, 401)
assert.equal((await request(await signed('client-a', { aud: ['wrong'] }), accounts)).status, 401)
assert.equal((await request(await signed('unknown'), accounts)).status, 401)
const parts = tokenA.split('.')
parts[1] = encode({ iss: env.TEAM_DOMAIN, aud: [env.ACCESS_AUD], exp: Math.floor(Date.now() / 1000) + 60, sub: '', common_name: 'client-b' })
assert.equal((await request(parts.join('.'), accounts)).status, 401)
globalThis.fetch = savedFetch
console.log('Demo checks passed: MCP initialize/list, identities, isolation, invalid and forged assertions.')
