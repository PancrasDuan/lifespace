import type {
  AdventureState,
  Context,
  Execution,
  CommandResult,
} from "./model";
import { commandSchema, type AdventureCommand } from "./commands";
import { day, fail } from "./dates";
import { validateCommand } from "./preconditions";
import { createOperations } from "./operations";
import { planning } from "./planning";
import { actions } from "./actions";
import { cycles, applyNaturalEnds } from "./cycles";
import { completion } from "./completion";
import { settlement } from "./settlement";
export const initialState = (): AdventureState => ({
  schemaVersion: 1,
  timeZone: "Asia/Shanghai",
  containers: [],
  goals: [],
  tasks: [],
  cycles: [],
  ledger: [],
  achievements: [],
});
export function levelForXP(xp: number) {
  let level = 1,
    progress = xp,
    needed = 20;
  while (progress >= needed) {
    progress -= needed;
    level++;
    needed += 5;
  }
  return { level, progress, needed };
}
// 仅此边界复制输入：失败不产生任何半迁移、部分奖励或配额变化。
export function executeCommand(
  input: AdventureState,
  raw: AdventureCommand,
  ctx: Context,
): Execution {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) fail("命令字段无效");
  day(ctx.today);
  validateCommand(input, parsed.data, ctx.today);
  const state = structuredClone(input);
  applyNaturalEnds(state, ctx.today);
  const result: CommandResult = {
    reward: 0,
    ledgerIds: [],
    achievementIds: [],
    levelBefore: levelForXP(state.ledger.reduce((a, e) => a + e.amount, 0))
      .level,
    levelAfter: 1,
  };
  const operations = createOperations(state, ctx, result);
  const handled = [planning, actions, cycles, completion, settlement].some(
    (handler) => handler(operations, parsed.data),
  );
  if (!handled) fail("命令类型无效");
  result.levelAfter = levelForXP(
    state.ledger.reduce((a, e) => a + e.amount, 0),
  ).level;
  return { state, result };
}
export const refresh = (s: AdventureState, ctx: Context) =>
  executeCommand(s, { type: "refresh" }, ctx);
