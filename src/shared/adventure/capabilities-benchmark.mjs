// 只读能力基准：同一状态三轮查询，不使用渲染缓存，不设置机器性能断言。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const built = await build({
  absWorkingDir: root,
  entryPoints: ["src/shared/adventure/index.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
const today = "2026-10-19";
for (const history of [0, 1000, 5000]) {
  const s = api.initialState();
  s.containers = [{ id: "main", name: "健康", kind: "main", archived: false }];
  s.goals = [
    {
      id: "goal",
      containerId: "main",
      title: "保持运动",
      standard: "每日行动",
      focused: true,
      order: 0,
      archived: false,
    },
  ];
  const makeTask = (i, date) => ({
    id: `task-${i}`,
    actionId: `task-${i}`,
    goalId: "goal",
    title: "记录今天的一次真实行动",
    date,
    checklist: [{ text: "检查步骤", done: false }],
    settled: date !== today,
    ...(date !== today ? { completedOn: date } : {}),
  });
  for (let i = 0; i < history; i++) {
    const t = makeTask(i, "2026-10-18");
    s.tasks.push(t);
    s.ledger.push({
      id: `action:${t.id}`,
      kind: "action",
      sourceId: t.id,
      date: t.date,
      settledOn: today,
      amount: 1,
      calculation: "真实行动 1 × 1 XP",
      snapshots: [
        {
          taskId: t.id,
          actionId: t.id,
          goalId: "goal",
          goalTitle: "保持运动",
          standard: "每日行动",
          containerId: "main",
          containerName: "健康",
          containerKind: "main",
          title: t.title,
          date: t.date,
        },
      ],
    });
  }
  const rows = Array.from({ length: 50 }, (_, i) =>
    makeTask(history + i, today),
  );
  s.tasks.push(...rows);
  const durations = [];
  for (let trial = 0; trial < 3; trial++) {
    const start = performance.now();
    for (const task of rows) api.taskCapabilities(s, task, today);
    durations.push(Math.round(performance.now() - start));
  }
  const stateBytes = Buffer.byteLength(JSON.stringify(s));
  s.cycles.push({
    id: "cycle",
    goalId: "goal",
    title: "周期能力",
    checklist: [],
    startDate: today,
    rules: [{ effectiveFrom: today, cadence: "daily", weekdays: [] }],
    pauses: [],
    status: "running",
    qualifiedMonths: 0,
    monthsSettled: 0,
  });
  const cycleDurations = [];
  for (let trial = 0; trial < 3; trial++) {
    const start = performance.now();
    let allowed = 0;
    for (let i = 0; i < 50; i++)
      if (
        api.commandCapability(
          s,
          { type: "extraComplete", cycleId: "cycle", confirmed: true },
          today,
        ).allowed
      )
        allowed++;
    if (allowed !== 50) throw new Error("周期能力基准未执行有效命令");
    cycleDurations.push(Math.round((performance.now() - start) * 100) / 100);
  }
  console.log(
    JSON.stringify({
      history,
      visibleRows: rows.length,
      stateBytes,
      taskCapabilityMs: durations,
      cycleButtons: 50,
      cycleCapabilityMs: cycleDurations,
    }),
  );
}
