import { z } from 'zod'
import { authorizedFetch, authorizedMutation } from '../auth/request'
import type { AdventureState, CommandResult } from '../shared/adventure/model'
import type { AdventureCommand } from '../shared/adventure/commands'

export type AdventureResponse = {
  state: AdventureState
  version: number
  today: string
  result?: CommandResult
}
export type Envelope = {
  requestId: string
  expectedVersion: number
  command: AdventureCommand
}
export class AdventureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly uncertain = false,
  ) {
    super(message)
  }
}
const responseSchema = z.object({
  state: z.custom<AdventureState>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'schemaVersion' in value &&
      value.schemaVersion === 1 &&
      'containers' in value &&
      Array.isArray(value.containers),
  ),
  version: z.number().int().nonnegative(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  result: z
    .object({
      entityId: z.string().optional(),
      reward: z.number(),
      ledgerIds: z.array(z.string()),
      achievementIds: z.array(z.string()),
      levelBefore: z.number(),
      levelAfter: z.number(),
    })
    .optional(),
})
const failureSchema = z.object({ error: z.object({ message: z.string() }) })
async function read(response: Response): Promise<AdventureResponse> {
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = failureSchema.safeParse(value)
    throw new AdventureError(
      response.status === 409
        ? '其他页面已更新数据，请重新读取后确认操作。'
        : failure.success
          ? failure.data.error.message
          : '操作暂时失败，请稍后重试。',
      response.status,
      response.status >= 500,
    )
  }
  const parsed = responseSchema.safeParse(value)
  if (!parsed.success)
    throw new AdventureError('服务返回的数据不完整，请重试读取。', 502, true)
  return parsed.data
}
export const adventureApi = {
  async load(ownerId: string, signal: AbortSignal) {
    return read(await authorizedFetch('/api/adventure', signal, ownerId))
  },
  async send(ownerId: string, envelope: Envelope, signal: AbortSignal) {
    try {
      return await read(
        await authorizedMutation(
          '/api/adventure/commands',
          JSON.stringify(envelope),
          signal,
          ownerId,
        ),
      )
    } catch (error) {
      if (error instanceof AdventureError) throw error
      throw new AdventureError(
        '连接中断，尚不能确认是否保存。请使用“安全重试”查询同一次操作。',
        0,
        true,
      )
    }
  },
}
