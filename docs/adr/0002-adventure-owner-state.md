# 人生冒险使用五张关系表和事务事件

状态：2026-10-21 已采纳；2026-11-07 按 PR #146 当前实现校准初始化与升级入口，五表及事务事件决策不变。

2026-11-08：事务 RPC／PostgREST 及“不增加应用层事务管理器”的实现决定曾由 [ADR 0010](0010-worker-postgres-transactions.md) 替代。2026-11-09 的 [ADR 0011](0011-worker-postgrest-rollback.md) 已选择性恢复本文的事务 RPC 调用链，并随 PR #155 上线；五表、事件、历史回执和账户锁决定继续有效。ADR 0010 仅保留为历史与恢复 pg 路径的依据。

## 决定

人生冒险使用五张 public.adventure_ 物理表：

- adventure_accounts 保存账户、total_xp、revision、时区及时间。
- adventure_mainlines 保存普通主线和按需创建的独立主线。
- adventure_goals 保存真实目标及按需创建的唯一 inbox 系统目标。
- adventure_tasks 保存一次性任务当前内容、当前执行日期、归属和状态。
- adventure_events 保存操作历史、完成／取消、奖励、计奖依据、快照和成功请求回执。

所有业务写入通过后端专用数据库事务 RPC。事务锁账户行、查成功回执、核对 expectedVersion，在同一提交中写当前实体、事件、total_xp 和 revision。事件不可物理删除；完成取消只逻辑失效指定完成事件及其内嵌奖励，旧 requestId 重试仍能读回历史回执。等级、成就、本级进度和操作能力实时计算，不单独存表。

## 关键取舍

五表比单行 JSON 提供真实外键、索引和按记录读取；比十表减少安排、完成、奖励、达成和回执的辅助表。任务表只保留当前执行日期，改期历史交给 events；目标达成字段并入 goals，计奖行动 ID 冻结在目标行与 goal_achieved 事件中。任务奖励直接冻结于 task_completed，目标奖励直接冻结于 goal_achieved；奖励依附完成或达成，没有独立生命周期，因此不另建奖励事件。

Worker → Supabase PostgREST → PostgreSQL RPC 保持为事务调用链。Worker 只验证身份、请求及响应并映射错误；PostgreSQL 在单次函数调用内持有账户行锁、核对版本及请求幂等，统一提交或回滚，不增加应用层事务管理器或 KV 锁。

账户 total_xp 是有效 task_completed／goal_achieved 的冻结 amount 汇总，必须由事务与事件同步更新并可核对；不是另一套独立账本。历史奖励与完成事件不能按“当前有效”过滤后再做幂等查询，否则已取消完成可能被旧请求重新发奖。

独立主线与 inbox 按首次需要创建并复用，不预建；独立任务仍有关联 goal_id，但页面展示为独立任务。inbox 不参与真实目标生命周期、聚焦、成就或目标奖励。保留账户级版本，拆表不自动解决同账户并发冲突。

## 范围

字段见 [数据库设计](../adventure/backend-database.md)，事务见 [业务逻辑](../adventure/backend-business-logic.md)。空库依次执行 `db/adventure/create-planning.sql` 与 `db/adventure/list-tasks.sql`；已有五表库使用 `db/adventure/migrations/20261106200055_adventure_today_task_rules.sql`，同一事务替换任务规则函数、补充日期列表索引／RPC与权限并刷新 PostgREST schema，不删除或改写业务行，不重复初始化。

该增量迁移为已存在五表和历史数据提供兼容升级，取代早期“未上线阶段不保留升级脚本”的范围说明。五表结构、账户锁、事件和历史成功回执继续保留；旧任务结束／独立改期／独立迁移不接受新请求，旧成功封套仍可重放。接口及验证见 [接口契约](../adventure/planning-api.md) 和 [今日聚焦验收](../adventure/qa-today.md)。生产升级与发布授权单独核对；本轮不重建旧单表，不导入或清理真实业务数据，首页 tasks／schedules 不变。
