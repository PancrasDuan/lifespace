import type { AdventureState, Cycle, CycleMonth, Task } from "./model";
import { day, cmp, add, fail } from "./dates";
export const cycleById = (s: AdventureState, id: string) =>
  s.cycles.find((c) => c.id === id) ?? fail("周期任务不存在", "NOT_FOUND");
const days = (from: string, to: string) =>
  day(from).until(day(to), { largestUnit: "days" }).days;
function* dates(from: string, to: string) {
  for (let d = from; cmp(d, to) <= 0; d = add(d, 1)) yield d;
}
const pausedAt = (c: Cycle, date: string) =>
  c.pauses.some(
    (p) => cmp(date, p.start) >= 0 && (!p.end || cmp(date, p.end) < 0),
  );
export const ruleAt = (c: Cycle, date: string) =>
  [...c.rules].reverse().find((r) => cmp(r.effectiveFrom, date) <= 0);
export function planned(c: Cycle, date: string) {
  const r = ruleAt(c, date);
  return (
    cmp(date, c.startDate) >= 0 &&
    !!r &&
    (!r.endDate || cmp(date, r.endDate) <= 0) &&
    (!c.endedAt || cmp(date, c.endedAt) < 0) &&
    !pausedAt(c, date) &&
    (r.cadence === "daily" || r.weekdays.includes(day(date).dayOfWeek))
  );
}
export const virtualTask = (c: Cycle, date: string): Task => {
  if (day(date).toString() !== date) fail("计划槽日期必须为 YYYY-MM-DD");
  return {
    id: `${c.id}@${date}`,
    actionId: `${c.id}@${date}`,
    goalId: c.goalId,
    title: c.title,
    date,
    cycleId: c.id,
    slotDate: date,
    checklist: c.checklist.map((text) => ({ text, done: false })),
    settled: false,
  };
};
export function queryTasks(
  s: AdventureState,
  from: string,
  to: string,
): Task[] {
  day(from);
  day(to);
  if (cmp(from, to) > 0) fail("日期范围无效");
  const tasks = new Map(s.tasks.map((t) => [t.id, structuredClone(t)]));
  for (const c of s.cycles)
    for (const d of dates(from, to)) {
      const key = `${c.id}@${d}`;
      if (!tasks.has(key) && planned(c, d)) tasks.set(key, virtualTask(c, d));
    }
  return [...tasks.values()]
    .filter((t) => cmp(t.date, from) >= 0 && cmp(t.date, to) <= 0)
    .map((t) => {
      if (t.cycleId && !t.completedOn) {
        const c = cycleById(s, t.cycleId);
        if (
          (c.status === "paused" &&
            c.pauses.some((p) => !p.end && cmp(t.date, p.start) >= 0)) ||
          (c.endedAt &&
            cmp(t.date, c.endedAt) >= 0 &&
            cmp(t.date, c.endedRecordedOn ?? c.endedAt) >= 0)
        )
          t.stopped = true;
      }
      return t;
    })
    .sort((a, b) => cmp(a.date, b.date) || a.id.localeCompare(b.id));
}
function boundary(c: Cycle, index: number, today: string): string {
  if (index === 0) return c.startDate;
  let end = day(c.startDate).add({ months: index }).toString();
  // Fixed point keeps original calendar anchor while adding only pauses that precede this boundary.
  for (let loop = 0; loop <= c.pauses.length + 2; loop++) {
    let offset = 0;
    for (const p of c.pauses) {
      const stop = p.end ?? today;
      if (cmp(p.start, end) < 0 && cmp(stop, c.startDate) > 0) {
        const lo = cmp(p.start, c.startDate) > 0 ? p.start : c.startDate,
          hi = stop;
        if (cmp(hi, lo) > 0) offset += days(lo, hi);
      }
    }
    const next = day(c.startDate)
      .add({ months: index })
      .add({ days: offset })
      .toString();
    if (next === end) return end;
    end = next;
  }
  return end;
}
function ratioMultiplier(q: number) {
  const n = Math.floor(q / 3),
    num = 11n ** BigInt(n),
    den = 10n ** BigInt(n);
  return {
    num,
    den,
    text:
      n === 0 ? "1" : `${num / den}.${(num % den).toString().padStart(n, "0")}`,
  };
}
export function calculateCycleReward(
  planned: number,
  actual: number,
  qualifiedBefore: number,
) {
  if (
    [planned, actual, qualifiedBefore].some(
      (v) => !Number.isSafeInteger(v) || v < 0,
    )
  )
    fail("次数必须为非负整数");
  const rate = planned ? Math.min(actual / planned, 1) : null,
    qualified =
      planned > 0 &&
      BigInt(Math.min(actual, planned)) * 5n >= BigInt(planned) * 4n,
    k = ratioMultiplier(qualifiedBefore);
  const reward = planned
    ? Number(
        (10n * BigInt(Math.min(actual, planned)) * (qualified ? k.num : 1n)) /
          (BigInt(planned) * (qualified ? k.den : 1n)),
      )
    : 0;
  return { rate, qualified, multiplier: k.text, reward };
}
export function cycleMonth(
  s: AdventureState,
  id: string,
  index: number,
  today: string,
): CycleMonth {
  if (!Number.isInteger(index) || index < 0) fail("任务月序号无效");
  const c = cycleById(s, id),
    start = boundary(c, index, today),
    end = boundary(c, index + 1, today);
  let p = 0;
  for (const d of dates(start, add(end, -1)))
    if (
      planned(c, d) ||
      s.tasks.some(
        (t) =>
          t.cycleId === id &&
          t.slotDate === d &&
          (!!t.completedOn || t.date !== t.slotDate),
      )
    )
      p++;
  const a = new Set(
    s.tasks
      .filter(
        (t) =>
          t.cycleId === id &&
          t.completedOn &&
          cmp(t.completedOn, start) >= 0 &&
          cmp(t.completedOn, end) < 0,
      )
      .map((t) => t.actionId),
  ).size;
  const prior = s.ledger
    .filter(
      (e) =>
        e.kind === "cycle" &&
        e.sourceId === id &&
        e.month &&
        e.month.index < index,
    )
    .reduce((v, e) => Math.max(v, e.month!.qualifiedAfter), 0);
  const { rate, qualified, multiplier, reward } = calculateCycleReward(
    p,
    a,
    prior,
  );
  const lastRule = c.rules[c.rules.length - 1],
    cutoff =
      c.endedAt ?? (lastRule.endDate ? add(lastRule.endDate, 1) : undefined);
  const complete = cmp(end, today) < 0 && (!cutoff || cmp(cutoff, end) >= 0);
  return {
    index,
    start,
    end,
    planned: p,
    actual: a,
    rate,
    qualified,
    multiplier,
    reward,
    complete,
  };
}
