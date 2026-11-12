import { z } from 'zod'
import { planningEnvelopeSchema } from './adventure-planning'

// Five-table envelopes remain valid only for read-only historical receipt lookup.
const legacyName = z.string().trim().min(1).max(200)
const legacyStandards = z.array(z.string().trim().max(4000)).min(1).max(50)
  .transform(values => values.filter(Boolean)).pipe(z.array(z.string().min(1)).min(1).max(50))
const legacyDestination = z.union([z.literal(''), z.literal('independent'), z.uuid()])
const legacyGoalEnvelope = z.strictObject({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), expectedVersion: z.number().int().nonnegative().safe(),
  command: z.union([
    z.strictObject({ type: z.literal('createGoal'), destination: legacyDestination, title: legacyName, standards: legacyStandards }),
    z.strictObject({ type: z.literal('editGoal'), id: z.uuid(), destination: legacyDestination, title: legacyName, standards: legacyStandards }),
    z.strictObject({ type: z.literal('reorderGoals'), mainlineId: z.uuid(), id: z.uuid(), direction: z.enum(['up', 'down']), targetId: z.uuid().optional() }),
  ]),
})
export const storedPlanningEnvelopeSchema = z.union([planningEnvelopeSchema, legacyGoalEnvelope])
export type StoredPlanningEnvelope = z.infer<typeof storedPlanningEnvelopeSchema>
