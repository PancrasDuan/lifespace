import { z } from 'zod'

export const aiStateSchema = z.enum(['normal', 'abnormal', 'unknown'])
const instant = z.iso.datetime({ offset: true })
export const aiIncidentSchema = z.object({
  id: z.string(), title: z.string(), status: z.string(), description: z.string(),
  affectedServices: z.array(z.string()), updatedAt: instant,
  updates: z.array(z.object({ body: z.string(), createdAt: instant })),
})
export const aiProviderSchema = z.object({
  id: z.enum(['openai', 'xai']), name: z.string(), status: aiStateSchema,
  statusUrl: z.enum(['https://status.openai.com/', 'https://status.x.ai/']),
  checkedAt: instant, description: z.string(), incidents: z.array(aiIncidentSchema),
  affectedServices: z.array(z.string()), error: z.string().nullable(),
})
export const aiStatusResultSchema = z.object({ status: aiStateSchema, checkedAt: instant, providers: z.array(aiProviderSchema).min(1) })
export type AiProvider = z.infer<typeof aiProviderSchema>
export type AiStatusResult = z.infer<typeof aiStatusResultSchema>
