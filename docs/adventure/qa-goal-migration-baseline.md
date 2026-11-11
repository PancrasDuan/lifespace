# 非空旧库迁移验收基线（#169）

此夹具只含合成数据，必须运行于新建的隔离 PostgreSQL；不连接、读取或修改生产数据。`tests/support/run-goal-migration-baseline.mjs` 自建临时目录和随机本机端口，忽略 `PG*` 环境变量，结束时停止数据库并删除临时目录。需要本机 PostgreSQL 的 `initdb`、`pg_ctl` 和所需动态库；项目现有 `pg` 依赖负责连接。

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

夹具含两个账户、普通／独立主线、同名及相同创建时间与排序键、同组聚焦／未聚焦、独立目标与 inbox、各类终态、删除和旧结束任务、有效及已取消完成、目标达成和奖励、目标与任务迁移事件、纯主线事件以及嵌套快照和成功回执。固定 ID 便于定位；账户各自的有效冻结奖励之和分别为 4 和 1。旧完成回执使用真实命令摘要，测试包含已取消完成的重放及不同摘要冲突。夹具为直接插入的合成历史，不代表来自真实账户的完整操作流。

`goal-migration-simulated-projection.sql` 仅为测试对账器生成模拟预期，不是迁移，也不证明迁移正确。该测试还对模拟结果中的身份、归属、顺序、奖励及版本进行负向篡改，在隔离事务内测试普通写入回滚，并重复运行对账。提供 `--migration` 时，先在两个独立测试库中分别构造无效主线引用和目标更新触发器故障，要求迁移失败并核对五表数据及主要结构回滚，再在正常库执行升级、检查主线表被删除、对账和重复执行；故障触发器要求迁移确实更新目标。任务原因不同于默认值时可在 `--migration` 之后追加 `--task-end-cause <中性原因>`。无效映射探针只能证明失败及回滚，需结合错误内容判断是否明确报告映射问题。权限、新库等价性及 HTTP 行为仍需另行验收；生产迁移、上线、备份恢复及发布均不在本基线范围内。

本工作树验证：PostgreSQL 17 隔离运行、Node.js 24；`npm run test:goal-migration-baseline` 通过。TDD 红灯分别为 fixture、模拟预期和对账模块尚不存在，以及映射校验导出尚未实现；随后对应测试通过。沙箱内绑定本机端口返回 `EPERM`，使用批准的沙箱外进程运行临时库。用 `/tmp/goal169-fake-migration.sql` 中故意不完整的合成迁移测试 `--migration`：异常映射及注入故障的旧数据和结构回滚探针通过，随后逐 ID 对账按预期失败，证明未升级的库不会误报通过。当前没有真正的新迁移 SQL，故未验证真实升级的异常回滚或重复执行。
