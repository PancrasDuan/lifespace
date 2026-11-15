import { z } from 'zod'
import {
  capabilitySchema, planningProgressSchema, planningSearchSchema, planningTaskSchema,
  recurringCountSchema, recurringDateSchema, recurringPeriodTypeSchema, taskRewardSchema, taskScopeSchema,
} from './adventure-planning'

const count = z.number().int().nonnegative().safe()
const page = z.number().int().min(1).max(1_000_000)
const identity = { goalId: z.uuid().nullable(), goalTitle: z.string().nullable(), categoryLabel: z.string().nullable() }
export const recurringReadBasisSchema = z.strictObject({ expectedVersion: count, today: recurringDateSchema })
const readBasis = recurringReadBasisSchema.shape
export const recurringListInputSchema = z.strictObject({
  ...readBasis, date: recurringDateSchema, scope: taskScopeSchema.default('all'),
  search: planningSearchSchema.default(''), page: page.default(1),
})
export type RecurringListInput = z.infer<typeof recurringListInputSchema>
export const recurringDetailInputSchema = z.strictObject({ ...readBasis, id: z.uuid() })
export type RecurringDetailInput = z.infer<typeof recurringDetailInputSchema>
export const recurringChildrenInputSchema = z.strictObject({ ...readBasis, parentId: z.uuid(), page: page.default(1) })
export type RecurringChildrenInput = z.infer<typeof recurringChildrenInputSchema>
export const dateTaskListInputSchema = recurringListInputSchema
export type DateTaskListInput = z.infer<typeof dateTaskListInputSchema>

export const recurringPeriodSchema = z.object({
  number: recurringCountSchema, startOn: recurringDateSchema, endOn: recurringDateSchema,
  completed: count, required: recurringCountSchema, satisfied: z.boolean(), ratio: z.number().min(0).max(1),
}).refine(value => value.startOn <= value.endOn && value.satisfied === (value.completed >= value.required)
  && Math.abs(value.ratio - Math.min(1, value.completed / value.required)) < 1e-12)
export type RecurringPeriod = z.infer<typeof recurringPeriodSchema>
export const recurringParentSchema = z.object({
  kind: z.literal('recurring'), id: z.uuid(), title: z.string(), description: z.string(),
  periodType: recurringPeriodTypeSchema, startOn: recurringDateSchema, requiredCount: recurringCountSchema,
  status: z.enum(['not_started', 'active', 'ended']), endedAt: z.iso.datetime({ offset: true }).nullable(), endedOn: recurringDateSchema.nullable(),
  ...identity, independent: z.boolean(), completedPeriods: count,
  currentPeriod: recurringPeriodSchema.nullable(), effectiveChildren: count,
  capabilities: z.object({
    editRecurringTask: capabilitySchema, changeStartOn: capabilitySchema, changeDestination: capabilitySchema,
    recordRecurringCompletion: capabilitySchema, endRecurringTask: capabilitySchema, deleteRecurringTask: capabilitySchema,
  }),
}).refine(value => value.independent === (value.goalId === null)
  && (value.status === 'ended') === (value.endedAt !== null && value.endedOn !== null)
  && (value.status === 'ended' || (value.endedAt === null && value.endedOn === null))
  && (value.status !== 'not_started' || (value.currentPeriod === null && value.completedPeriods === 0 && value.effectiveChildren === 0))
  && (value.status === 'not_started' || value.currentPeriod !== null)
  && (value.currentPeriod === null || (value.currentPeriod.required === value.requiredCount && value.completedPeriods <= value.currentPeriod.number)))
export type RecurringParent = z.infer<typeof recurringParentSchema>

// Frozen at completion. No child-specific title/description/notes input exists.
export const recurringCompletionSnapshotSchema = z.object({
  parentId: z.uuid(), childId: z.uuid(), title: z.string(), description: z.string(),
  periodType: recurringPeriodTypeSchema, anchorOn: recurringDateSchema,
  periodNumber: recurringCountSchema, periodStartOn: recurringDateSchema, periodEndOn: recurringDateSchema,
  requiredCount: recurringCountSchema, occurredAt: z.iso.datetime({ offset: true }), occurredOn: recurringDateSchema,
  ...identity,
}).refine(value => value.anchorOn <= value.periodStartOn && value.periodStartOn <= value.occurredOn && value.occurredOn <= value.periodEndOn)
export type RecurringCompletionSnapshot = z.infer<typeof recurringCompletionSnapshotSchema>
export const recurringChildSchema = z.object({
  kind: z.literal('recurring_child'), id: z.uuid(), parentId: z.uuid(), completionId: z.uuid(),
  status: z.enum(['completed', 'cancelled']), invalidatedAt: z.iso.datetime({ offset: true }).nullable(),
  snapshot: recurringCompletionSnapshotSchema,
  reward: taskRewardSchema.refine(value => value.amount === 1 && value.calculation.count === 1 && value.calculation.coefficient === 1),
  capabilities: z.object({ cancelRecurringCompletion: capabilitySchema }),
}).refine(value => value.id === value.snapshot.childId && value.parentId === value.snapshot.parentId
  && value.completionId === value.reward.calculation.completionId
  && (value.status === 'cancelled') === (value.invalidatedAt !== null)
  && (value.status !== 'cancelled' || !value.capabilities.cancelRecurringCompletion.allowed))
export type RecurringChild = z.infer<typeof recurringChildSchema>
const readContext = { version: count, today: recurringDateSchema, timeZone: z.literal('Asia/Shanghai') }
export const recurringListSchema = z.object({
  ...readContext, date: recurringDateSchema, scope: taskScopeSchema, search: planningSearchSchema,
  page, pageSize: z.literal(10), total: count, parents: z.array(recurringParentSchema).max(10),
})
export type RecurringList = z.infer<typeof recurringListSchema>
export const recurringParentDetailSchema = z.object({ ...readContext, parent: recurringParentSchema })
export type RecurringParentDetail = z.infer<typeof recurringParentDetailSchema>
export const recurringChildDetailSchema = z.object({ ...readContext, child: recurringChildSchema })
export type RecurringChildDetail = z.infer<typeof recurringChildDetailSchema>
export const recurringChildrenSchema = z.object({
  ...readContext, parentId: z.uuid(), page, pageSize: z.literal(10), total: count,
  children: z.array(recurringChildSchema).max(10),
}).refine(value => value.children.every(child => child.parentId === value.parentId && child.status === 'completed'))
export type RecurringChildren = z.infer<typeof recurringChildrenSchema>
// The once-only /tasks/list stays parseable. This replaces that read for the new UI.
export const dateTaskListSchema = z.object({
  ...readContext, date: recurringDateSchema, scope: taskScopeSchema, search: planningSearchSchema,
  page, pageSize: z.literal(10), total: count,
  tasks: z.array(z.union([planningTaskSchema.extend({ kind: z.literal('once') }), recurringChildSchema])).max(10),
  progress: planningProgressSchema,
}).refine(value => value.tasks.every(task => task.kind !== 'recurring_child' || task.status === 'completed'))
export type DateTaskList = z.infer<typeof dateTaskListSchema>

// Only these exact status/code pairs prove a FIRST new request did not commit.
export const recurringDefinitiveErrors = {
  PLANNING_DATE_CHANGED: 409, PERIOD_FULL: 400, RECURRING_NOT_STARTED: 400,
  RECURRING_ALREADY_STARTED: 400, RECURRING_START_PAST: 400, PENDING_RECURRING_TASKS: 400,
} as const
export const recurringErrorCodeSchema = z.enum(Object.keys(recurringDefinitiveErrors) as [keyof typeof recurringDefinitiveErrors, ...(keyof typeof recurringDefinitiveErrors)[]])
