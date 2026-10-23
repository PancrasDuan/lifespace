import type { AdventureCommand } from "./commands";
import type { AdventureState } from "./model";
import { createAccess, cycleHasEnded } from "./access";
import { cmp, day, fail } from "./dates";
import { ruleAt } from "./schedule";

/** Pure preconditions used by both capability projections and the authoritative command boundary. */
export function validateCommand(
  state: AdventureState,
  command: AdventureCommand,
  today: string,
): void {
  day(today);
  const {
    container,
    goal,
    writableContainer,
    writableGoal,
    task,
    writableCycle,
    editableTask,
    future,
    nameAvailable,
    activeSideCount,
    focusCount,
  } = createAccess(state, today);
  switch (command.type) {
    case "createContainer":
      if (command.kind === "main") {
        if (state.containers.filter((v) => v.kind === "main").length >= 5)
          fail("主线最多5条");
        nameAvailable(command.name);
      } else if (activeSideCount() >= 10) fail("在用支线最多10条");
      return;
    case "editContainer": {
      const owner = writableContainer(command.id);
      if (owner.kind === "main") nameAvailable(command.name, owner.id);
      return;
    }
    case "createGoal": {
      const owner = writableContainer(command.containerId);
      if (
        owner.kind === "side" &&
        state.goals.some((g) => g.containerId === owner.id)
      )
        fail("支线最多1个目标");
      return;
    }
    case "editGoal":
      writableGoal(command.id);
      return;
    case "focusGoal": {
      const item = writableGoal(command.id);
      if (
        command.focused &&
        container(item.containerId).kind === "main" &&
        focusCount(item.containerId, item.id) >= 3
      )
        fail("每条主线最多聚焦3个目标");
      return;
    }
    case "reorderGoals": {
      const owner = writableContainer(command.containerId),
        items = state.goals.filter((g) => g.containerId === owner.id);
      if (
        owner.kind !== "main" ||
        new Set(command.goalIds).size !== items.length ||
        command.goalIds.length !== items.length ||
        items.some((g) => !command.goalIds.includes(g.id))
      )
        fail("只能排列同一主线的全部目标");
      return;
    }
    case "migrateSide": {
      const owner = writableContainer(command.id);
      if (owner.kind !== "side") fail("只有支线可升级迁移");
      const item = state.goals.find((g) => g.containerId === owner.id);
      if (item?.archived) fail("归档目标不能迁移");
      if (!!command.targetContainerId === !!command.newMainName)
        fail("选择迁入主线或新主线名称");
      if (command.targetContainerId) {
        const target = writableContainer(command.targetContainerId);
        if (target.kind !== "main" || !item) fail("请选择主线及支线目标");
        if (item.focused && focusCount(target.id) >= 3)
          fail("目标主线已聚焦3个，请先调整");
      } else {
        if (state.containers.filter((v) => v.kind === "main").length >= 5)
          fail("主线最多5条");
        nameAvailable(command.newMainName!);
      }
      return;
    }
    case "archive":
      if (command.kind === "container") writableContainer(command.id);
      else {
        const item = goal(command.id);
        writableContainer(item.containerId);
        if (item.archived) fail("目标已经归档");
      }
      return;
    case "createTask":
      writableGoal(command.goalId);
      future(command.date);
      return;
    case "editTask": {
      const item = editableTask(command.id);
      future(command.date);
      if (item.completedOn && command.date !== item.date)
        fail("先撤销完成再改期");
      return;
    }
    case "toggleChecklist": {
      const item = editableTask(command.id);
      if (item.date !== today) fail("只能执行当天任务");
      if (!item.checklist[command.index]) fail("清单步骤不存在");
      return;
    }
    case "completeTask": {
      const item = editableTask(command.id);
      if (item.date !== today) fail("只能完成当天任务");
      if (
        state.tasks.some(
          (other) =>
            other.actionId === item.actionId &&
            other.completedOn &&
            other.id !== item.id,
        )
      )
        fail("同一行动已经完成");
      return;
    }
    case "undoTask": {
      const item = editableTask(command.id, true);
      if (item.completedOn !== today) fail("只能撤销当天完成");
      if (goal(item.goalId).completion?.actionIds.includes(item.actionId))
        fail("请先撤销目标达成");
      return;
    }
    case "rescheduleTask": {
      const item = task(command.id);
      writableGoal(item.goalId);
      future(command.date);
      if (
        item.cycleId ||
        item.completedOn ||
        item.stopped ||
        cmp(item.date, today) >= 0
      )
        fail("只能重新安排过去漏做的一次性任务");
      if (
        item.rescheduledTo ||
        state.tasks.some(
          (other) =>
            other.actionId === item.actionId &&
            other.id !== item.id &&
            (other.completedOn || (!other.rescheduledTo && !other.stopped)),
        )
      )
        fail("同一行动已有后续安排或完成");
      return;
    }
    case "extraComplete": {
      const cycle = writableCycle(command.cycleId);
      if (cycle.status !== "running" || cmp(today, cycle.startDate) < 0)
        fail("周期尚未开始或暂停");
      const rule = ruleAt(cycle, today);
      if (rule?.endDate && cmp(today, rule.endDate) > 0) fail("周期已结束");
      return;
    }
    case "createCycle":
      writableGoal(command.goalId);
      future(command.startDate);
      if (command.endDate && cmp(command.endDate, command.startDate) < 0)
        fail("结束日期早于开始日期");
      if (command.cadence === "weekly" && !command.weekdays.length)
        fail("每周至少选择一天");
      return;
    case "pauseCycle":
      if (writableCycle(command.id).status !== "running") fail("周期已经暂停");
      return;
    case "resumeCycle": {
      const cycle = writableCycle(command.id);
      if (cycle.status !== "paused") fail("周期没有暂停");
      if (!cycle.pauses.some((p) => !p.end)) fail("暂停记录无效");
      return;
    }
    case "endCycle":
      writableCycle(command.id);
      return;
    case "editCycle": {
      const cycle = writableCycle(command.id);
      future(command.effectiveFrom);
      if (cmp(command.effectiveFrom, cycle.startDate) < 0)
        fail("新规则不得早于周期开始日");
      if (command.endDate && cmp(command.endDate, command.effectiveFrom) < 0)
        fail("结束日期早于生效日期");
      if (command.cadence === "weekly" && !command.weekdays.length)
        fail("每周至少选择一天");
      return;
    }
    case "completeGoal": {
      const item = writableGoal(command.id),
        cycles = state.cycles.filter(
          (c) => c.goalId === item.id && !cycleHasEnded(c, today),
        );
      if (
        Object.keys(command.cycleChoices).length !== cycles.length ||
        cycles.some((c) => !command.cycleChoices[c.id])
      )
        fail("请逐项选择所有周期继续或结束");
      return;
    }
    case "undoGoal": {
      const item = goal(command.id);
      writableContainer(item.containerId);
      if (
        item.archived ||
        !item.completion ||
        item.completion.date !== today ||
        item.completion.settled
      )
        fail("只能撤销当天未结算目标");
      if (
        container(item.containerId).kind === "side" &&
        activeSideCount() >= 10
      )
        fail("在用支线已满10条，请先释放名额");
      if (
        item.completion.previousFocused &&
        container(item.containerId).kind === "main" &&
        focusCount(item.containerId, item.id) >= 3
      )
        fail("请先调整3个聚焦名额");
      return;
    }
    case "refresh":
      return;
  }
}
