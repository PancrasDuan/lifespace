import { z } from 'zod'

const version = z.number().int().nonnegative().safe()
const name = z.string().trim().min(1).max(200)
const standard = z.string().trim().min(1).max(4000)
export const planningCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('createMainline'), name }),
  z.strictObject({ type: z.literal('renameMainline'), id: z.uuid(), name }),
  z.strictObject({ type: z.literal('createGoal'), destination: z.union([z.literal('independent'), z.uuid()]), title: name, standard }),
  z.strictObject({ type: z.literal('editGoal'), id: z.uuid(), title: name, standard }),
])
export type PlanningCommand = z.infer<typeof planningCommandSchema>
export const planningEnvelopeSchema = z.strictObject({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  expectedVersion: version,
  command: planningCommandSchema,
})
export type PlanningEnvelope = z.infer<typeof planningEnvelopeSchema>
export const planningPreviewInputSchema = planningEnvelopeSchema.omit({ requestId: true })
export const capabilitySchema = z.object({ allowed: z.boolean(), reason: z.string().optional() })
const capabilities = z.record(z.string(), capabilitySchema)
export const planningPageSchema = z.object({
  version,
  today: z.iso.date(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
  totalGoals: version,
  mainlines: z.array(z.object({
    id: z.uuid(), name: z.string(), capabilities,
  })).max(5),
  goals: z.array(z.object({
    id: z.uuid(), title: z.string(), standard: z.string(),
    mainlineId: z.uuid(), mainlineName: z.string(), independent: z.boolean(),
    createdAt: z.string(), capabilities,
  })).max(50),
  destinations: z.array(z.object({ id: z.string(), name: z.string() })).max(6),
  growth: z.object({
    level: version, totalXp: version, progress: version,
    needed: version, remaining: version, actions: version, achievedGoals: version,
  }),
  capabilities,
  limits: z.object({ name: z.literal(200), standard: z.literal(4000) }),
})
export type PlanningPage = z.infer<typeof planningPageSchema>
export type PlanningGoal = PlanningPage['goals'][number]
export const planningReceiptSchema = z.object({
  version,
  result: z.object({ entityId: z.uuid(), message: z.string() }),
})
export const planningPreviewSchema = z.object({
  version, today: z.iso.date(), allowed: z.literal(true),
  message: z.string(), requiresConfirmation: z.literal(false),
})
