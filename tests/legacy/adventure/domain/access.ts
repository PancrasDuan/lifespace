import type { AdventureState, Cycle, Task } from "./model";
import { cmp, day, fail } from "./dates";
import { cycleById, planned, virtualTask } from "./schedule";

/** Shared read-only access rules. These never materialize slots or inspect the growth ledger. */
export const cycleHasEnded = (cycle: Cycle, today: string) => {
  const last = cycle.rules[cycle.rules.length - 1];
  return (
    cycle.status === "ended" || (!!last.endDate && cmp(last.endDate, today) < 0)
  );
};
export function createAccess(state: AdventureState, today: string) {
  const container = (id: string) =>
    state.containers.find((v) => v.id === id) ??
    fail("主线或支线不存在", "NOT_FOUND");
  const goal = (id: string) =>
    state.goals.find((v) => v.id === id) ?? fail("目标不存在", "NOT_FOUND");
  const writableContainer = (id: string) => {
    const owner = container(id);
    if (owner.archived || owner.convertedTo) fail("归档来源只读");
    return owner;
  };
  const writableGoal = (id: string) => {
    const item = goal(id);
    writableContainer(item.containerId);
    if (item.archived || item.completion) fail("目标已停止推进");
    return item;
  };
  const task = (id: string): Task => {
    const stored = state.tasks.find((v) => v.id === id);
    if (stored) return stored;
    const at = id.lastIndexOf("@");
    if (at > 0) {
      const cycle = state.cycles.find((v) => v.id === id.slice(0, at)),
        date = id.slice(at + 1);
      if (cycle && planned(cycle, date)) return virtualTask(cycle, date);
    }
    return fail("任务不存在", "NOT_FOUND");
  };
  const writableCycle = (id: string) => {
    const cycle = cycleById(state, id),
      item = goal(cycle.goalId);
    writableContainer(item.containerId);
    if (item.archived || cycleHasEnded(cycle, today)) fail("周期已停止推进");
    return cycle;
  };
  const taskOwner = (item: Task, allowPaused = false) => {
    const parent = goal(item.goalId);
    writableContainer(parent.containerId);
    if (parent.archived || (parent.completion && !item.cycleId))
      fail("目标已停止推进");
    if (item.cycleId) {
      const cycle = writableCycle(item.cycleId);
      if (cycle.status !== "running" && !allowPaused) fail("周期已暂停");
    }
    return parent;
  };
  const editableTask = (id: string, allowPaused = false) => {
    const item = task(id);
    taskOwner(item, allowPaused);
    if (item.stopped || item.rescheduledTo) fail("任务已停止");
    if (item.settled || cmp(item.date, today) < 0) fail("过去任务只读");
    return item;
  };
  const future = (date: string) => {
    day(date);
    if (cmp(date, today) < 0) fail("只能安排今天或未来");
  };
  const nameAvailable = (name: string, exclude?: string) => {
    if (
      state.containers.some(
        (v) => v.kind === "main" && v.name === name && v.id !== exclude,
      )
    )
      fail("主线名称已存在");
  };
  const activeSideCount = () =>
    state.containers.filter(
      (v) =>
        v.kind === "side" &&
        !v.archived &&
        !v.convertedTo &&
        !state.goals.some((g) => g.containerId === v.id && g.completion),
    ).length;
  const focusCount = (containerId: string, exclude?: string) =>
    state.goals.filter(
      (g) =>
        g.containerId === containerId &&
        g.id !== exclude &&
        g.focused &&
        !g.archived &&
        !g.completion,
    ).length;
  return {
    container,
    goal,
    writableContainer,
    writableGoal,
    task,
    writableCycle,
    taskOwner,
    editableTask,
    future,
    nameAvailable,
    activeSideCount,
    focusCount,
  };
}
