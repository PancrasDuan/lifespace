import { z } from 'zod'

const version = z.number().int().nonnegative().safe()
const name = z.string().trim().min(1).max(200)
const standards = z.array(z.string().trim().max(4000)).min(1).max(50)
  .transform(values => values.filter(Boolean))
  .pipe(z.array(z.string().min(1)).min(1).max(50))
export const planningCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('createMainline'), name }),
  z.strictObject({ type: z.literal('renameMainline'), id: z.uuid(), name }),
  z.strictObject({ type: z.literal('createGoal'), destination: z.union([z.literal(''), z.literal('independent'), z.uuid()]), title: name, standards }),
  z.strictObject({ type: z.literal('createTask'), title: name, description: z.string().trim().max(4000), plannedOn: z.iso.date(), destination: z.union([z.literal(''), z.uuid()]) }),
  z.strictObject({ type: z.literal('editTask'), id: z.uuid(), title: name, description: z.string().trim().max(4000) }),
  z.strictObject({ type: z.literal('completeTask'), id: z.uuid() }),
  z.strictObject({ type: z.literal('cancelTaskCompletion'), completionId: z.uuid() }),
  z.strictObject({ type: z.literal('editGoal'), id: z.uuid(), destination: z.union([z.literal(''), z.literal('independent'), z.uuid()]), title: name, standards }),
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
export const growthSchema = z.object({
  level: version, totalXp: version, progress: version,
  needed: version, remaining: version, actions: version, achievedGoals: version,
  achievements: z.array(z.object({ id: z.string(), label: z.string(), threshold: version, count: version, unlocked: z.boolean() })).max(7).default([]),
})
const rewardAmount = version.refine(value => value > 0)
export const taskRewardSchema = z.object({
  amount: rewardAmount,
  calculation: z.object({ type: z.literal('fixed_task'), completionId: z.uuid(), count: rewardAmount, coefficient: rewardAmount }),
})
// Contract for the later goal-achievement slice; no achievement command is exposed here.
export const goalRewardSchema = z.object({
  amount: rewardAmount,
  calculation: z.object({
    type: z.literal('goal_actions'), actionIds: z.array(z.uuid()), count: version,
    coefficient: z.number().int().min(1).max(3), fallback: z.boolean(),
  }).refine(value => value.count === value.actionIds.length && new Set(value.actionIds).size === value.count
    && value.fallback === (value.count === 0)),
})
export const taskRangeSchema = z.enum(['today', 'future', 'past'])
export type TaskRange = z.infer<typeof taskRangeSchema>
export const planningTaskSchema = z.object({
  id: z.uuid(), title: z.string(), description: z.string(), plannedOn: z.iso.date(),
  status: z.enum(['pending', 'completed', 'ended']), completedOn: z.iso.date().nullable(), completionId: z.uuid().nullable(), reward: taskRewardSchema.nullable(),
  goalId: z.uuid().nullable(), goalTitle: z.string().nullable(), mainlineName: z.string(), independent: z.boolean(), overdue: z.boolean(), capabilities,
})
export type PlanningTask = z.infer<typeof planningTaskSchema>
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
    id: z.uuid(), title: z.string(), standards: z.array(z.string()).min(1).max(50),
    mainlineId: z.uuid(), mainlineName: z.string(), independent: z.boolean(),
    createdAt: z.string(), capabilities,
  })).max(50),
  destinations: z.array(z.object({ id: z.string(), name: z.string() })).max(6),
  growth: growthSchema,
  tasks: z.array(planningTaskSchema).max(50).default([]), totalTasks: version.default(0),
  taskPage: z.number().int().positive().default(1), taskRange: taskRangeSchema.default('today'),
  capabilities,
  limits: z.object({ name: z.literal(200), standard: z.literal(4000), standards: z.literal(50) }),
})
export type PlanningPage = z.infer<typeof planningPageSchema>
export type PlanningGoal = PlanningPage['goals'][number]
export const planningReceiptSchema = z.object({
  version,
  result: z.object({ entityId: z.uuid(), message: z.string(),
    completionId: z.uuid().nullable().optional(), reward: taskRewardSchema.nullable().optional(),
    growthChange: z.object({ xpDelta: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), before: growthSchema, after: growthSchema, unlocked: z.array(z.string()), lost: z.array(z.string()) }).optional(),
  }),
})
const previewBase = { version, today: z.iso.date(), allowed: z.literal(true), message: z.string() }
export const planningPreviewSchema = z.discriminatedUnion('requiresConfirmation', [
  z.object({ ...previewBase, requiresConfirmation: z.literal(false) }),
  z.object({ ...previewBase, requiresConfirmation: z.literal(true), completionId: z.uuid(), reward: taskRewardSchema, growthBefore: growthSchema, growthAfter: growthSchema }),
])

export type PlanningPreview = z.infer<typeof planningPreviewSchema>
