import type { AdventureCommand } from "./commands";

import type { Operations } from "./operations";
import { cmp, fail } from "./dates";
import { cycleById } from "./schedule";
export function completion(o: Operations, c: AdventureCommand): boolean {
  const { s, ctx, container, goal, writableContainer, writableGoal } = o;
  switch (c.type) {
    case "completeGoal": {
      const g = writableGoal(c.id),
        cycles = s.cycles.filter(
          (cy) => cy.goalId === g.id && cy.status !== "ended",
        );
      if (
        Object.keys(c.cycleChoices).length !== cycles.length ||
        cycles.some((cy) => !c.cycleChoices[cy.id])
      )
        fail("请逐项选择所有周期继续或结束");
      g.completion = {
        date: ctx.today,
        coefficient: c.coefficient ?? 1,
        reflection: c.reflection ?? "",
        actionIds: [
          ...new Set(
            s.tasks
              .filter((t) => t.goalId === g.id && t.completedOn)
              .map((t) => t.actionId),
          ),
        ],
        settled: false,
        previousFocused: g.focused,
        previousCycles: cycles.map((cy) => ({
          id: cy.id,
          status: cy.status,
          endedAt: cy.endedAt,
          endedRecordedOn: cy.endedRecordedOn,
          endedByGoal: cy.endedByGoal,
          pauses: structuredClone(cy.pauses),
        })),
      };
      g.focused = false;
      for (const cy of cycles)
        if (c.cycleChoices[cy.id] === "end") {
          cy.status = "ended";
          cy.endedAt = ctx.today;
          cy.endedRecordedOn = ctx.today;
          cy.endedByGoal = g.id;
          for (const p of cy.pauses) if (!p.end) p.end = ctx.today;
        }
      for (const t of s.tasks)
        if (
          t.goalId === g.id &&
          !t.completedOn &&
          !t.stopped &&
          cmp(t.date, ctx.today) >= 0 &&
          (!t.cycleId || c.cycleChoices[t.cycleId] === "end")
        ) {
          t.stopped = true;
          t.stoppedByGoal = g.id;
        }
      break;
    }
    case "undoGoal": {
      const g = goal(c.id);
      writableContainer(g.containerId);
      if (
        g.archived ||
        !g.completion ||
        g.completion.date !== ctx.today ||
        g.completion.settled
      )
        fail("只能撤销当天未结算目标");
      const v = g.completion;
      // A completed side releases its slot; undo must reserve it again atomically.
      if (
        container(g.containerId).kind === "side" &&
        s.containers.filter(
          (owner) =>
            owner.kind === "side" &&
            !owner.archived &&
            !owner.convertedTo &&
            !s.goals.some(
              (item) => item.containerId === owner.id && item.completion,
            ),
        ).length >= 10
      )
        fail("在用支线已满10条，请先释放名额");
      if (
        v.previousFocused &&
        container(g.containerId).kind === "main" &&
        s.goals.filter(
          (x) => x.containerId === g.containerId && x.focused && x.id !== g.id,
        ).length >= 3
      )
        fail("请先调整3个聚焦名额");
      for (const prev of v.previousCycles) {
        const cy = cycleById(s, prev.id);
        if (cy.endedByGoal === g.id) {
          cy.status = prev.status;
          cy.endedAt = prev.endedAt;
          cy.endedRecordedOn = prev.endedRecordedOn;
          cy.endedByGoal = prev.endedByGoal;
          cy.pauses = prev.pauses;
        }
      }
      for (const t of s.tasks)
        if (t.stoppedByGoal === g.id) {
          delete t.stopped;
          delete t.stoppedByGoal;
        }
      g.focused = v.previousFocused;
      delete g.completion;
      break;
    }
    default:
      return false;
  }
  return true;
}
