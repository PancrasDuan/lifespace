# 移除 adventure_events 的 historical_lock 字段

状态：2026-11-13 已确认，Issue #183。生产已完成目标分类迁移（#170、PR #175，合并提交 `707f844`）并全量切换，且确认**不再保留旧备份、无重放迁移需求**。

## 决定

删除 `adventure_events.historical_lock` 列、`adventure_events_historical_lock_check` 约束与 `HISTORY_LOCKED` 错误码，明确放弃“已结束旧主线的完成记录冻结保护”。

## 依据

- `historical_lock` 是主线迁移期引入的一次性保真字段，用于表达“完成发生时所属旧主线已结束”这一在四表模型中无法从保留数据推出的规则。
- 生产库（`zvdcjzjfhkjasceo`）24 条事件中 `historical_lock = true` 为 **0 条**；新模型写入路径（`adventure_planning_command` 的 `completeTask`）恒为默认 `false`。
- 该字段仅被两处读取，且都只返回 `READ_ONLY`；`HISTORY_LOCKED` 在新模型没有任何 `raise exception`，属死错误码。
- 用户确认已无旧备份，生产已完全上线，因此不存在“从旧备份重放该迁移”的场景，冻结保护失去服务对象。

## 迁移路径

两条路径都必须覆盖，否则删除不会真正作用到生产：

1. **旧五表库**：`db/adventure/migrations/20261111000000_goal_categories.sql` 不再创建该列，也不再写入、校验或在对账中投影它。
2. **已迁移四表库（生产现状）**：`db/adventure/migrations/20261113000000_drop_historical_lock.sql` 删除列与 CHECK 约束，并重建 `adventure_task_capability`、`adventure_task_check`、`adventure_migration_check`，使其不再引用该字段或 `HISTORY_LOCKED`。脚本以 `adventure_mainlines` 不存在为前置条件，重复执行为幂等；末尾断言列、约束与函数引用均已清除，否则回滚。
3. **新库**：`db/adventure/create-planning.sql` 从不创建该列。

## 后果

- 旧主线结束不再冻结完成；这类完成在迁移后与其他完成一样可取消（取消仍受目标终态等既有规则约束）。
- 旧完成与达成快照不补写分类标签，历史奖励、`revision`、`total_xp` 不变。
- 生产执行需再次进入无流量冻结窗口，并在迁移前后逐账户逐 ID 对账，确认除该列外数据与奖励、`revision`、`total_xp` 不变。

## 验收

- `npm run test:goal-migration-baseline` 全绿，含对已存在该列的库执行后续迁移后列、约束与函数引用清零，以及重复执行幂等。
- 生产迁移前后对账确认除该列外数据与奖励、`revision`、`total_xp` 不变。
