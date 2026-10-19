import { z } from "zod";
const id = z.string().min(1).max(180);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const title = z.string().trim().min(1).max(200);
const checklist = z.array(z.string().trim().min(1).max(300)).max(50);
const cadence = z.enum(["daily", "weekly"]);
const weekdays = z.array(z.number().int().min(1).max(7)).max(7);
const rule = { cadence, weekdays, endDate: date.optional() };
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("createContainer"),
    kind: z.enum(["main", "side"]),
    name: title,
  }),
  z.strictObject({ type: z.literal("editContainer"), id, name: title }),
  z.strictObject({
    type: z.literal("createGoal"),
    containerId: id,
    title,
    standard: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    type: z.literal("editGoal"),
    id,
    title,
    standard: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({ type: z.literal("focusGoal"), id, focused: z.boolean() }),
  z.strictObject({
    type: z.literal("reorderGoals"),
    containerId: id,
    goalIds: z.array(id).max(1000),
  }),
  z.strictObject({
    type: z.literal("migrateSide"),
    id,
    targetContainerId: id.optional(),
    newMainName: title.optional(),
  }),
  z.strictObject({
    type: z.literal("archive"),
    kind: z.enum(["container", "goal"]),
    id,
  }),
  z.strictObject({
    type: z.literal("createTask"),
    goalId: id,
    title,
    date,
    checklist,
  }),
  z.strictObject({ type: z.literal("editTask"), id, title, date, checklist }),
  z.strictObject({
    type: z.literal("toggleChecklist"),
    id,
    index: z.number().int().min(0).max(49),
    done: z.boolean(),
  }),
  z.strictObject({ type: z.literal("completeTask"), id }),
  z.strictObject({ type: z.literal("undoTask"), id }),
  z.strictObject({ type: z.literal("rescheduleTask"), id, date }),
  z.strictObject({
    type: z.literal("extraComplete"),
    cycleId: id,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    type: z.literal("createCycle"),
    goalId: id,
    title,
    startDate: date,
    checklist,
    ...rule,
  }),
  z.strictObject({ type: z.literal("pauseCycle"), id }),
  z.strictObject({ type: z.literal("resumeCycle"), id }),
  z.strictObject({ type: z.literal("endCycle"), id }),
  z.strictObject({
    type: z.literal("editCycle"),
    id,
    effectiveFrom: date,
    ...rule,
  }),
  z.strictObject({
    type: z.literal("completeGoal"),
    id,
    confirmed: z.literal(true),
    coefficient: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    reflection: z.string().max(3000).optional(),
    cycleChoices: z.record(z.string(), z.enum(["continue", "end"])),
  }),
  z.strictObject({ type: z.literal("undoGoal"), id }),
  z.strictObject({ type: z.literal("refresh") }),
]);
export type AdventureCommand = z.infer<typeof commandSchema>;
