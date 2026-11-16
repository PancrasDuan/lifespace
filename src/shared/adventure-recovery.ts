import { z } from 'zod'
import { planningEnvelopeSchema, type PlanningEnvelope } from './adventure-planning'

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

const retryableTypes = new Set([
  'createGoal', 'editGoal', 'reorderGoals', 'endGoal', 'achieveGoal',
  'createTask', 'editTask', 'completeTask', 'cancelTaskCompletion', 'deleteTask',
  'createRecurringTask', 'editRecurringTask', 'recordRecurringCompletion',
  'cancelRecurringCompletion', 'endRecurringTask', 'deleteRecurringTask',
])
export function canRetryPlanningEnvelope(envelope: StoredPlanningEnvelope): envelope is PlanningEnvelope {
  if (!planningEnvelopeSchema.safeParse(envelope).success || !retryableTypes.has(envelope.command.type)) return false
  // These fields were optional in historical edits, but are mandatory in the
  // current task model. Never fill them in using today's page.
  return envelope.command.type !== 'editTask' || (envelope.command.plannedOn !== undefined && envelope.command.destination !== undefined)
}
