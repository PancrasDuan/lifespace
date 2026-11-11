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
npm run test:goal-migration-baseline -- --migration db/adventure/migrations/20261111000000_goal_categories.sql
```

`capture(client, { legacy: true })` 在迁移前读取五表全部列，`capture(client)` 在迁移后读取四表；`reconcile(before, after)` 返回逐 owner／稳定 ID 的差异。它比较保留字段、嵌套历史、计算依据、回执、冻结奖励、revision 和 total_xp，检查分类映射、有效奖励总和与进行中目标顺序。历史中的主线字段按明确的结构化键递归清除，用户文本原样比较；不按主线名称做文本替换。目标 `mainline_ended` 原因预期转为 `ended`；任务中性原因默认 `historical_ended`，若迁移正式选定其他中性代码，调用者必须显式传入 `taskEndCause` 并同步脚本。`validateMappings` 可对异常旧映射进行前置探针；具体迁移仍须在自身事务中校验并拒绝异常映射。

夹具含四个合成账户、普通／独立主线、同名及相同创建时间与排序键、同组聚焦／未聚焦、独立目标与 inbox、各类终态、删除和旧结束任务、有效及已取消完成、目标达成和奖励、目标与任务迁移事件、纯主线事件以及嵌套快照和成功回执。前两个账户的固定 ID 便于定位，有效冻结奖励分别为 4 和 1；部分固定历史为直接插入，不代表完整操作流，其占位摘要不能用于重放。第三个账户通过旧 RPC 创建跨目标编辑、完成、取消完成和目标达成，生成真实嵌套 `actionSources`、冻结奖励、成功回执及摘要，并测试迁移、完成、取消和达成回执重放；第四个账户通过旧 RPC 先完成任务、迁移目标、再结束旧主线，验证原本不可取消的完成在迁移后仍锁定，而其他可取消完成不被锁定。对账要求每条完成记录的 `historical_lock` 等于迁移时旧完成关联主线是否已结束，不把该字段当作可忽略的差异；RPC 生成的实体 ID 和发生时间随运行变化。负向测试逐项删除达成事件和目标达成快照中的来源字段，以及已取消完成回执、奖励计算和跨目标迁移事实，确保逐账户逐 ID 对账拒绝缺失。

`goal-migration-simulated-projection.sql` 仅为测试对账器生成模拟预期，不是迁移，也不证明迁移正确。测试检查多账户单目标及缺失、空值、非数值、负数、小数和超界排序键，并对身份、归属、顺序、奖励及版本进行负向篡改。提供 `--migration` 时，先在独立测试库分别构造无效主线引用、空白及过长标签和目标更新触发器故障；这些缺陷在测试库中通过临时放宽旧约束制造，要求迁移失败且五表数据及结构回滚。再在正常库执行升级、检查主线表被删除、对账和重复执行，比较重复前后数据、结构及安全属性；故障触发器要求迁移确实更新目标。任务原因不同于默认值时可在 `--migration` 之后追加 `--task-end-cause <中性原因>`。

验收基线与 #170 的内部协作契约：无效引用错误须包含独立标记 `GOAL_MIGRATION_INVALID_MAPPING`，空白或过长标签使用 `GOAL_MIGRATION_INVALID_LABEL`，并以空白分隔的 `owner=<uuid>`、`goal=<uuid>` 定位异常；错误内容只使用本次合成夹具的标识。#168 要求明确报告异常而未指定此格式；如迁移已有等价、稳定且不泄露敏感数据的结构化错误，应明确扩展验收器和对应负向测试，而不能接受任意 SQL 错误。无关的除零错误已在隔离库被拒绝。

结构快照覆盖隔离库 `public` 的表／视图／序列、列和默认值、约束、索引、函数、触发器、RLS 与策略、对象／列／schema 权限、默认权限、角色属性与成员关系，以及枚举和域。测试在事务内分别破坏 RLS、强制 RLS、表／列／schema／函数权限、角色、默认权限、策略、触发器、视图、索引和约束，确认重复执行使用的同一比较器逐项识别变化，并验证事务回滚恢复快照。此快照用于证明失败和重复执行前后相等，不代替迁移后权限是否正确、新库等价性及 HTTP 行为验收；生产迁移、上线、备份恢复及发布均不在范围内。

#170 在 PostgreSQL 17、Node.js 24 的隔离合成库中验证实际升级脚本：异常映射、异常外键／索引／权限、静默改写和早晚故障注入均回滚；逐账户逐 ID 对账、重复执行、新库结构及权限等价、回执重放和历史锁定检查通过。新库还检查分类快照、独立任务、服务端权限、旧命令拒绝及并发版本。HTTP／浏览器适配和生产迁移、备份恢复及发布不属于此脚本的验证范围。具体切换与回退注意事项见 [目标分类迁移](goal-category-migration.md)。

独立复审修复补充了 PUBLIC、`anon`、`authenticated`、`service_role` 的全部 PostgreSQL 17 表权限、列级 `REFERENCES`、转授权以及只能通过 `SET ROLE` 使用的父角色权限矩阵；部分场景以真实角色执行 `TRUNCATE`、创建触发器或外键，再回滚测试操作。新库默认继承异常授权时的初始化和新库／旧库出现异常授权时的迁移均需失败并恢复原结构及数据。`tests/database/goal-retired-command-regression.sql` 在新库和升级库以 `service_role` 检查已停用命令的各辅助入口、无副作用及回执优先；旧库夹具另通过旧 RPC 生成停用命令的真实成功回执。

## 原五表数据库回归的清点

`npm run test:database` 当前仍以新初始化执行旧五表测试。它在 `tests/database/adventure-planning.sql` 的第一条预览请求中传入旧目标 `destination`，新数据库按退役契约返回 `INVALID_COMMAND`，测试运行器随即停止；后面的旧 SQL、旧升级测试及 HTTP 测试尚未运行，不能将该命令报告为通过。

| 旧测试 | 已退役或待集成的契约 | 新数据库回归继续验证的行为 |
| --- | --- | --- |
| `adventure-planning.sql` | 主线对象、目标的 `destination`、`mainlines`、`independent` 投影 | 预览不写入、目标创建编辑、账户隔离、版本及幂等冲突、经验不一致回滚和权限 |
| `adventure-actions.sql` | 每组聚焦配额、按主线／聚焦排序、单独任务结束 | 完成、取消、再次完成、冻结奖励、跨日限制、进度及日期筛选、失败回滚、历史终态锁定 |
| `adventure-goals.sql` | 目标主线归属、目标聚焦命令 | 达成系数与行动来源、当前关联任务和历史奖励来源分离、两种终态锁定、回执与经验 |
| `adventure-migrations.sql` | 目标跨主线迁移及其候选，新请求独立任务迁移 | 旧目标迁移回执重放、任务编辑改变归属、身份与历史保留、账户隔离 |
| `adventure-lifecycle.sql` | 结束主线及其传播、单独结束任务 | 未完成任务阻断、目标终态只读、任务删除、结束／达成故障回滚 |
| `adventure-reschedule.sql` | 独立改期命令的新请求 | 在任务编辑中改期、安排历史、跨日取消限制及旧成功回执重放 |
| `adventure-growth.sql` | 含主线字段的旧投影 | 有效冻结奖励、成长和来源、已取消记录、经验一致性、函数权限 |
| `adventure-today-upgrade-before.sql`／`after.sql` | 在新四表库上再次运行旧五表升级 | 旧五表固定夹具、旧规则 RPC 历史及 #170 非空升级由本基线独立验证 |

`tests/database/goal-post-migration-regression.sql` 对新库与升级库分别运行相同合成 RPC 回归，所有测试行及故障触发器在事务结束时回滚。目标控制台、关系弹卡、任务和成长 API 的真实 HTTP 与浏览器回归仍需 #171、#172、#173 在新契约及客户端完成后改写并运行；目前旧 Worker 与新数据库不兼容。
