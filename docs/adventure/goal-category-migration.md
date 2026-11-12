# 目标分类迁移（#170）

`db/adventure/migrations/20261111000000_goal_categories.sql` 升级现有五表人生冒险库；新库使用 `db/adventure/create-planning.sql` 和 `db/adventure/list-tasks.sql`。迁移与新数据库函数是一次协调切换的一部分：本分支已有新 Worker 和客户端适配，最终集成及兼容门禁仍待验证，不能单独部署数据库变更。生产迁移、备份恢复、合并和发布均需另行取得明确授权。

迁移持有五表写锁，在一个事务内校验旧引用、主线状态及标签，冻结逐账户逐 ID 的预期事实，迁移标签、顺序、事件与快照，替换结构和函数，检查保留事实及安全属性，最后提交并通知 PostgREST 刷新 schema。空白标签、孤立引用、经验不一致、含其他事实的主线事件、异常外键或索引和不安全权限均会中止事务；错误中的 owner、goal 或 event 标识用于定位异常，不包含自由文本。重复执行会检查最终结构和权限；测试中的失败注入均使用合成数据和全新隔离 PostgreSQL。

新库初始化和升级都核验 PUBLIC、`anon`、`authenticated`、`service_role` 及其可切换的角色继承链。服务角色只允许表上的 `SELECT`、`INSERT`、`UPDATE`，不允许 `DELETE`、`TRUNCATE`、`REFERENCES`、`TRIGGER`、PostgreSQL 17 的 `MAINTAIN` 或转授权；浏览器角色及 PUBLIC 不得持有表或列权限，也不得执行业务函数或创建 public schema 对象。异常直接授权、默认授权或继承授权导致 `GOAL_MIGRATION_UNSAFE_SECURITY` 并回滚；检查按角色成员关系保守处理，即使某条成员关系当前不能切换也可能拒绝。函数的服务角色转授权与可切换父角色的权限同样会被拒绝。

目标和任务保留稳定 ID 与关联；有效奖励总和、账户 revision 和 total_xp 不变。旧主线结束后的完成限制保存在完成事件的中性 `historical_lock` 中，旧完成／达成快照不会补写分类。非纯主线成功回执保留摘要并先于版本检查重放清理后的结果；纯主线事件及其回执被删除，旧主线命令不能新执行。调用方不能把旧 requestId 复用于其他命令。

新 Worker 的写命令要求请求头 `X-Adventure-Client-Version: goal-categories-1`；缺失或过期时返回 `CLIENT_UPDATE_REQUIRED`／426，提示刷新且不调用数据库。成功封套仍须以同一 requestId 和内容重试；该版本头不是认证，也不保护旧 Worker、数据库直连或部署窗口，外层冻结及旧地址封闭要求见 [维护窗口](qa-goal-integration.md)。

数据库接口变更：`adventure_planning_read(uuid,integer,integer,boolean)` 取代旧的六参数版本；`adventure_workspace_read(uuid,integer,integer,text,integer,text,text,uuid,integer,boolean)` 取代旧的十二参数版本；旧主线参数、主线命令和目标迁移候选不再支持。目标列表按账户内进行中目标顺序分页，再按终态时间倒序和 ID 显示终态；任务与成长投影不再包含主线字段。其余 RPC 的现有签名保留，调用方仍须按 #171–#173 更新响应类型和请求规则。

停用的 `endTask`、`rescheduleTask`、`migrateTask` 和主线命令在服务角色的检查、预览、能力和执行辅助函数中也不能作为新操作执行。任务编辑候选使用只读的 `taskDestination` 内部检查，原有编辑归属与改期仍通过 `editTask` 完成；历史成功回执依旧先于命令资格和版本检查重放。

服务角色可调用的任务、目标达成和目标结束 `apply` 函数仅接受各自对应的命令类型，并统一转入规划事务入口处理账户锁、请求回执和版本；外部传入的时间参数不用于执行，时间由事务入口取得。直接调用辅助函数仍需遵守同一账户、幂等和原子提交规则。

上线前需在维护窗口阻止旧客户端及其他写入，盘点实际数据库对象和异常映射，备份并验证恢复，然后验证完整的新 Worker／客户端和数据库版本可以一起切换。若无法原子切换，先验证阻止旧客户端写入的兼容方案；回退前停止写入并评估迁移后的新增数据，不能直接覆盖新数据。备份中的旧历史不等于在线数据已清除，恢复旧备份后还需重新执行并验证清理。

本地验收使用 [非空旧库迁移验收基线](qa-goal-migration-baseline.md)：

```sh
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH \
POSTGRES_BIN=<postgres-bin目录> LD_LIBRARY_PATH=<postgres动态库目录> \
npm run test:goal-migration-baseline -- --migration db/adventure/migrations/20261111000000_goal_categories.sql
```

该脚本只创建本机临时集群和合成数据，不接受现有数据库地址。它验证异常映射、早晚故障回滚、逐 ID 对账、重复执行、新库等价、服务端权限、历史锁定和回执，以及新库数据库函数的基础行为；它不代替真实 HTTP、浏览器、生产备份恢复及发布验收。
