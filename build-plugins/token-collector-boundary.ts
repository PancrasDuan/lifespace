import type { Plugin } from 'vite'

// Applies to every Vite environment, including the Cloudflare Worker bundle.
export function tokenCollectorBoundary(): Plugin {
  return {
    name: 'token-collector-node-boundary',
    enforce: 'pre',
    load(id) {
      const path = id.replaceAll('\\', '/').split('?')[0]
      if (path.includes('/tools/token-collector/') || path.includes('/node_modules/@tokscale/')) {
        throw new Error('Token collector / Tokscale 仅供 Node CLI 使用，不能进入浏览器或 Worker bundle')
      }
    },
  }
}
