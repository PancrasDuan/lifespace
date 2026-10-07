import { ApiError } from './upstream'
import { readOpenAI } from './openai-status'
import { readXAI } from './xai-status'
import type { AiProvider, AiStatusResult } from '../src/shared/ai-status-contracts'

const providers = [
  { id: 'openai', name: 'OpenAI', statusUrl: 'https://status.openai.com/' },
  { id: 'xai', name: 'xAI', statusUrl: 'https://status.x.ai/' },
] as const

async function readProvider(provider: typeof providers[number]): Promise<AiProvider> {
  try { return { ...provider, ...await (provider.id === 'openai' ? readOpenAI() : readXAI()) } }
  catch (error) {
    const message = error instanceof ApiError && error.code === 'SOURCE_CONNECTION_INVALID' ? '官方状态来源拒绝访问，请查看官方状态页' : '官方状态获取失败，请刷新重试或查看官方状态页'
    return { ...provider, checkedAt: new Date().toISOString(), status: 'unknown', description: '状态未知', incidents: [], affectedServices: [], error: message }
  }
}

export async function readAiStatus(): Promise<AiStatusResult> {
  const results = await Promise.all(providers.map(readProvider))
  const status = results.some(provider => provider.status === 'abnormal') ? 'abnormal' : results.some(provider => provider.status === 'unknown') ? 'unknown' : 'normal'
  return { status, checkedAt: new Date().toISOString(), providers: results }
}
