import { z } from 'zod'
import type { NewsSource } from './news-sources'

export const newsFreshMs = 5 * 60 * 1000

export const newsSourceSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), defaultEnabled: z.boolean(), order: z.number().int().positive(),
})
export const newsSourcesResultSchema = z.object({ sources: z.array(newsSourceSchema) })
export type NewsSourcesResult = { sources: NewsSource[] }

const link = z.string().url().refine(value => /^https?:\/\//i.test(value))
export const newsItemSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), url: link, rank: z.number().int().positive(),
})
export const newsResultSchema = z.object({
  sourceId: z.string().min(1), fetchedAt: z.string().datetime(), sourceUpdatedAt: z.string().datetime().nullable(),
  upstreamStatus: z.enum(['success', 'cache']), cacheHit: z.boolean(), stale: z.boolean(),
  warning: z.object({ code: z.string(), message: z.string() }).nullable(), items: z.array(newsItemSchema).max(30),
})
export type NewsItem = z.infer<typeof newsItemSchema>
export type NewsResult = z.infer<typeof newsResultSchema>
