import { expect, test } from "vitest";
import {
  initialState,
  executeCommand,
  queryTasks,
  cycleMonth,
  levelForXP,
  calculateCycleReward,
  taskCapabilities,
  commandCapability,
  forecastCycleChange,
} from "../../src/shared/adventure";
import type { AdventureState } from "../../src/shared/adventure/model";
import type { AdventureCommand } from "../../src/shared/adventure/commands";
let seq = 0;
const run = (
  state: AdventureState,
  command: AdventureCommand,
  today = "2026-01-01",
) =>
  executeCommand(state, command, {
    today,
    now: today + "T12:00:00+08:00",
    idFactory: () => `id-${++seq}`,
  }).state;
function setup() {
  let s = run(initialState(), {
    type: "createContainer",
    kind: "main",
    name: "健康",
  });
  s = run(s, {
    type: "createGoal",
    containerId: s.containers[0].id,
    title: "稳定跑步",
    standard: "完成三个月",
  });
  return s;
}
test("真实账户从零开始；容器配额、目标聚焦与排序由领域边界限制", () => {
  let s = setup();
  expect(s.ledger).toEqual([]);
  expect(s.goals[0].focused).toBe(false);
  for (let i = 0; i < 4; i++)
    s = run(s, { type: "createContainer", kind: "main", name: "方向" + i });
  expect(() =>
    run(s, { type: "createContainer", kind: "main", name: "超额" }),
  ).toThrow(/5/);
  for (let i = 0; i < 3; i++)
    s = run(s, {
      type: "createGoal",
      containerId: s.containers[0].id,
      title: "目标" + i,
      standard: "结果",
    });
  for (const g of s.goals.slice(0, 3))
    s = run(s, { type: "focusGoal", id: g.id, focused: true });
  expect(() =>
    run(s, { type: "focusGoal", id: s.goals[3].id, focused: true }),
  ).toThrow(/3/);
  const ids = s.goals.map((g) => g.id).reverse();
  s = run(s, {
    type: "reorderGoals",
    containerId: s.containers[0].id,
    goalIds: ids,
  });
  expect(
    [...s.goals].sort((a, b) => a.order - b.order).map((g) => g.id),
  ).toEqual(ids);
  expect(s.goals.filter((g) => g.focused)).toHaveLength(3);
});
test("单次完成先待结算，当天撤销与清单不发奖，次日冻结且刷新幂等", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "跑步",
    date: "2026-01-01",
    checklist: ["换鞋"],
  });
  const t = s.tasks[0].id;
  s = run(s, { type: "toggleChecklist", id: t, index: 0, done: true });
  expect(s.ledger).toHaveLength(0);
  s = run(s, { type: "completeTask", id: t });
  s = run(s, { type: "undoTask", id: t });
  expect(s.tasks[0].completedOn).toBeUndefined();
  s = run(s, { type: "completeTask", id: t });
  s = run(s, { type: "refresh" });
  expect(s.ledger).toHaveLength(0);
  s = run(s, { type: "refresh" }, "2026-01-02");
  expect(s.ledger[0]).toMatchObject({
    kind: "action",
    amount: 1,
    date: "2026-01-01",
    settledOn: "2026-01-02",
  });
  expect(s.ledger[0].snapshots[0].title).toBe("跑步");
  expect(run(s, { type: "refresh" }, "2026-01-02").ledger).toHaveLength(1);
  expect(() => run(s, { type: "undoTask", id: t }, "2026-01-02")).toThrow();
  expect(levelForXP(52)).toEqual({ level: 3, progress: 7, needed: 30 });
});
test("周期查询超出28天仍完整，1月31日起点保留月末锚，虚拟槽可操作并保持原分母", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "跑步",
    startDate: "2026-01-31",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  expect(queryTasks(s, "2026-01-31", "2026-03-31")).toHaveLength(60);
  expect(cycleMonth(s, cy, 0, "2026-02-28")).toMatchObject({
    start: "2026-01-31",
    end: "2026-02-28",
    planned: 28,
  });
  expect(cycleMonth(s, cy, 1, "2026-03-31")).toMatchObject({
    start: "2026-02-28",
    end: "2026-03-31",
    planned: 31,
  });
  s = run(
    s,
    {
      type: "editTask",
      id: cy + "@2026-01-31",
      title: "改期跑步",
      date: "2026-02-28",
      checklist: [],
    },
    "2026-01-31",
  );
  expect(queryTasks(s, "2026-01-31", "2026-01-31")).toHaveLength(0);
  s = run(s, { type: "completeTask", id: cy + "@2026-01-31" }, "2026-02-28");
  expect(cycleMonth(s, cy, 0, "2026-03-01")).toMatchObject({
    planned: 28,
    actual: 0,
  });
  expect(cycleMonth(s, cy, 1, "2026-03-01")).toMatchObject({
    planned: 31,
    actual: 1,
  });
});
test("跨月追赶合并单次与周期奖，第三月达标后第四月才使用1.1且成就不发XP", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "每日跑步",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  for (const t of queryTasks(s, "2026-01-01", "2026-04-30"))
    s = run(s, { type: "completeTask", id: t.id }, t.date);
  s = run(s, { type: "refresh" }, "2026-05-02");
  const months = s.ledger.filter((e) => e.kind === "cycle");
  expect(months.map((e) => e.amount)).toEqual([10, 10, 10, 11]);
  expect(s.cycles[0].qualifiedMonths).toBe(4);
  expect(s.ledger.reduce((v, e) => v + e.amount, 0)).toBe(161);
  expect(s.achievements.filter((a) => a.kind === "longterm")).toHaveLength(1);
  expect(run(s, { type: "refresh" }, "2026-05-02").ledger).toEqual(s.ledger);
});
test("暂停顺延当前月而不阻挡已到期月；恢复不补造，结束保留完整月且不奖残月", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "周期",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "pauseCycle", id: cy }, "2026-02-05");
  s = run(s, { type: "refresh" }, "2026-02-06");
  expect(s.cycles[0].monthsSettled).toBe(1);
  expect(queryTasks(s, "2026-02-05", "2026-02-11")).toHaveLength(0);
  s = run(s, { type: "resumeCycle", id: cy }, "2026-02-12");
  expect(cycleMonth(s, cy, 1, "2026-02-12").end).toBe("2026-03-08");
  expect(queryTasks(s, "2026-02-05", "2026-02-11")).toHaveLength(0);
  s = run(s, { type: "endCycle", id: cy }, "2026-03-08");
  s = run(s, { type: "refresh" }, "2026-04-10");
  expect(s.cycles[0].monthsSettled).toBe(2);
  expect(() => run(s, { type: "resumeCycle", id: cy }, "2026-04-10")).toThrow();
});
test("重复规则仅从指定日改变未来计划，保留完成与月起点，替换其后预约规则", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "每周跑步",
    startDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [1],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "completeTask", id: cy + "@2026-01-05" }, "2026-01-05");
  s = run(
    s,
    {
      type: "editCycle",
      id: cy,
      effectiveFrom: "2026-01-10",
      cadence: "weekly",
      weekdays: [2, 4],
    },
    "2026-01-06",
  );
  expect(queryTasks(s, "2026-01-01", "2026-01-31").map((t) => t.date)).toEqual([
    "2026-01-05",
    "2026-01-13",
    "2026-01-15",
    "2026-01-20",
    "2026-01-22",
    "2026-01-27",
    "2026-01-29",
  ]);
  expect(cycleMonth(s, cy, 0, "2026-02-02")).toMatchObject({
    start: "2026-01-01",
    planned: 7,
    actual: 1,
    reward: 1,
  });
  expect(() =>
    run(
      s,
      {
        type: "editCycle",
        id: cy,
        effectiveFrom: "2026-01-04",
        cadence: "daily",
        weekdays: [],
      },
      "2026-01-06",
    ),
  ).toThrow();
  s = run(
    s,
    {
      type: "editCycle",
      id: cy,
      effectiveFrom: "2026-01-08",
      cadence: "weekly",
      weekdays: [3],
    },
    "2026-01-06",
  );
  expect(s.cycles[0].rules).toHaveLength(2);
});
test("目标逐项去向、冻结奖励含未结算行动，继续周期不追增，撤销先解冻且保留暂停", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "createCycle",
    goalId: g,
    title: "每日",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "completeTask", id: cy + "@2026-01-01" });
  expect(() =>
    run(s, {
      type: "completeGoal",
      id: g,
      confirmed: true,
      coefficient: 2,
      cycleChoices: {},
    }),
  ).toThrow();
  s = run(s, {
    type: "completeGoal",
    id: g,
    confirmed: true,
    coefficient: 2,
    cycleChoices: { [cy]: "continue" },
  });
  expect(() => run(s, { type: "undoTask", id: cy + "@2026-01-01" })).toThrow();
  s = run(s, { type: "completeTask", id: cy + "@2026-01-02" }, "2026-01-02");
  s = run(s, { type: "refresh" }, "2026-01-03");
  expect(s.ledger.find((e) => e.kind === "goal")?.amount).toBe(2);
  expect(s.ledger.filter((e) => e.kind === "action")).toHaveLength(2);
  let paused = setup();
  const pg = paused.goals[0].id;
  paused = run(paused, {
    type: "createCycle",
    goalId: pg,
    title: "暂停习惯",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const pc = paused.cycles[0].id;
  paused = run(paused, { type: "pauseCycle", id: pc });
  paused = run(paused, {
    type: "completeGoal",
    id: pg,
    confirmed: true,
    cycleChoices: { [pc]: "end" },
  });
  paused = run(paused, { type: "undoGoal", id: pg });
  expect(paused.cycles[0].status).toBe("paused");
  expect(paused.cycles[0].pauses[0].end).toBeUndefined();
  expect(paused.goals[0].completion).toBeUndefined();
});
test("支线迁移原子校验聚焦，归档只读但已完成仍结算，主线仍占名额", () => {
  let s = setup();
  const main = s.containers[0].id;
  for (let i = 0; i < 2; i++)
    s = run(s, {
      type: "createGoal",
      containerId: main,
      title: "目标" + i,
      standard: "结果",
    });
  for (const g of s.goals)
    s = run(s, { type: "focusGoal", id: g.id, focused: true });
  s = run(s, { type: "createContainer", kind: "side", name: "摄影" });
  const side = s.containers[1].id;
  s = run(s, {
    type: "createGoal",
    containerId: side,
    title: "作品",
    standard: "一张",
  });
  const g = s.goals[3].id;
  s = run(s, { type: "focusGoal", id: g, focused: true });
  expect(() =>
    run(s, { type: "migrateSide", id: side, targetContainerId: main }),
  ).toThrow(/3/);
  s = run(s, { type: "focusGoal", id: s.goals[0].id, focused: false });
  s = run(s, { type: "migrateSide", id: side, targetContainerId: main });
  expect(s.goals[3]).toMatchObject({ id: g, containerId: main, focused: true });
  expect(s.containers[1].convertedTo).toBe(main);
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "拍照",
    date: "2026-01-01",
    checklist: [],
  });
  s = run(s, { type: "completeTask", id: s.tasks[0].id });
  s = run(s, { type: "archive", kind: "container", id: main });
  expect(() =>
    run(s, { type: "editGoal", id: g, title: "改名", standard: "新标准" }),
  ).toThrow();
  s = run(s, { type: "refresh" }, "2026-01-02");
  expect(s.ledger[0].amount).toBe(1);
  expect(s.containers[0].archived).toBe(true);
  expect(() =>
    run(s, { type: "migrateSide", id: side, newMainName: "新主线" }),
  ).toThrow();
});
test("重新安排保留漏做来源与同行动身份，额外完成独立计数且不占周期槽", () => {
  let s = setup(),
    g = s.goals[0].id;
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "交付",
    date: "2026-01-01",
    checklist: ["核对"],
  });
  const old = s.tasks[0].id;
  s = run(
    s,
    { type: "rescheduleTask", id: old, date: "2026-01-03" },
    "2026-01-02",
  );
  const next = s.tasks[1].id;
  expect(s.tasks[0]).toMatchObject({
    id: old,
    date: "2026-01-01",
    rescheduledTo: next,
  });
  expect(s.tasks[1]).toMatchObject({
    actionId: old,
    sourceTaskId: old,
    checklist: [{ text: "核对", done: false }],
  });
  expect(() =>
    run(
      s,
      { type: "rescheduleTask", id: old, date: "2026-01-04" },
      "2026-01-02",
    ),
  ).toThrow();
  s = run(s, { type: "completeTask", id: next }, "2026-01-03");
  s = run(
    s,
    {
      type: "createCycle",
      goalId: g,
      title: "每周",
      startDate: "2026-01-03",
      cadence: "weekly",
      weekdays: [6],
      checklist: [],
    },
    "2026-01-03",
  );
  const cy = s.cycles[0].id;
  s = run(
    s,
    { type: "extraComplete", cycleId: cy, confirmed: true },
    "2026-01-03",
  );
  s = run(s, { type: "completeTask", id: cy + "@2026-01-03" }, "2026-01-03");
  expect(cycleMonth(s, cy, 0, "2026-02-04")).toMatchObject({
    planned: 5,
    actual: 2,
  });
  s = run(s, { type: "refresh" }, "2026-01-04");
  expect(s.ledger.filter((e) => e.kind === "action")).toHaveLength(3);
});
test("结束日期含当天，结束后的排期与额外完成不可重开，满月日到期次日才结算", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "限期",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  expect(queryTasks(s, "2026-01-31", "2026-02-02").map((t) => t.date)).toEqual([
    "2026-01-31",
  ]);
  s = run(s, { type: "completeTask", id: cy + "@2026-01-31" }, "2026-01-31");
  expect(
    run(s, { type: "refresh" }, "2026-02-01").ledger.filter(
      (e) => e.kind === "cycle",
    ),
  ).toHaveLength(0);
  s = run(s, { type: "refresh" }, "2026-02-02");
  expect(s.cycles[0].status).toBe("ended");
  expect(s.cycles[0].monthsSettled).toBe(1);
  expect(() =>
    run(
      s,
      {
        type: "editCycle",
        id: cy,
        effectiveFrom: "2026-02-02",
        cadence: "daily",
        weekdays: [],
      },
      "2026-02-02",
    ),
  ).toThrow();
});

test("周期奖精确处理79/80%、P0、超额、三六月复利边界与逐笔floor", () => {
  expect(calculateCycleReward(100, 79, 3)).toEqual({
    rate: 0.79,
    qualified: false,
    multiplier: "1.1",
    appliedMultiplier: "1",
    reward: 7,
  });
  expect(calculateCycleReward(100, 80, 3)).toEqual({
    rate: 0.8,
    qualified: true,
    multiplier: "1.1",
    appliedMultiplier: "1.1",
    reward: 8,
  });
  expect(calculateCycleReward(0, 4, 6)).toEqual({
    rate: null,
    qualified: false,
    multiplier: "1.21",
    appliedMultiplier: "1",
    reward: 0,
  });
  expect(calculateCycleReward(10, 30, 2).reward).toBe(10);
  expect(calculateCycleReward(10, 30, 3).reward).toBe(11);
  expect(calculateCycleReward(10, 30, 6).reward).toBe(12);
  expect(calculateCycleReward(3, 2, 0).reward).toBe(6);
});
test("无计划完整月不增加达标月；非连续达标保留积累并从下一月进档", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "分段计划",
    startDate: "2026-01-01",
    endDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [1],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, {
    type: "editCycle",
    id: cy,
    effectiveFrom: "2026-03-01",
    cadence: "weekly",
    weekdays: [1],
  });
  s = run(s, { type: "refresh" }, "2026-03-02");
  expect(
    s.ledger
      .filter((e) => e.kind === "cycle")
      .map((e) => [e.month?.planned, e.amount]),
  ).toEqual([
    [0, 0],
    [0, 0],
  ]);
  expect(s.cycles[0].qualifiedMonths).toBe(0);
  for (const t of queryTasks(s, "2026-03-01", "2026-03-31"))
    s = run(s, { type: "completeTask", id: t.id }, t.date);
  s = run(s, { type: "refresh" }, "2026-05-02");
  expect(s.cycles[0].qualifiedMonths).toBe(1);
  for (const t of queryTasks(s, "2026-05-01", "2026-06-30"))
    s = run(s, { type: "completeTask", id: t.id }, t.date);
  s = run(s, { type: "refresh" }, "2026-07-02");
  expect(s.cycles[0].qualifiedMonths).toBe(3);
  expect(cycleMonth(s, cy, 6, "2026-07-02").multiplier).toBe("1.1");
});
test("跨年闰年月末锚，多次暂停与同日恢复不累计虚假时长", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "月末",
    startDate: "2027-12-31",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  expect(cycleMonth(s, cy, 1, "2028-01-01")).toMatchObject({
    start: "2028-01-31",
    end: "2028-02-29",
    planned: 29,
  });
  s = run(s, { type: "pauseCycle", id: cy }, "2028-02-02");
  s = run(s, { type: "resumeCycle", id: cy }, "2028-02-02");
  expect(cycleMonth(s, cy, 1, "2028-02-02").end).toBe("2028-02-29");
  s = run(s, { type: "pauseCycle", id: cy }, "2028-02-10");
  s = run(s, { type: "resumeCycle", id: cy }, "2028-02-13");
  s = run(s, { type: "pauseCycle", id: cy }, "2028-02-20");
  s = run(s, { type: "resumeCycle", id: cy }, "2028-02-22");
  expect(cycleMonth(s, cy, 1, "2028-02-22")).toMatchObject({
    start: "2028-01-31",
    end: "2028-03-05",
    planned: 29,
  });
  expect(cycleMonth(s, cy, 2, "2028-04-06")).toMatchObject({
    start: "2028-03-05",
    end: "2028-04-05",
  });
});
test("支线空壳上限、归档释放与主线归档不释放；迁移失败输入完全不变", () => {
  let s = setup();
  for (let i = 0; i < 10; i++)
    s = run(s, { type: "createContainer", kind: "side", name: "探索" + i });
  expect(() =>
    run(s, { type: "createContainer", kind: "side", name: "超额" }),
  ).toThrow(/10/);
  s = run(s, { type: "archive", kind: "container", id: s.containers[1].id });
  s = run(s, { type: "createContainer", kind: "side", name: "新探索" });
  for (let i = 0; i < 4; i++)
    s = run(s, { type: "createContainer", kind: "main", name: "主线" + i });
  s = run(s, { type: "archive", kind: "container", id: s.containers[0].id });
  const before = structuredClone(s);
  expect(() =>
    run(s, {
      type: "migrateSide",
      id: s.containers[2].id,
      newMainName: "第六主线",
    }),
  ).toThrow(/5/);
  expect(s).toEqual(before);
});
test("严格命令拒绝客户端XP、owner、伪日期与过去写入，未来任务不得提前完成", () => {
  const s = setup(),
    g = s.goals[0].id;
  expect(() =>
    run(s, {
      type: "createTask",
      goalId: g,
      title: "未来",
      date: "2026-02-30",
      checklist: [],
    }),
  ).toThrow();
  expect(() =>
    executeCommand(
      s,
      { type: "refresh", xp: 1000 } as unknown as AdventureCommand,
      { today: "2026-01-01", now: "2026-01-01" },
    ),
  ).toThrow();
  expect(() =>
    executeCommand(
      s,
      {
        type: "createGoal",
        containerId: s.containers[0].id,
        title: "目标",
        standard: "达标",
        owner: "别人",
      } as unknown as AdventureCommand,
      { today: "2026-01-01", now: "2026-01-01" },
    ),
  ).toThrow();
  let a = run(s, {
    type: "createTask",
    goalId: g,
    title: "未来",
    date: "2026-01-03",
    checklist: [],
  });
  expect(() => run(a, { type: "completeTask", id: a.tasks[0].id })).toThrow();
  expect(() =>
    run(
      a,
      {
        type: "editTask",
        id: a.tasks[0].id,
        title: "改名",
        date: "2026-01-04",
        checklist: [],
      },
      "2026-01-04",
    ),
  ).toThrow();
});
test("目标当日撤销不覆盖继续周期的后来暂停动作，也不撤销任务完成", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "createCycle",
    goalId: g,
    title: "继续",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "completeTask", id: cy + "@2026-01-01" });
  s = run(s, {
    type: "completeGoal",
    id: g,
    confirmed: true,
    cycleChoices: { [cy]: "continue" },
  });
  s = run(s, { type: "pauseCycle", id: cy });
  s = run(s, { type: "undoGoal", id: g });
  expect(s.cycles[0].status).toBe("paused");
  expect(s.tasks[0].completedOn).toBe("2026-01-01");
});
test("经验快照冻结，改名迁移不改账本；同类长期成就按单周期分别关联", () => {
  let s = setup(),
    g = s.goals[0].id;
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "原任务名",
    date: "2026-01-01",
    checklist: [],
  });
  s = run(s, { type: "completeTask", id: s.tasks[0].id });
  s = run(s, { type: "refresh" }, "2026-01-02");
  const snapshot = structuredClone(s.ledger[0]);
  s = run(
    s,
    { type: "editContainer", id: s.containers[0].id, name: "新方向" },
    "2026-01-02",
  );
  s = run(
    s,
    { type: "editGoal", id: g, title: "新目标名", standard: "新完成标准" },
    "2026-01-02",
  );
  expect(s.ledger[0]).toEqual(snapshot);
  expect(snapshot.snapshots[0]).toMatchObject({
    containerName: "健康",
    goalTitle: "稳定跑步",
    title: "原任务名",
  });
});
test("跨多个月长暂停一次性顺延完整暂停时长，不因投影迭代次数少截断", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "长暂停",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "pauseCycle", id: cy }, "2026-01-02");
  s = run(s, { type: "resumeCycle", id: cy }, "2026-12-31");
  expect(cycleMonth(s, cy, 0, "2026-12-31")).toMatchObject({
    start: "2026-01-01",
    end: "2027-01-30",
    planned: 31,
  });
});
test("单周期12个达标月解锁3/6/12，同类两周期分别保留触发记录且XP与账本一致", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "createCycle",
    goalId: g,
    title: "周一跑步",
    startDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [1],
    checklist: [],
  });
  s = run(s, {
    type: "createCycle",
    goalId: g,
    title: "周二跑步",
    startDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [2],
    checklist: [],
  });
  for (const task of queryTasks(s, "2026-01-01", "2026-12-31"))
    s = run(s, { type: "completeTask", id: task.id }, task.date);
  s = run(s, { type: "refresh" }, "2027-01-02");
  expect(s.cycles.map((c) => c.qualifiedMonths)).toEqual([12, 12]);
  expect(s.achievements.filter((a) => a.kind === "longterm")).toHaveLength(6);
  expect(s.ledger.reduce((sum, e) => sum + e.amount, 0)).toBe(380);
  expect(levelForXP(380)).toEqual({ level: 10, progress: 20, needed: 65 });
  for (const badge of s.achievements)
    expect(s.ledger.some((e) => badge.recordIds.includes(e.id))).toBe(true);
  expect(cycleMonth(s, s.cycles[0].id, 12, "2027-01-02").multiplier).toBe(
    "1.4641",
  );
});
test("额外完成当天撤销恢复同一action，不改分母，暂停和跨日禁止补记", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "非计划日",
    startDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [1],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "extraComplete", cycleId: cy, confirmed: true });
  const t = s.tasks[0].id;
  s = run(s, { type: "undoTask", id: t });
  expect(cycleMonth(s, cy, 0, "2026-02-02").actual).toBe(0);
  s = run(s, { type: "completeTask", id: t });
  expect(cycleMonth(s, cy, 0, "2026-02-02")).toMatchObject({
    planned: 4,
    actual: 1,
  });
  s = run(s, { type: "pauseCycle", id: cy });
  expect(() =>
    run(s, { type: "extraComplete", cycleId: cy, confirmed: true }),
  ).toThrow();
  expect(() => run(s, { type: "undoTask", id: t }, "2026-01-02")).toThrow();
});
test("空成果目标仍可按完成标准达成并解锁目标成就，跨日不得撤销且清单不放大奖励", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "completeGoal",
    id: g,
    confirmed: true,
    cycleChoices: {},
  });
  expect(s.goals[0].completion?.coefficient).toBe(1);
  expect(() => run(s, { type: "undoGoal", id: g }, "2026-01-02")).toThrow();
  s = run(s, { type: "refresh" }, "2026-01-02");
  expect(s.ledger[0]).toMatchObject({ kind: "goal", amount: 0 });
  expect(s.achievements.filter((a) => a.kind === "goal")).toHaveLength(1);
});
test("暂停不锁死当天已完成记录的纠错撤销，仍禁止暂停周期追加完成", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "当天纠错",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id,
    t = cy + "@2026-01-01";
  s = run(s, { type: "completeTask", id: t });
  s = run(s, { type: "pauseCycle", id: cy });
  s = run(s, { type: "undoTask", id: t });
  expect(s.tasks[0].completedOn).toBeUndefined();
  expect(() => run(s, { type: "completeTask", id: t })).toThrow();
});
test("撤销已完成支线前重新校验10个在用名额，失败完全原子且释放后可恢复", () => {
  let s = initialState();
  s = run(s, { type: "createContainer", kind: "side", name: "待完成支线" });
  const side = s.containers[0].id;
  s = run(s, {
    type: "createGoal",
    containerId: side,
    title: "成果",
    standard: "可验收",
  });
  const goal = s.goals[0].id;
  s = run(s, {
    type: "completeGoal",
    id: goal,
    confirmed: true,
    cycleChoices: {},
  });
  for (let i = 0; i < 10; i++)
    s = run(s, { type: "createContainer", kind: "side", name: "新探索" + i });
  const before = structuredClone(s);
  expect(() => run(s, { type: "undoGoal", id: goal })).toThrow(/10/);
  expect(s).toEqual(before);
  s = run(s, { type: "archive", kind: "container", id: s.containers[1].id });
  s = run(s, { type: "undoGoal", id: goal });
  expect(s.goals[0].completion).toBeUndefined();
});
test("归档停止今天未来未完成安排，但不把昨天漏做历史改成撤下，历史完成仍结算", () => {
  let s = setup();
  const g = s.goals[0].id;
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "昨天漏做",
    date: "2026-01-01",
    checklist: [],
  });
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "今天停止",
    date: "2026-01-02",
    checklist: [],
  });
  s = run(s, {
    type: "createTask",
    goalId: g,
    title: "昨天完成",
    date: "2026-01-01",
    checklist: [],
  });
  s = run(s, { type: "completeTask", id: s.tasks[2].id });
  const missed = structuredClone(s.tasks[0]);
  s = run(s, { type: "archive", kind: "goal", id: g }, "2026-01-02");
  expect(s.tasks[0]).toEqual(missed);
  expect(s.tasks[1].stopped).toBe(true);
  s = run(s, { type: "refresh" }, "2026-01-03");
  expect(s.ledger.filter((e) => e.kind === "action")).toHaveLength(1);
});
test("延迟访问触发自然结束不重写此前已成为过去的改期实例", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "截止前改期",
    startDate: "2026-01-01",
    endDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  s = run(s, {
    type: "editTask",
    id: cy + "@2026-01-01",
    title: "改期活动",
    date: "2026-01-03",
    checklist: [],
  });
  const task = structuredClone(s.tasks[0]);
  s = run(s, { type: "refresh" }, "2026-01-05");
  expect(s.tasks[0]).toEqual(task);
  expect(queryTasks(s, "2026-01-03", "2026-01-03")[0].stopped).toBeUndefined();
});
test.each(["existing", "new"] as const)(
  "未归档的已达成支线可%s迁移，冻结奖励与继续周期身份不变",
  (mode) => {
    let s = setup();
    const main = s.containers[0].id;
    s = run(s, { type: "createContainer", kind: "side", name: "探索" });
    const side = s.containers[1].id;
    s = run(s, {
      type: "createGoal",
      containerId: side,
      title: "探索成果",
      standard: "达标",
    });
    const goal = s.goals[1].id;
    s = run(s, {
      type: "createCycle",
      goalId: goal,
      title: "保留习惯",
      startDate: "2026-01-01",
      cadence: "daily",
      weekdays: [],
      checklist: [],
    });
    const cy = s.cycles[0].id;
    s = run(s, { type: "completeTask", id: cy + "@2026-01-01" });
    s = run(s, {
      type: "completeGoal",
      id: goal,
      confirmed: true,
      coefficient: 3,
      cycleChoices: { [cy]: "continue" },
    });
    s = run(s, { type: "refresh" }, "2026-01-02");
    const ledger = structuredClone(s.ledger),
      frozen = structuredClone(s.goals[1].completion);
    s = run(
      s,
      mode === "existing"
        ? { type: "migrateSide", id: side, targetContainerId: main }
        : { type: "migrateSide", id: side, newMainName: "探索主线" },
      "2026-01-02",
    );
    expect(s.goals[1]).toMatchObject({
      id: goal,
      completion: frozen,
      sourceContainerId: side,
    });
    expect(s.containers[1].sourceGoalId).toBe(goal);
    expect(s.ledger).toEqual(ledger);
    expect(s.cycles[0].id).toBe(cy);
    s = run(s, { type: "completeTask", id: cy + "@2026-01-02" }, "2026-01-02");
    s = run(s, { type: "refresh" }, "2026-01-03");
    expect(
      s.ledger.filter((e) => e.kind === "goal").map((e) => e.amount),
    ).toEqual([3]);
  },
);

test("操作能力来自相同命令校验，未来与暂停清单禁用但暂停当天完成可撤销", () => {
  let s = setup();
  const goal = s.goals[0].id;
  s = run(s, {
    type: "createTask",
    goalId: goal,
    title: "未来步骤",
    date: "2026-01-02",
    checklist: ["步骤"],
  });
  expect(taskCapabilities(s, s.tasks[0], "2026-01-01")).toMatchObject({
    edit: true,
    complete: false,
    undo: false,
    checklist: false,
    reschedule: false,
  });
  s = run(s, {
    type: "createCycle",
    goalId: goal,
    title: "当天周期",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: ["步骤"],
  });
  const cy = s.cycles[0].id;
  s = run(s, { type: "completeTask", id: cy + "@2026-01-01" });
  s = run(s, { type: "pauseCycle", id: cy });
  expect(taskCapabilities(s, s.tasks[1], "2026-01-01")).toMatchObject({
    edit: false,
    complete: false,
    undo: true,
    checklist: false,
  });
  const before = structuredClone(s);
  taskCapabilities(s, s.tasks[1], "2026-01-01");
  expect(s).toEqual(before);
});
test("重复规则纯预览复用正式命令且选择首个受影响任务月，完全不改变原状态", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "每周",
    startDate: "2026-01-01",
    cadence: "weekly",
    weekdays: [1],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  const command = {
    type: "editCycle" as const,
    id: cy,
    effectiveFrom: "2026-02-10",
    cadence: "daily" as const,
    weekdays: [],
  };
  const before = structuredClone(s);
  const forecast = forecastCycleChange(s, command, "2026-01-02", {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  expect(forecast.before.month).toMatchObject({
    index: 1,
    start: "2026-02-01",
    end: "2026-03-01",
    planned: 4,
  });
  expect(forecast.after.month).toMatchObject({
    index: 1,
    start: "2026-02-01",
    end: "2026-03-01",
    planned: 21,
  });
  expect(forecast.before.tasks).toHaveLength(4);
  expect(forecast.after.tasks).toHaveLength(21);
  expect(s).toEqual(before);
  const real = run(s, command, "2026-01-02");
  expect(cycleMonth(real, cy, 1, "2026-01-02")).toEqual(forecast.after.month);
});
test("虚拟计划槽必须使用唯一规范日期，拒绝时间后缀绕过slot身份重复计奖", () => {
  let s = setup();
  s = run(s, {
    type: "createCycle",
    goalId: s.goals[0].id,
    title: "规范槽",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  const cy = s.cycles[0].id;
  expect(() =>
    run(s, {
      type: "editTask",
      id: cy + "@2026-01-01T00:00",
      title: "重复槽",
      date: "2026-01-01",
      checklist: [],
    }),
  ).toThrow();
  expect(() =>
    run(s, {
      type: "editTask",
      id: cy + "@2026-01-01[u-ca=iso8601]",
      title: "重复槽",
      date: "2026-01-01",
      checklist: [],
    }),
  ).toThrow();
});

test("任务与周期按钮的只读能力查询不读取成长账本，也不复制全状态", () => {
  let state = setup();
  const goalId = state.goals[0].id;
  state = run(state, {
    type: "createTask",
    goalId,
    title: "当天行动",
    date: "2026-01-01",
    checklist: ["步骤"],
  });
  state = run(state, {
    type: "createCycle",
    goalId,
    title: "每日活动",
    startDate: "2026-01-01",
    cadence: "daily",
    weekdays: [],
    checklist: [],
  });
  Object.defineProperty(state, "ledger", {
    get() {
      throw new Error("能力查询不应读取无关成长历史");
    },
    configurable: true,
  });
  expect(taskCapabilities(state, state.tasks[0], "2026-01-01")).toMatchObject({
    edit: true,
    complete: true,
    undo: false,
    checklist: true,
    reschedule: false,
  });
  expect(
    commandCapability(
      state,
      { type: "extraComplete", cycleId: state.cycles[0].id, confirmed: true },
      "2026-01-01",
    ).allowed,
  ).toBe(true);
  const cycleId = state.cycles[0].id;
  expect(
    commandCapability(state, { type: "pauseCycle", id: cycleId }, "2026-01-01")
      .allowed,
  ).toBe(true);
  expect(
    commandCapability(state, { type: "endCycle", id: cycleId }, "2026-01-01")
      .allowed,
  ).toBe(true);
  expect(
    commandCapability(
      state,
      {
        type: "editCycle",
        id: cycleId,
        effectiveFrom: "2026-01-01",
        cadence: "daily",
        weekdays: [],
      },
      "2026-01-01",
    ).allowed,
  ).toBe(true);
  expect(
    commandCapability(state, { type: "resumeCycle", id: cycleId }, "2026-01-01")
      .allowed,
  ).toBe(false);
});

test.each([
  { actual: 15, applied: "1", reward: 5 },
  { actual: 24, applied: "1.1", reward: 8 },
])(
  "Q3后第四月完成$actual/30：累计K和实际倍率分别冻结，预览与结算一致",
  ({ actual, applied, reward }) => {
    let state = setup();
    state = run(state, {
      type: "createCycle",
      goalId: state.goals[0].id,
      title: "倍率区分",
      startDate: "2026-01-01",
      cadence: "daily",
      weekdays: [],
      checklist: [],
    });
    const cycleId = state.cycles[0].id;
    for (const task of queryTasks(state, "2026-01-01", "2026-03-31"))
      state = run(state, { type: "completeTask", id: task.id }, task.date);
    state = run(state, { type: "refresh" }, "2026-04-02");
    expect(state.cycles[0].qualifiedMonths).toBe(3);
    const april = queryTasks(state, "2026-04-02", "2026-04-30").slice(
      0,
      actual,
    );
    for (const task of april)
      state = run(state, { type: "completeTask", id: task.id }, task.date);
    const today = actual === 15 ? "2026-04-17" : "2026-04-26";
    const forecast = forecastCycleChange(
      state,
      {
        type: "editCycle",
        id: cycleId,
        effectiveFrom: today,
        cadence: "daily",
        weekdays: [],
      },
      today,
    );
    expect(forecast.before.month).toMatchObject({
      planned: 30,
      actual,
      multiplier: "1.1",
      appliedMultiplier: applied,
      reward,
    });
    expect(forecast.after.month).toMatchObject({
      planned: 30,
      actual,
      multiplier: "1.1",
      appliedMultiplier: applied,
      reward,
    });
    state = run(state, { type: "refresh" }, "2026-05-02");
    const entry = state.ledger.find(
      (e) => e.kind === "cycle" && e.month?.index === 3,
    )!;
    expect(entry).toMatchObject({
      amount: reward,
      month: { multiplier: "1.1", appliedMultiplier: applied },
    });
    expect(entry.calculation).toContain("× " + applied + ")");
    const legacy = structuredClone(state);
    delete legacy.ledger.find((e) => e.id === entry.id)!.month!
      .appliedMultiplier;
    const before = structuredClone(legacy.ledger);
    expect(run(legacy, { type: "refresh" }, "2026-05-02").ledger).toEqual(
      before,
    );
  },
);
