# 目标关系卡片

`GET /api/adventure?goalId=<uuid>&goalTaskPage=<页码>&pageSize=<容量>` 的 `goalDetail.relatedTasks` 是当前关联投影，项仅含 `id`、`title`、计划日期 `plannedOn` 和可空的完成时间 `completedAt`；`totalRelatedTasks` 是分页前总数。只包含同账户、当前归属该目标、未删除且状态为 pending 或 completed 的任务，顺序按计划日期、创建时间、ID，页码与 `goalTaskPage` 一致。账户共享锁覆盖整个 workspace 读取，因此目标、关联任务和返回的 `version` 属于同一版本。

`goalDetail.tasks`／`totalTasks` 保留历史投影，包含当前任务及发生时归属该目标的有效完成来源；它独立分页，不用于关系卡。奖励来源仍由 `/api/adventure/reward-source` 提供发生时快照。当前列表不应推导或替代历史奖励来源。

隔离数据库测试使用合成账户，覆盖当前归属、删除和分页、跨账户读取、版本冲突、待完成阻断、达成快照和奖励，以及旧规则下完成后迁出的历史来源；浏览器测试覆盖桌面和手机的关系卡、分页、关闭、焦点、终态及正式新建行动入口。不使用生产数据。
