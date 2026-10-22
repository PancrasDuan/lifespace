import type { AdventureCommand } from "./commands";

import type { Operations } from "./operations";
import { cmp, fail } from "./dates";
import { ruleAt } from "./schedule";
export function actions(o: Operations, c: AdventureCommand): boolean {
  const {
    s,
    ctx,
    result,
    id,
    goal,
    writableGoal,
    task,
    writableCycle,
    editableTask,
    future,
  } = o;
  switch (c.type) {
    case "createTask": {
      writableGoal(c.goalId);
      future(c.date);
      const key = id();
      s.tasks.push({
        id: key,
        actionId: key,
        goalId: c.goalId,
        title: c.title,
        date: c.date,
        checklist: c.checklist.map((text) => ({ text, done: false })),
        settled: false,
      });
      result.entityId = key;
      break;
    }
    case "editTask": {
      const t = editableTask(c.id);
      future(c.date);
      if (t.completedOn && c.date !== t.date) fail("先撤销完成再改期");
      t.title = c.title;
      t.date = c.date;
      t.checklist = c.checklist.map((text, i) => ({
        text,
        done: t.checklist[i]?.text === text && t.checklist[i].done,
      }));
      break;
    }
    case "toggleChecklist": {
      const t = editableTask(c.id);
      if (t.date !== ctx.today) fail("只能执行当天任务");
      if (!t.checklist[c.index]) fail("清单步骤不存在");
      t.checklist[c.index].done = c.done;
      break;
    }
    case "completeTask": {
      const t = editableTask(c.id);
      if (t.date !== ctx.today) fail("只能完成当天任务");
      if (
        s.tasks.some(
          (x) => x.actionId === t.actionId && x.completedOn && x.id !== t.id,
        )
      )
        fail("同一行动已经完成");
      t.completedOn = ctx.today;
      break;
    }
    case "undoTask": {
      const t = editableTask(c.id, true);
      if (t.completedOn !== ctx.today) fail("只能撤销当天完成");
      if (goal(t.goalId).completion?.actionIds.includes(t.actionId))
        fail("请先撤销目标达成");
      delete t.completedOn;
      break;
    }
    case "rescheduleTask": {
      const original = task(c.id);
      writableGoal(original.goalId);
      future(c.date);
      if (
        original.cycleId ||
        original.completedOn ||
        original.stopped ||
        cmp(original.date, ctx.today) >= 0
      )
        fail("只能重新安排过去漏做的一次性任务");
      if (
        original.rescheduledTo ||
        s.tasks.some(
          (t) =>
            t.actionId === original.actionId &&
            t.id !== original.id &&
            (t.completedOn || (!t.rescheduledTo && !t.stopped)),
        )
      )
        fail("同一行动已有后续安排或完成");
      const key = id();
      s.tasks.push({
        id: key,
        actionId: original.actionId,
        goalId: original.goalId,
        title: original.title,
        date: c.date,
        checklist: original.checklist.map((v) => ({
          text: v.text,
          done: false,
        })),
        sourceTaskId: original.id,
        settled: false,
      });
      original.rescheduledTo = key;
      result.entityId = key;
      break;
    }
    case "extraComplete": {
      const cy = writableCycle(c.cycleId);
      if (cy.status !== "running" || cmp(ctx.today, cy.startDate) < 0)
        fail("周期尚未开始或暂停");
      const r = ruleAt(cy, ctx.today);
      if (r?.endDate && cmp(ctx.today, r.endDate) > 0) fail("周期已结束");
      const key = id();
      s.tasks.push({
        id: key,
        actionId: key,
        goalId: cy.goalId,
        title: cy.title,
        date: ctx.today,
        cycleId: cy.id,
        extra: true,
        checklist: cy.checklist.map((text) => ({ text, done: false })),
        completedOn: ctx.today,
        settled: false,
      });
      result.entityId = key;
      break;
    }
    default:
      return false;
  }
  return true;
}
