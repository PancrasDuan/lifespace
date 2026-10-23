import type { AdventureCommand } from "./commands";

import type { Operations } from "./operations";
import { cmp, add, fail } from "./dates";
import { planned } from "./schedule";
import type { AdventureState } from "./model";
export function applyNaturalEnds(s: AdventureState, today: string) {
  const ctx = { today };
  for (const cy of s.cycles) {
    const last = cy.rules[cy.rules.length - 1];
    if (
      cy.status !== "ended" &&
      last.endDate &&
      cmp(last.endDate, ctx.today) < 0
    ) {
      cy.status = "ended";
      cy.endedAt = add(last.endDate, 1);
      cy.endedRecordedOn = today;
      for (const p of cy.pauses) if (!p.end) p.end = cy.endedAt;
      for (const t of s.tasks)
        if (t.cycleId === cy.id && !t.completedOn && cmp(t.date, today) >= 0)
          t.stopped = true;
    }
  }
}
export function cycles(o: Operations, c: AdventureCommand): boolean {
  const { s, ctx, result, id, writableGoal, writableCycle, future } = o;
  switch (c.type) {
    case "createCycle": {
      writableGoal(c.goalId);
      future(c.startDate);
      if (c.endDate && cmp(c.endDate, c.startDate) < 0)
        fail("结束日期早于开始日期");
      if (c.cadence === "weekly" && !c.weekdays.length)
        fail("每周至少选择一天");
      const key = id();
      s.cycles.push({
        id: key,
        goalId: c.goalId,
        title: c.title,
        checklist: c.checklist,
        startDate: c.startDate,
        rules: [
          {
            effectiveFrom: c.startDate,
            cadence: c.cadence,
            weekdays: [...new Set(c.weekdays)],
            endDate: c.endDate,
          },
        ],
        pauses: [],
        status: "running",
        qualifiedMonths: 0,
        monthsSettled: 0,
      });
      result.entityId = key;
      break;
    }
    case "pauseCycle": {
      const cy = writableCycle(c.id);
      if (cy.status !== "running") fail("周期已经暂停");
      cy.pauses.push({ start: ctx.today });
      cy.status = "paused";
      break;
    }
    case "resumeCycle": {
      const cy = writableCycle(c.id);
      if (cy.status !== "paused") fail("周期没有暂停");
      const pause = cy.pauses.find((p) => !p.end);
      if (!pause) fail("暂停记录无效");
      pause.end = ctx.today;
      cy.status = "running";
      break;
    }
    case "endCycle": {
      const cy = writableCycle(c.id);
      cy.status = "ended";
      cy.endedAt = ctx.today;
      cy.endedRecordedOn = ctx.today;
      delete cy.endedByGoal;
      for (const p of cy.pauses) if (!p.end) p.end = ctx.today;
      for (const t of s.tasks)
        if (
          t.cycleId === cy.id &&
          !t.completedOn &&
          cmp(t.date, ctx.today) >= 0
        )
          t.stopped = true;
      break;
    }
    case "editCycle": {
      const cy = writableCycle(c.id);
      future(c.effectiveFrom);
      if (cmp(c.effectiveFrom, cy.startDate) < 0)
        fail("新规则不得早于周期开始日");
      if (c.endDate && cmp(c.endDate, c.effectiveFrom) < 0)
        fail("结束日期早于生效日期");
      if (c.cadence === "weekly" && !c.weekdays.length)
        fail("每周至少选择一天");
      const removed = cy.rules.filter(
        (r) => cmp(r.effectiveFrom, c.effectiveFrom) >= 0,
      );
      cy.replacedRules = [...(cy.replacedRules ?? []), ...removed];
      cy.rules = cy.rules.filter(
        (r) => cmp(r.effectiveFrom, c.effectiveFrom) < 0,
      );
      cy.rules.push({
        effectiveFrom: c.effectiveFrom,
        cadence: c.cadence,
        weekdays: [...new Set(c.weekdays)],
        endDate: c.endDate,
      });
      for (const t of s.tasks)
        if (
          t.cycleId === cy.id &&
          !t.completedOn &&
          cmp(t.slotDate ?? t.date, c.effectiveFrom) >= 0 &&
          t.date === t.slotDate
        )
          t.stopped = !planned(cy, t.slotDate!);
      break;
    }
    default:
      return false;
  }
  return true;
}
