import { z } from 'zod'

const version = z.number().int().nonnegative().safe()
const name = z.string().trim().min(1).max(200)
const categoryLabel = z.string().trim().refine(value => [...value].length <= 200).nullable().optional()
const standards = z.array(z.string().trim().max(4000)).min(1).max(50)
  .transform(values => values.filter(Boolean))
  .pipe(z.array(z.string().min(1)).min(1).max(50))
export const planningCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('createMainline'), name }),
  z.strictObject({ type: z.literal('renameMainline'), id: z.uuid(), name }),
  z.strictObject({ type: z.literal('endMainline'), id: z.uuid() }),
  z.strictObject({ type: z.literal('createGoal'), title: name, standards, categoryLabel }),
  z.strictObject({ type: z.literal('createTask'), title: name, description: z.string().trim().max(4000), plannedOn: z.iso.date(), destination: z.union([z.literal(''), z.uuid()]) }),
  // Retired command shapes remain parseable only for historical successful-request replay.
  z.strictObject({ type: z.literal('rescheduleTask'), id: z.uuid(), plannedOn: z.iso.date() }),
  z.strictObject({ type: z.literal('editTask'), id: z.uuid(), title: name, description: z.string().trim().max(4000), plannedOn: z.iso.date().optional(), destination: z.union([z.literal(''), z.uuid()]).optional() }),
  z.strictObject({ type: z.literal('migrateTask'), id: z.uuid(), destination: z.union([z.literal(''), z.uuid()]) }),
  z.strictObject({ type: z.literal('endTask'), id: z.uuid() }),
  z.strictObject({ type: z.literal('deleteTask'), id: z.uuid() }),
  z.strictObject({ type: z.literal('migrateGoal'), id: z.uuid(), destination: z.union([z.literal(''), z.literal('independent'), z.uuid()]) }),
  z.strictObject({ type: z.literal('completeTask'), id: z.uuid() }),
  z.strictObject({ type: z.literal('cancelTaskCompletion'), completionId: z.uuid() }),
  z.strictObject({ type: z.literal('editGoal'), id: z.uuid(), title: name, standards, categoryLabel }),
  z.strictObject({ type: z.literal('achieveGoal'), id: z.uuid(), coefficient: z.number().int().min(1).max(3).default(1), reflection: z.string().trim().max(4000).default('') }),
  z.strictObject({ type: z.literal('endGoal'), id: z.uuid() }),
  z.strictObject({ type: z.literal('focusGoal'), id: z.uuid(), focused: z.boolean() }),
  z.strictObject({ type: z.literal('reorderGoals'), direction: z.enum(['up', 'down']), id: z.uuid(), targetId: z.uuid().optional() }),
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
export const achievementSchema = z.object({ id: z.string(), label: z.string(), threshold: version, count: version, remaining: version.optional(), unlocked: z.boolean() })
export const growthSchema = z.object({
  level: version, totalXp: version, progress: version,
  needed: version, remaining: version, actions: version, achievedGoals: version,
  achievements: z.array(achievementSchema).max(7).default([]),
})
const rewardAmount = version.refine(value => value > 0)
export const taskRewardSchema = z.object({
  amount: rewardAmount,
  calculation: z.object({ type: z.literal('fixed_task'), completionId: z.uuid(), count: rewardAmount, coefficient: rewardAmount }),
})
export const goalRewardSchema = z.object({
  amount: rewardAmount,
  calculation: z.object({
    type: z.literal('goal_actions'), actionIds: z.array(z.uuid()), count: version,
    coefficient: z.number().int().min(1).max(3), fallback: z.boolean(),
  }).refine(value => value.count === value.actionIds.length && new Set(value.actionIds).size === value.count
    && value.fallback === (value.count === 0)),
})
export const taskRangeSchema = z.enum(['today', 'future', 'past'])
export const taskScopeSchema = z.enum(['all', 'focus'])
export type TaskScope = z.infer<typeof taskScopeSchema>
export const planningSearchSchema = z.string().trim().max(100)
export type TaskRange = z.infer<typeof taskRangeSchema>
export const planningProgressSchema = z.object({ completed: version, total: version, ratio: z.number().min(0).max(1).nullable() })
export const taskArrangementSchema = z.object({
  id: z.uuid(), kind: z.enum(['task_created', 'task_rescheduled']), sourceEventId: z.uuid().nullable(),
  oldPlannedOn: z.iso.date().nullable(), newPlannedOn: z.iso.date(), occurredAt: z.string(),
  title: z.string(), description: z.string(), goalId: z.uuid().nullable(), goalTitle: z.string().nullable(),
})
export const taskHistorySchema = z.object({
  version, taskId: z.uuid(), title: z.string(), page: z.number().int().positive(), pageSize: z.literal(5), total: version,
  items: z.array(taskArrangementSchema).max(5),
})
export type TaskHistory = z.infer<typeof taskHistorySchema>
export const planningTaskSchema = z.object({
  id: z.uuid(), title: z.string(), description: z.string(), plannedOn: z.iso.date(),
  rescheduleMin: z.iso.date().optional(), arrangements: z.array(taskArrangementSchema.pick({ id: true, kind: true, sourceEventId: true, oldPlannedOn: true, newPlannedOn: true, occurredAt: true })).max(5).default([]), totalArrangements: version.default(0),
  status: z.enum(['pending', 'completed', 'ended']), completedOn: z.iso.date().nullable(), completionId: z.uuid().nullable(), reward: taskRewardSchema.nullable(),
  completionOrigin: z.object({ goalId: z.uuid().nullable(), goalTitle: z.string().nullable(), categoryLabel: z.string().nullable(), title: z.string(), description: z.string(), plannedOn: z.iso.date(), occurredOn: z.iso.date() }).nullable().default(null),
  goalId: z.uuid().nullable(), goalTitle: z.string().nullable(), independent: z.boolean(), overdue: z.boolean(), progress: planningProgressSchema, capabilities,
})
export type PlanningTask = z.infer<typeof planningTaskSchema>
export const planningGoalSchema = z.object({
    id: z.uuid(), title: z.string(), standards: z.array(z.string()).min(1).max(50),
    categoryLabel: z.string().nullable(), focused: z.boolean(), sortOrder: version,
    status: z.enum(['active', 'achieved', 'ended']).default('active'), terminatedAt: z.string().nullable().default(null),
    achievement: z.object({ id: z.uuid(), occurredOn: z.iso.date(), reflection: z.string(), reward: goalRewardSchema }).nullable().default(null),
    createdAt: z.string(), progress: planningProgressSchema, capabilities,
  })
export const planningPageSchema = z.object({
  version,
  today: z.iso.date(),
  includeTerminal: z.boolean().default(false),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
  totalGoals: version,
  goals: z.array(planningGoalSchema).max(50),
  goalDetail: z.object({ goal: planningGoalSchema, tasks: z.array(planningTaskSchema).max(50), taskPage: z.number().int().positive(), totalTasks: version,
    relatedTasks: z.array(z.object({ id: z.uuid(), title: z.string(), plannedOn: z.iso.date(), completedAt: z.string().nullable() })).max(50), totalRelatedTasks: version,
  }).nullable().default(null),
  growth: growthSchema,
  tasks: z.array(planningTaskSchema).max(50).default([]), totalTasks: version.default(0),
  taskPage: z.number().int().positive().default(1), taskRange: taskRangeSchema.default('today'), taskScope: taskScopeSchema.default('all'), search: z.string().default(''), taskProgress: planningProgressSchema, todayTaskProgress: planningProgressSchema.default({ completed: 0, total: 0, ratio: null }),
  capabilities,
  limits: z.object({ name: z.literal(200), standard: z.literal(4000), standards: z.literal(50) }),
})
export type PlanningPage = z.infer<typeof planningPageSchema>
export type PlanningGoal = PlanningPage['goals'][number]
// PostgreSQL UUIDs are case-insensitive; Zod accepts uppercase UUIDs except
// the all-F max value. Normalize that value only, preserving other text.
const receiptUuid = z.string().transform(value => value.toLowerCase() === 'ffffffff-ffff-ffff-ffff-ffffffffffff' ? value.toLowerCase() : value).pipe(z.uuid())
const receiptTaskReward = taskRewardSchema.extend({ calculation: taskRewardSchema.shape.calculation.extend({ completionId: receiptUuid }) })
const receiptGoalReward = goalRewardSchema.extend({ calculation: goalRewardSchema.shape.calculation.safeExtend({ actionIds: z.array(receiptUuid) }) })
export const planningReceiptSchema = z.object({
  version,
  result: z.object({ entityId: receiptUuid, message: z.string(),
    completionId: receiptUuid.nullable().optional(), reward: z.union([receiptTaskReward, receiptGoalReward]).nullable().optional(), achievementId: receiptUuid.optional(),
    source: z.object({ goalId: receiptUuid.nullable().optional(), goalTitle: z.string().nullable().optional(), title: z.string().optional(), description: z.string().optional(), plannedOn: z.iso.date().optional(), occurredOn: z.iso.date().optional(), categoryLabel: z.string().nullable().optional() }).optional(),
    growthChange: z.object({ xpDelta: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), before: growthSchema, after: growthSchema, unlocked: z.array(z.string()), lost: z.array(z.string()) }).optional(),
  }),
})
const previewBase = { version, today: z.iso.date(), allowed: z.literal(true), message: z.string() }
export const lifecyclePreviewSchema = z.object({
  ...previewBase, requiresConfirmation: z.literal(true),
  operation: z.enum(['endGoal', 'deleteTask']), entityId: z.uuid(), title: z.string(),
  stoppingGoals: z.array(z.object({ id: z.uuid(), title: z.string() })).default([]),
  stoppingTasks: z.array(z.object({ id: z.uuid(), title: z.string(), plannedOn: z.iso.date() })).default([]),
  preservedCompletedTasks: version, preservedAchievedGoals: version,
  historicalArrangements: version.optional(),
  goalId: z.uuid().nullable().optional(), plannedOn: z.iso.date().optional(),
})
export type LifecyclePreview = z.infer<typeof lifecyclePreviewSchema>
export const goalAchievementPreviewSchema = z.object({ ...previewBase, requiresConfirmation: z.literal(true), operation: z.literal('achieveGoal'),
  goalId: z.uuid(), title: z.string(), standards: z.array(z.string()), rewards: z.array(goalRewardSchema).length(3),
  stoppingTasks: z.array(z.object({ id: z.uuid(), title: z.string(), plannedOn: z.iso.date() })),
})
export type GoalAchievementPreview = z.infer<typeof goalAchievementPreviewSchema>
export const reschedulePreviewSchema = z.object({
  ...previewBase, requiresConfirmation: z.literal(true), operation: z.literal('rescheduleTask'),
  taskId: z.uuid(), title: z.string(), oldPlannedOn: z.iso.date(), newPlannedOn: z.iso.date(),
  sourceEventId: z.uuid(),
})
export type ReschedulePreview = z.infer<typeof reschedulePreviewSchema>
export const planningPreviewSchema = z.union([
  reschedulePreviewSchema,
  lifecyclePreviewSchema,
  goalAchievementPreviewSchema,
  z.object({ ...previewBase, requiresConfirmation: z.literal(false) }),
  z.object({ ...previewBase, requiresConfirmation: z.literal(true), completionId: z.uuid(), reward: taskRewardSchema, growthBefore: growthSchema, growthAfter: growthSchema }),
])

export type PlanningPreview = z.infer<typeof planningPreviewSchema>

export type PlanningQuery = { page: number; taskRange: TaskRange; taskPage: number; taskScope: TaskScope; search: string; goalId?: string; goalTaskPage: number; includeTerminal: boolean }

export const migrationOptionsSchema = z.object({
  version, kind: z.literal('task'), entityId: z.uuid(), page: z.number().int().positive(), pageSize: z.literal(20), total: version,
  options: z.array(z.object({ id: z.union([z.literal(''), z.uuid()]), name: z.string(), capability: capabilitySchema })).max(20),
})
export type MigrationOptions = z.infer<typeof migrationOptionsSchema>


export const taskListInputSchema = z.strictObject({
  date: z.iso.date(), scope: taskScopeSchema.default('all'), expectedVersion: version,
  today: z.iso.date(), page: z.number().int().min(1).max(1_000_000).default(1),
})
export type TaskListInput = z.infer<typeof taskListInputSchema>
export const taskListSchema = z.object({
  version, today: z.iso.date(), date: z.iso.date(), scope: taskScopeSchema,
  page: z.number().int().positive(), pageSize: z.literal(10), total: version,
  tasks: z.array(planningTaskSchema).max(10), progress: planningProgressSchema,
})
export type TaskList = z.infer<typeof taskListSchema>
