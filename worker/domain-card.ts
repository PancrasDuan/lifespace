import { readDomains } from './domains'
import { ApiError } from './upstream'
import { domainsResultSchema } from '../src/shared/contracts'

export async function readDomainCard(env: Partial<CloudflareEnv>) {
  if (!env.DNSHE_API_KEY || !env.DNSHE_API_SECRET) throw new ApiError('DOMAINS_NOT_CONFIGURED', 'DNSHE 信息尚未接入', 503)
  if (!env.DNSHE_READ_LIMITER) throw new ApiError('DOMAINS_NOT_CONFIGURED', 'DNSHE 读取保护尚未配置', 503)
  // 缓存键只含凭据摘要，不使用来访 URL、请求头或明文凭据；轮换后不复用旧账户结果。
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([env.DNSHE_API_KEY, env.DNSHE_API_SECRET])))
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const key = new Request(`https://lifespace.onepeace.cc.cd/__private-cache/domains-v2/${fingerprint}`)
  let cache: Cache | undefined
  try {
    cache = typeof caches !== 'undefined' ? await caches.open('lifespace-domains-v1') : undefined
    const cached = await cache?.match(key)
    if (cached) {
      const parsed = domainsResultSchema.safeParse(await cached.json())
      if (parsed.success && Date.now() - Date.parse(parsed.data.fetchedAt) >= 0 && Date.now() - Date.parse(parsed.data.fetchedAt) < 300000) return parsed.data
    }
  } catch { /* 缓存故障时仍经过读取限流，不直接放开上游调用。 */ }
  const { success } = await env.DNSHE_READ_LIMITER.limit({ key: 'lifespace:dnshe:read' })
  if (!success) throw new ApiError('SOURCE_RATE_LIMITED', '域名信息刷新过于频繁，请稍后重试', 429)
  const result = await readDomains(env)
  try { await cache?.put(key, Response.json(result, { headers: { 'Cache-Control': 'public, max-age=300' } })) }
  catch { /* 缓存写入失败不影响已成功读取的展示结果。 */ }
  return result
}
