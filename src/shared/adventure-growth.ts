import { z } from 'zod'
import { achievementSchema, growthSchema } from './adventure-planning'

const version = z.number().int().nonnegative().safe()
const origin = {
  mainlineId: z.uuid(), mainlineName: z.string(), mainlineKind: z.enum(['normal', 'independent']),
  goalId: z.uuid().nullable(), goalTitle: z.string().nullable(),
}
export const rewardEntrySchema = z.object({
  id: z.uuid(), kind: z.enum(['task_completed', 'goal_achieved']), entityId: z.uuid(), title: z.string(),
  occurredAt: z.string(), occurredOn: z.iso.date(), amount: version.refine(value => value > 0), ...origin,
  calculation: z.discriminatedUnion('type', [
    z.object({ type: z.literal('fixed_task'), completionId: z.uuid(), count: z.literal(1), coefficient: z.literal(1) }),
    z.object({ type: z.literal('goal_actions'), count: version, coefficient: z.number().int().min(1).max(3), fallback: z.boolean() }),
  ]),
})
export type RewardEntry = z.infer<typeof rewardEntrySchema>
export const growthPageSchema = z.object({
  version, growth: growthSchema.extend({ achievements: z.array(achievementSchema.extend({ remaining: version })).length(7) }),
  pageSize: z.literal(10), total: version, items: z.array(rewardEntrySchema).max(10), nextCursor: z.uuid().nullable(),
})
export type GrowthPage = z.infer<typeof growthPageSchema>
export const rewardSourceSchema = z.object({
  version, event: rewardEntrySchema, description: z.string().nullable(), plannedOn: z.iso.date().nullable(),
  standards: z.array(z.string()).max(50), reflection: z.string().nullable(),
  page: z.number().int().positive(), pageSize: z.literal(5), totalSources: version,
  actionSources: z.array(z.object({ taskId: z.uuid(), completionId: z.uuid(), occurredOn: z.iso.date(),
    title: z.string(), description: z.string(), plannedOn: z.iso.date(), ...origin })).max(5),
})
export type RewardSource = z.infer<typeof rewardSourceSchema>
export const growthQuerySchema = z.strictObject({ version: z.coerce.number().int().nonnegative().safe().optional(), cursor: z.uuid().optional() })
  .refine(value => !value.cursor || value.version !== undefined)
export const rewardSourceQuerySchema = z.strictObject({ id: z.uuid(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), version: z.coerce.number().int().nonnegative().safe().optional() })
