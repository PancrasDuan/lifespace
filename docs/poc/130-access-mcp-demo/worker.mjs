// Throwaway demonstration: no real ledger, accounts, secrets, or database bindings.
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const parse = value => JSON.parse(new TextDecoder().decode(decode(value)))

async function identity(request, env) {
  if (!env.TEAM_DOMAIN || !env.ACCESS_AUD || !env.CLIENT_A || !env.CLIENT_B) return { failure: 'configuration' }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || token.length > 16384) return { failure: 'assertion_missing' }
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return { failure: 'assertion_format' }
    const header = parse(parts[0]), claims = parse(parts[1])
    if (header.alg !== 'RS256' || !header.kid) return { failure: 'algorithm' }
    if (claims.iss !== env.TEAM_DOMAIN) return { failure: 'issuer' }
    const audiences = Array.isArray(claims.aud) ? claims.aud : typeof claims.aud === 'string' ? [claims.aud] : []
    if (!audiences.includes(env.ACCESS_AUD)) return { failure: `audience_mismatch_${typeof claims.aud}_${audiences.length}` }
    if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) return { failure: 'expired' }
    const response = await fetch(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
    if (!response.ok) return { failure: 'public_keys_unavailable' }
    const { keys } = await response.json()
    const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA')
    if (!jwk) return { failure: 'public_key_missing' }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    if (!valid) return { failure: 'signature' }
    if (claims.sub !== '') return { failure: 'principal_type' }
    if (claims.common_name === env.CLIENT_A) return { owner: '模拟用户 A' }
    if (claims.common_name === env.CLIENT_B) return { owner: '模拟用户 B' }
    return { failure: 'unknown_principal' }
  } catch { return { failure: 'assertion_validation' } }
}

const result = (id, value) => reply({ jsonrpc: '2.0', id, result: value })
const error = (id, code, message) => reply({ jsonrpc: '2.0', id, error: { code, message } })

export default {
  async fetch(request, env) {
    const { owner, failure } = await identity(request, env)
    if (!owner) return reply({ error: 'unauthorized', demoReason: failure }, 401)
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/mcp') return reply({ error: 'not_found' }, 404)
    let body
    try { body = await request.json() } catch { return error(null, -32700, 'Parse error') }
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') return error(body.id ?? null, -32600, 'Invalid request')
    if (body.method.startsWith('notifications/')) return new Response(null, { status: 202 })
    if (body.method === 'initialize') return result(body.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'ledger-access-demo', version: '0.1.0' }, instructions: '演示仅使用模拟数据，不能创建真实流水。' })
    if (body.method === 'ping') return result(body.id, {})
    if (body.method === 'tools/list') return result(body.id, { tools: [
      { name: 'list_demo_accounts', description: '查看当前模拟用户的模拟账户。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'preview_demo_entry', description: '模拟创建流水，只返回回执，不保存任何数据。', inputSchema: { type: 'object', properties: { account: { type: 'string' }, amountCents: { type: 'integer' } }, required: ['account', 'amountCents'], additionalProperties: false } },
    ] })
    if (body.method === 'tools/call') {
      const account = owner === '模拟用户 A' ? '模拟账户 A' : '模拟账户 B'
      const { name, arguments: args = {} } = body.params ?? {}
      if (name === 'list_demo_accounts') return result(body.id, { content: [{ type: 'text', text: JSON.stringify({ owner, accounts: [account] }) }] })
      if (name === 'preview_demo_entry') {
        if (args.account !== account || !Number.isSafeInteger(args.amountCents) || args.amountCents === 0) return result(body.id, { isError: true, content: [{ type: 'text', text: '账户不属于当前模拟用户，或金额无效。' }] })
        return result(body.id, { content: [{ type: 'text', text: JSON.stringify({ owner, account, amountCents: args.amountCents, saved: false, message: '仅为模拟回执，没有创建流水。' }) }] })
      }
      return error(body.id, -32602, 'Unknown tool')
    }
    return error(body.id ?? null, -32601, 'Method not found')
  },
}
