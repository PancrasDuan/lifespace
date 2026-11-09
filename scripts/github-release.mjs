import { createHash } from 'node:crypto'

// Fixed-version build tools may hit a stale release-download redirect. The
// fallback stays on GitHub's official API; both paths require the same digest.
export async function verifiedGithubAsset({ repository, tag, asset, sha256 }) {
  const get = (url, accept) => fetch(url, { headers: accept ? { Accept: accept } : {}, signal: AbortSignal.timeout(60_000) })
  let response
  try {
    response = await get(`https://github.com/${repository}/releases/download/${tag}/${asset}`)
  } catch { /* Try the official asset API below. */ }
  if (!response?.ok) {
    const metadata = await get(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, 'application/vnd.github+json')
    if (!metadata.ok) throw new Error(`官方发布元数据下载失败：HTTP ${metadata.status}`)
    const release = await metadata.json()
    const match = Array.isArray(release.assets) ? release.assets.find(item => item.name === asset) : undefined
    if (!Number.isSafeInteger(match?.id) || match.id <= 0) throw new Error('官方发布中缺少指定资产')
    response = await get(`https://api.github.com/repos/${repository}/releases/assets/${match.id}`, 'application/octet-stream')
  }
  if (!response.ok) throw new Error(`官方发布资产下载失败：HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(archive).digest('hex') !== sha256) throw new Error('官方发布资产 SHA-256 校验失败')
  return archive
}
