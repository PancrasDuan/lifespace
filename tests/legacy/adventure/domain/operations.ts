import type {
  AdventureState,
  Context,
  CommandResult,
  Task,
  TaskSnapshot,
  LedgerEntry,
} from "./model";
import { createAccess } from "./access";
export function createOperations(
  s: AdventureState,
  ctx: Context,
  result: CommandResult,
) {
  const id = () => ctx.idFactory?.() ?? crypto.randomUUID();
  const access = createAccess(s, ctx.today);
  const {
    container,
    goal,
    writableContainer,
    writableGoal,
    writableCycle,
    taskOwner,
    future,
    nameAvailable,
  } = access;
  const task = (key: string) => {
    const item = access.task(key);
    if (!s.tasks.some((stored) => stored.id === item.id)) s.tasks.push(item);
    return item;
  };
  const editableTask = (key: string, allowPaused = false) => {
    task(key);
    return access.editableTask(key, allowPaused);
  };
  const snapshot = (t: Task): TaskSnapshot => {
    const g = goal(t.goalId),
      v = container(g.containerId);
    return {
      taskId: t.id,
      actionId: t.actionId,
      goalId: g.id,
      goalTitle: g.title,
      standard: g.standard,
      containerId: v.id,
      containerName: v.name,
      containerKind: v.kind,
      title: t.title,
      date: t.date,
      cycleId: t.cycleId,
      slotDate: t.slotDate,
      sourceTaskId: t.sourceTaskId,
      extra: t.extra,
    };
  };
  const record = (e: LedgerEntry) => {
    if (s.ledger.some((x) => x.id === e.id)) return;
    s.ledger.push(e);
    result.reward += e.amount;
    result.ledgerIds.push(e.id);
  };

  return {
    s,
    ctx,
    result,
    id,
    container,
    goal,
    writableContainer,
    writableGoal,
    task,
    writableCycle,
    taskOwner,
    editableTask,
    future,
    snapshot,
    record,
    nameAvailable,
  };
}
export type Operations = ReturnType<typeof createOperations>;
