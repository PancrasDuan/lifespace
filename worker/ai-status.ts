import { ApiError } from './upstream'
import { readOpenAI } from './openai-status'
import { readXAI } from './xai-status'
import { readResend } from './resend-status'
import { readStatuspage } from './statuspage-status'
import { readSupabase } from './supabase-status'
import { xaiEventSubStatuses } from './xai-event-substatuses'
import type { AiProvider, AiStatusResult } from '../src/shared/ai-status-contracts'

const providers = [
  { id: 'openai', name: 'OpenAI', statusUrl: 'https://status.openai.com/' },
  { id: 'xai', name: 'xAI', statusUrl: 'https://status.x.ai/' },
  { id: 'resend', name: 'Resend', statusUrl: 'https://resend-status.com/' },
  { id: 'github', name: 'GitHub', statusUrl: 'https://www.githubstatus.com/' },
  { id: 'cloudflare', name: 'Cloudflare', statusUrl: 'https://www.cloudflarestatus.com/' },
  { id: 'supabase', name: 'Supabase', statusUrl: 'https://status.supabase.com/' },
  { id: 'notion', name: 'Notion', statusUrl: 'https://www.notion-status.com/' },
] as const

const readers = {
  openai: readOpenAI, xai: readXAI, resend: readResend, supabase: readSupabase,
  github: () => readStatuspage('https://www.githubstatus.com/api/v2/summary.json'),
  cloudflare: () => readStatuspage('https://www.cloudflarestatus.com/api/v2/summary.json'),
  notion: () => readStatuspage('https://www.notion-status.com/api/v2/summary.json'),
}

async function readProvider(provider: typeof providers[number]): Promise<AiProvider> {
  try { return { ...provider, ...await readers[provider.id]() } }
  catch (error) {
    const message = error instanceof ApiError && error.code === 'SOURCE_CONNECTION_INVALID' ? '官方状态来源拒绝访问，请查看官方状态页' : '官方状态获取失败，请刷新重试或查看官方状态页'
    return { ...provider, statusBasis: provider.id === 'xai' ? 'official-events' : 'official-components', checkedAt: new Date().toISOString(), status: 'unknown', description: '状态未知', incidents: [], affectedServices: [], error: message, subStatuses: provider.id === 'xai' ? xaiEventSubStatuses(null) : [], subStatusError: provider.id === 'xai' ? null : '官网子状态暂不可获取' }
  }
}

export async function readAiStatus(): Promise<AiStatusResult> {
  const results = await Promise.all(providers.map(readProvider))
  const status = results.some(provider => provider.status === 'abnormal') ? 'abnormal' : results.some(provider => provider.status === 'unknown') ? 'unknown' : 'normal'
  return { status, checkedAt: new Date().toISOString(), providers: results }
}
