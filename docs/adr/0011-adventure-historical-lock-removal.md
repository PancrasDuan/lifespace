# 移除 adventure_events 的 historical_lock 字段

`adventure_events.historical_lock` 是主线迁移期引入的一次性保真字段，主
线表 `adventure_mainlines` 删除后该字段已无真实数据写入，且对应错误码
`HISTORY_LOCKED` 在新模型中从未被使用。本次移除该字段及相关死错误码。

## 决策

**删除 `historical_lock` 列与 `HISTORY_LOCKED` 错误码**。

## 背景与依据

- 目标分类迁移（#170）已删除 `adventure_mainlines` 表，生产库（`zvdcjzjfhkjasikchceo`）共 24 条事件，`historical_lock = true` 为 **0 条**。
- 新模型写入路径（`adventure_planning_command.completeTask`）不显式赋值，恒为默认 `false`，新数据永远不会产生锁定记录。
- 该字段只被两处读取，且只返回 `READ_ONLY`；`HISTORY_LOCKED` 在新模型中没有任何 `raise exception`，是死错误码，但仍登记在 `worker/adventure/planning.ts`、`src/adventure/planning-api.ts` 与 `docs/adventure/planning-api.md`。
- 唯一依赖该字段的逻辑是迁移夹具中的特定场景：目标先从旧主线 A 迁到 B，任务在 B 下完成，之后 A 结束。该场景要求旧主线已结束且任务在新主线完成，生产已无 `adventure_mainlines` 表，不存在从旧备份重放该迁移的需求，因此放弃"已结束旧主线的完成记录冻结保护"是安全的选择。

## 适用范围与边界

- 本次移除不影响生产运行：删除列属于结构变更，需再次进入无流量冻结窗口执行新迁移，迁移前后对账确认除该列外数据、奖励、revision 与 `total_xp` 不变。
- 迁移与重建相关的文档（`docs/adventure/goal-category-migration.md`、`docs/adventure/qa-goal-migration-baseline.md`）同步更新该字段的描述。
- 移除后 `historical_lock` 不再作为可解释的领域概念存在于四表模型中。

## 影响文件

- `db/adventure/create-planning.sql`：列定义、CHECK 约束、两处 `historical_lock` 判断
- `db/adventure/migrations/20261111000000_goal_categories.sql`：字段赋值、CHECK 约束、安全验证块
- `worker/adventure/planning.ts`、`src/adventure/planning-api.ts`、`docs/adventure/planning-api.md`：`HISTORY_LOCKED` 错误码
- 迁移测试：`tests/database/goal-migration-fixture.sql`、`tests/support/run-goal-migration-baseline.mjs`、`tests/support/goal-migration-reconcile.mjs`、`tests/database/goal-migration-simulated-projection.sql`、`tests/database/goal-migration-reconcile.test.mjs`、`tests/support/run-planning-database.mjs`、`tests/database/legacy-goal-migration/create-planning.sql`

## 验收

- `npm run test:goal-migration-baseline` 全绿
- 生产迁移前后对账确认除该列外数据与奖励、revision、`total_xp` 不变
