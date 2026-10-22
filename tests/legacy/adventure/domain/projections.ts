import { commandSchema, type AdventureCommand } from "./commands";
import { validateCommand } from "./preconditions";
import type { AdventureState, CycleMonth, Task } from "./model";
import { executeCommand } from "./engine";
import { add, cmp, DomainError, fail } from "./dates";
import { cycleById, cycleMonth, queryTasks } from "./schedule";

/** UI-only forecast context; no preview can be submitted as a persisted state. */
const context = (today: string) => ({
  today,
  now: `${today}T00:00:00+08:00`,
  idFactory: () => "preview-only-id",
});

export function commandCapability(
  state: AdventureState,
  command: AdventureCommand,
  today: string,
): { allowed: boolean; reason?: string; code?: string } {
  try {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) fail("命令字段无效");
    validateCommand(state, parsed.data, today);
    return { allowed: true };
  } catch (error) {
    if (error instanceof DomainError)
      return { allowed: false, reason: error.message, code: error.code };
    throw error;
  }
}

export function taskCapabilities(
  state: AdventureState,
  task: Task,
  today: string,
) {
  const allowed = (command: AdventureCommand) =>
    commandCapability(state, command, today).allowed;
  return {
    edit: allowed({
      type: "editTask",
      id: task.id,
      title: task.title,
      date: task.date,
      checklist: task.checklist.map((v) => v.text),
    }),
    complete:
      !task.completedOn && allowed({ type: "completeTask", id: task.id }),
    undo: !!task.completedOn && allowed({ type: "undoTask", id: task.id }),
    checklist:
      task.checklist.length > 0 &&
      allowed({
        type: "toggleChecklist",
        id: task.id,
        index: 0,
        done: !task.checklist[0].done,
      }),
    reschedule: allowed({ type: "rescheduleTask", id: task.id, date: today }),
  };
}

type EditCycleCommand = Extract<AdventureCommand, { type: "editCycle" }>;
type ForecastSlice = { tasks: Task[]; month: CycleMonth };
/** Uses the same reducer as a real command, against an isolated clone, and picks the first affected month. */
export function forecastCycleChange(
  state: AdventureState,
  command: EditCycleCommand,
  today: string,
  range?: { from: string; to: string },
): { before: ForecastSlice; after: ForecastSlice } {
  const cycle = cycleById(state, command.id);
  const changed = executeCommand(state, command, context(today)).state;
  let index = cycle.monthsSettled;
  while (
    cmp(cycleMonth(state, cycle.id, index, today).end, command.effectiveFrom) <=
    0
  )
    index++;
  const from = range?.from ?? command.effectiveFrom,
    to = range?.to ?? add(from, 30);
  if (cmp(from, to) > 0) fail("预览日期范围无效");
  const tasks = (input: AdventureState) =>
    queryTasks(input, from, to).filter(
      (t) => t.cycleId === cycle.id && !t.stopped && !t.rescheduledTo,
    );
  return {
    before: {
      tasks: tasks(state),
      month: cycleMonth(state, cycle.id, index, today),
    },
    after: {
      tasks: tasks(changed),
      month: cycleMonth(changed, cycle.id, index, today),
    },
  };
}
