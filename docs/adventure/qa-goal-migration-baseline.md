# 非空旧库迁移验收基线（#169）

此夹具只含合成数据，必须运行于新建的隔离 PostgreSQL；不连接、读取或修改生产数据。`tests/support/run-goal-migration-baseline.mjs` 自建临时目录和随机本机端口，忽略 `PG*` 环境变量，结束时停止数据库并删除临时目录。需要本机 PostgreSQL 的 `initdb`、`pg_ctl` 和所需动态库；项目现有 `pg` 依赖负责连接。

旧库结构固定在 `tests/database/legacy-goal-migration/`，使新库初始化变更后仍能用真实旧结构及旧 RPC 生成夹具。传入迁移脚本时，验收还会在同一隔离集群创建新库，比较新库和升级库的结构及安全属性。

```sh
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH \
POSTGRES_BIN=<postgres-bin目录> LD_LIBRARY_PATH=<postgres动态库目录> \
npm run test:goal-migration-baseline
```

当升级 SQL 可用时，在同一隔离集群执行实际迁移、对账并再次执行：

```sh
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH \
POSTGRES_BIN=<postgres-bin目录> LD_LIBRARY_PATH=<postgres动态库目录> \
npm run test:goal-migration-baseline -- --migration db/adventure/migrations/<升级脚本>.sql
```

`capture(client, { legacy: true })` 在迁移前读取五表全部列，`capture(client)` 在迁移后读取四表；`reconcile(before, after)` 返回逐 owner／稳定 ID 的差异。它比较保留字段、嵌套历史、计算依据、回执、冻结奖励、revision 和 total_xp，检查分类映射、有效奖励总和与进行中目标顺序。历史中的主线字段按明确的结构化键递归清除，用户文本原样比较；不按主线名称做文本替换。目标 `mainline_ended` 原因预期转为 `ended`；任务中性原因默认 `historical_ended`，若迁移正式选定其他中性代码，调用者必须显式传入 `taskEndCause` 并同步脚本。`validateMappings` 可对异常旧映射进行前置探针；具体迁移仍须在自身事务中校验并拒绝异常映射。

夹具含三个合成账户、普通／独立主线、同名及相同创建时间与排序键、同组聚焦／未聚焦、独立目标与 inbox、各类终态、删除和旧结束任务、有效及已取消完成、目标达成和奖励、目标与任务迁移事件、纯主线事件以及嵌套快照和成功回执。前两个账户的固定 ID 便于定位，有效冻结奖励分别为 4 和 1；部分固定历史为直接插入，不代表完整操作流，其占位摘要不能用于重放。第三个账户通过旧 RPC 创建跨目标编辑、完成、取消完成和目标达成，生成真实嵌套 `actionSources`、冻结奖励、成功回执及摘要，并测试迁移、完成、取消和达成回执重放；RPC 生成的实体 ID 和发生时间随运行变化。负向测试逐项删除达成事件和目标达成快照中的来源字段，以及已取消完成回执、奖励计算和跨目标迁移事实，确保逐账户逐 ID 对账拒绝缺失。

`goal-migration-simulated-projection.sql` 仅为测试对账器生成模拟预期，不是迁移，也不证明迁移正确。测试检查多账户单目标及缺失、空值、非数值、负数、小数和超界排序键，并对身份、归属、顺序、奖励及版本进行负向篡改。提供 `--migration` 时，先在独立测试库分别构造无效主线引用、空白及过长标签和目标更新触发器故障；这些缺陷在测试库中通过临时放宽旧约束制造，要求迁移失败且五表数据及结构回滚。再在正常库执行升级、检查主线表被删除、对账和重复执行，比较重复前后数据、结构及安全属性；故障触发器要求迁移确实更新目标。任务原因不同于默认值时可在 `--migration` 之后追加 `--task-end-cause <中性原因>`。

验收基线与 #170 的内部协作契约：无效引用错误须包含独立标记 `GOAL_MIGRATION_INVALID_MAPPING`，空白或过长标签使用 `GOAL_MIGRATION_INVALID_LABEL`，并以空白分隔的 `owner=<uuid>`、`goal=<uuid>` 定位异常；错误内容只使用本次合成夹具的标识。#168 要求明确报告异常而未指定此格式；如迁移已有等价、稳定且不泄露敏感数据的结构化错误，应明确扩展验收器和对应负向测试，而不能接受任意 SQL 错误。无关的除零错误已在隔离库被拒绝。

结构快照覆盖隔离库 `public` 的表／视图／序列、列和默认值、约束、索引、函数、触发器、RLS 与策略、对象／列／schema 权限、默认权限、角色属性与成员关系，以及枚举和域。测试在事务内分别破坏 RLS、强制 RLS、表／列／schema／函数权限、角色、默认权限、策略、触发器、视图、索引和约束，确认重复执行使用的同一比较器逐项识别变化，并验证事务回滚恢复快照。此快照用于证明失败和重复执行前后相等，不代替迁移后权限是否正确、新库等价性及 HTTP 行为验收；生产迁移、上线、备份恢复及发布均不在范围内。

本工作树验证：PostgreSQL 17、Node.js 24 下 `npm run test:goal-migration-baseline` 通过；新增排序键、真实 RPC 夹具和结构快照测试均先观察红灯，再修复通过。以故意不完整的 `/tmp/goal169-expected-probes.sql` 测试 `--migration` 时，三个异常映射和注入故障的回滚探针通过，随后未升级数据被对账拒绝；以 `/tmp/goal169-unrelated.sql` 注入除零错误时，异常映射探针按预期失败。当前没有真正的新迁移 SQL，未验证真实升级的异常回滚或重复执行；沙箱内绑定端口返回 `EPERM`，隔离库通过批准的沙箱外进程运行。
