import type { AdventureCommand } from "./commands";
import type { LedgerEntry } from "./model";
import type { Operations } from "./operations";
import { cmp } from "./dates";
import { cycleById, cycleMonth } from "./schedule";
export function settlement(o: Operations, c: AdventureCommand): boolean {
  const { s, ctx, result, goal, task, snapshot, record } = o;
  switch (c.type) {
    case "refresh": {
      type Event = {
        date: string;
        kind: "action" | "goal" | "cycle";
        id: string;
        index?: number;
      };
      const events: Event[] = [];
      for (const t of s.tasks)
        if (t.completedOn && !t.settled && cmp(t.completedOn, ctx.today) < 0)
          events.push({ date: t.completedOn, kind: "action", id: t.id });
      for (const g of s.goals)
        if (
          g.completion &&
          !g.completion.settled &&
          cmp(g.completion.date, ctx.today) < 0
        )
          events.push({ date: g.completion.date, kind: "goal", id: g.id });
      for (const cy of s.cycles) {
        let index = cy.monthsSettled;
        while (true) {
          const m = cycleMonth(s, cy.id, index, ctx.today);
          if (!m.complete) break;
          events.push({ date: m.end, kind: "cycle", id: cy.id, index });
          index++;
        }
      }
      events.sort(
        (a, b) =>
          cmp(a.date, b.date) ||
          { action: 0, goal: 1, cycle: 2 }[a.kind] -
            { action: 0, goal: 1, cycle: 2 }[b.kind] ||
          a.id.localeCompare(b.id),
      );
      const unlock = (
        kind: "action" | "goal" | "longterm",
        threshold: number,
        count: number,
        recordId: string,
        cycleId?: string,
      ) => {
        const key = `${kind}:${threshold}${cycleId ? ":" + cycleId : ""}`;
        if (count >= threshold && !s.achievements.some((a) => a.id === key)) {
          s.achievements.push({
            id: key,
            kind,
            threshold,
            cycleId,
            unlockedOn: ctx.today,
            recordIds: [recordId],
          });
          result.achievementIds.push(key);
        }
      };
      for (const event of events) {
        let entry: LedgerEntry;
        if (event.kind === "action") {
          const t = task(event.id);
          entry = {
            id: `action:${t.actionId}`,
            kind: "action",
            sourceId: t.id,
            date: t.completedOn!,
            settledOn: ctx.today,
            amount: 1,
            calculation: "真实独立行动 1 × 1 XP",
            snapshots: [snapshot(t)],
          };
          t.settled = true;
        } else if (event.kind === "goal") {
          const g = goal(event.id),
            v = g.completion!;
          entry = {
            id: `goal:${g.id}`,
            kind: "goal",
            sourceId: g.id,
            date: v.date,
            settledOn: ctx.today,
            amount: v.actionIds.length * v.coefficient,
            calculation: `冻结的 ${v.actionIds.length} 次真实行动 × 成就系数 ${v.coefficient}`,
            snapshots: s.tasks
              .filter((t) => v.actionIds.includes(t.actionId) && t.completedOn)
              .map(snapshot),
            coefficient: v.coefficient,
            reflection: v.reflection,
          };
          v.settled = true;
        } else {
          const cy = cycleById(s, event.id),
            m = cycleMonth(s, cy.id, event.index!, ctx.today),
            before = cy.qualifiedMonths;
          cy.qualifiedMonths += m.qualified ? 1 : 0;
          cy.monthsSettled = m.index + 1;
          entry = {
            id: `cycle:${cy.id}:${m.index}`,
            kind: "cycle",
            sourceId: cy.id,
            date: m.end,
            settledOn: ctx.today,
            amount: m.reward,
            calculation: m.planned
              ? `floor(10 × min(${m.actual}/${m.planned}, 1) × ${m.appliedMultiplier})`
              : "无计划次数，不参与周期奖励",
            snapshots: s.tasks
              .filter(
                (t) =>
                  t.cycleId === cy.id &&
                  t.completedOn &&
                  cmp(t.completedOn, m.start) >= 0 &&
                  cmp(t.completedOn, m.end) < 0,
              )
              .map(snapshot),
            month: {
              index: m.index,
              start: m.start,
              end: m.end,
              planned: m.planned,
              actual: m.actual,
              rate: m.rate,
              qualifiedBefore: before,
              qualifiedAfter: cy.qualifiedMonths,
              multiplier: m.multiplier,
              appliedMultiplier: m.appliedMultiplier,
            },
          };
        }
        record(entry);
        for (const n of [1, 10, 50, 100])
          unlock(
            "action",
            n,
            s.ledger.filter((e) => e.kind === "action").length,
            entry.id,
          );
        for (const n of [1, 3, 10])
          unlock(
            "goal",
            n,
            s.ledger.filter((e) => e.kind === "goal").length,
            entry.id,
          );
        if (entry.kind === "cycle")
          for (const n of [3, 6, 12])
            unlock(
              "longterm",
              n,
              entry.month!.qualifiedAfter,
              entry.id,
              entry.sourceId,
            );
      }
      break;
    }

    default:
      return false;
  }
  return true;
}
