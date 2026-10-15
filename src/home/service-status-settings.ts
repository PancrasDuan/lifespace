import type { AiProvider } from '../shared/ai-status-contracts'

export const serviceStatusOptions = [
  { id: 'openai', name: 'OpenAI', url: 'https://status.openai.com/' },
  { id: 'xai', name: 'xAI', url: 'https://status.x.ai/' },
  { id: 'resend', name: 'Resend', url: 'https://resend-status.com/' },
  { id: 'github', name: 'GitHub', url: 'https://www.githubstatus.com/' },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/' },
  { id: 'supabase', name: 'Supabase', url: 'https://status.supabase.com/' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion-status.com/' },
  { id: 'tailscale', name: 'Tailscale', url: 'https://status.tailscale.com/' },
  { id: 'tencent', name: '腾讯云', url: 'https://status.cloud.tencent.com/' },
] as const satisfies readonly { id: AiProvider['id']; name: string; url: string }[]
export type ServiceStatusId = typeof serviceStatusOptions[number]['id']
export const serviceStatusStorageKey = 'lifespace.service-status.providers.v1'
const defaults: ServiceStatusId[] = ['openai', 'xai']

export function normalizeServiceSelection(values: readonly string[]): ServiceStatusId[] {
  return serviceStatusOptions.filter(option => values.includes(option.id)).map(option => option.id)
}
export function loadServiceSelection(): ServiceStatusId[] {
  try {
    const raw = localStorage.getItem(serviceStatusStorageKey)
    if (raw !== null) {
      const value: unknown = JSON.parse(raw)
      if (Array.isArray(value) && value.every(id => typeof id === 'string')) return normalizeServiceSelection(value)
    }
  } catch { /* 存储不可用或配置损坏时使用默认展示。 */ }
  return [...defaults]
}
export function saveServiceSelection(values: readonly ServiceStatusId[]) {
  localStorage.setItem(serviceStatusStorageKey, JSON.stringify(normalizeServiceSelection(values)))
}
