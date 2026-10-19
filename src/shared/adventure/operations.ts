import type {
  AdventureState,
  Context,
  CommandResult,
  Task,
  TaskSnapshot,
  LedgerEntry,
} from "./model";
import { day, cmp, fail } from "./dates";
import { cycleById, planned, virtualTask } from "./schedule";
export function createOperations(
  s: AdventureState,
  ctx: Context,
  result: CommandResult,
) {
  const id = () => ctx.idFactory?.() ?? crypto.randomUUID();
  const container = (key: string) =>
    s.containers.find((v) => v.id === key) ??
    fail("主线或支线不存在", "NOT_FOUND");
  const goal = (key: string) =>
    s.goals.find((v) => v.id === key) ?? fail("目标不存在", "NOT_FOUND");
  const writableContainer = (key: string) => {
    const v = container(key);
    if (v.archived || v.convertedTo) fail("归档来源只读");
    return v;
  };
  const writableGoal = (key: string) => {
    const g = goal(key);
    writableContainer(g.containerId);
    if (g.archived || g.completion) fail("目标已停止推进");
    return g;
  };
  const task = (key: string) => {
    let t = s.tasks.find((v) => v.id === key);
    if (t) return t;
    const at = key.lastIndexOf("@");
    if (at > 0) {
      const cy = s.cycles.find((v) => v.id === key.slice(0, at)),
        date = key.slice(at + 1);
      if (cy && planned(cy, date)) {
        t = virtualTask(cy, date);
        s.tasks.push(t);
        return t;
      }
    }
    return fail("任务不存在", "NOT_FOUND");
  };
  const writableCycle = (key: string) => {
    const cy = cycleById(s, key),
      g = goal(cy.goalId);
    writableContainer(g.containerId);
    if (g.archived || cy.status === "ended") fail("周期已停止推进");
    return cy;
  };
  const taskOwner = (t: Task, allowPaused = false) => {
    const g = goal(t.goalId);
    writableContainer(g.containerId);
    if (g.archived || (g.completion && !t.cycleId)) fail("目标已停止推进");
    if (t.cycleId) {
      const cy = writableCycle(t.cycleId);
      if (cy.status !== "running" && !allowPaused) fail("周期已暂停");
    }
    return g;
  };
  const editableTask = (key: string, allowPaused = false) => {
    const t = task(key);
    taskOwner(t, allowPaused);
    if (t.stopped || t.rescheduledTo) fail("任务已停止");
    if (t.settled || cmp(t.date, ctx.today) < 0) fail("过去任务只读");
    return t;
  };
  const future = (date: string) => {
    day(date);
    if (cmp(date, ctx.today) < 0) fail("只能安排今天或未来");
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
  const nameAvailable = (name: string, exclude?: string) => {
    if (
      s.containers.some(
        (v) => v.kind === "main" && v.name === name && v.id !== exclude,
      )
    )
      fail("主线名称已存在");
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
