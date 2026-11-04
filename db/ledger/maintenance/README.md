# 一次性旧流水归属回填（#123 / #124）

仅用于已批准的同一所有者、三个原名账户及 12／1／1 条有效普通旧支出。三个初始余额固定为 **0 分**，原支出不再扣减余额；以后删除旧支出仍按现行业务规则回加。公开材料只使用合成信息，真实映射留在私有执行记录。

交付是 `legacy-backfill.sql` 模板、只读目录查询、一个生成字面量 SQL 的脚本及隔离数据库测试。应用不会自动执行它；没有新增永久表、公开 RPC 或业务规则。

## 参数与可执行 SQL

私有 JSON 文件权限必须为 `0600`，结构如下（示意只列出数组格式，实际必须填满 14 个精确 ID）：

```json
{
  "ownerId": "12400000-0000-4000-8000-000000000001",
  "revision": 14,
  "catalogHash": "经审核的目录 SHA-256",
  "groups": [
    { "name": "合成银行卡", "requestId": "12400000-0000-4000-8001-000000000001", "entryIds": ["12 个合成流水 UUID"] },
    { "name": "合成钱包", "requestId": "12400000-0000-4000-8001-000000000002", "entryIds": ["1 个合成流水 UUID"] },
    { "name": "合成现金", "requestId": "12400000-0000-4000-8001-000000000003", "entryIds": ["1 个合成流水 UUID"] }
  ]
}
```

`name` 同时是清单批准的原名和新账户名，须已按 `ledger_trim` 规范化。`requestId` 是每组固定的开户请求号，在第一次准备私有材料时生成并保留，后续重试不得换号。新账户 ID 由数据库生成；开户摘要与 `ledger_account_create` 一致：规范化 `{"name": name, "balanceCents": 0}` 的 JSONB 文本 UTF-8 SHA-256。不得用可改名的账户名称识别执行结果。

```sh
/home/lighthouse/.nvm/versions/node/v24.22.1/bin/node \
  scripts/render-ledger-backfill.mjs /tmp/private-input.json /tmp/private-backfill.sql
```

生成器只写 `/tmp` 下新文件，权限 `0600`，输出 SQL 的 SHA-256，不输出参数，不覆盖原文件，也不连接数据库。生成结果已嵌入目录查询和转义后的私有 JSON，是完整的 `BEGIN … COMMIT` SQL；无需 psql 宏、客户端变量或额外会话。原模板含占位符，不能直接执行。

## 执行前只读核对

1. 固定已评审提交，确认必需 CI、独立双轴评审及协调者执行派发完成；沿用 #123 已确认的具体映射授权。
2. 在干净 PostgreSQL 17 库按 `create-ledger.sql → list-ledger.sql → refunds.sql → delete.sql → accounts.sql → account-entries.sql → transfers.sql` 安装。独立运行下述隔离套件，保存本次本机目录摘要。
3. 通过 Supabase 只读查询在同一调用中执行 `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;`，接入 `legacy-backfill-catalog.sql` 的完整查询，然后 `COMMIT;`。摘要涵盖四表字段、ACL/RLS/策略、约束、索引、全部触发器（含内部 FK）及账单函数的定义、安全上下文和权限。忽略自动生成 FK 触发器名称中的 OID，其他差异均会拒绝；PostgreSQL 版本、角色或反解析格式差异也可能导致拒绝，须逐项审查，不能直接把未知线上摘要当作批准值。
4. 用私有清单重新只读核对 owner、revision、14 个精确 ID 与三组原名、无账户／修正记录、无退款／转账／已删除／额外旧流水，保留仅含摘要及映射的私有执行证据。原盘点结果会过时；脚本在取得全部锁后再次检查这些条件。
5. 真实名称、owner、请求号及流水 ID 只进入 `0600` 的私有 JSON/SQL；不提交、不上传为附件，不粘贴到 Issue/PR 或公开日志。

## 受控执行与事务边界

协调者后续通过 **Supabase `apply_migration`**，用描述性迁移名称及生成文件的**全部内容**作为 `query` 一次提交；含 `ALTER TABLE` 的执行不得用 `execute_sql`。本任务只做本地实现和验证，不调用生产写工具。字面量 SQL 含私有映射，执行请求及 Supabase 内部迁移历史也须按私有材料处理。

短事务按 `ledger_owner_revision → ledger_accounts → ledger_entries → ledger_balance_adjustments` 顺序取得 `ACCESS EXCLUSIVE` 表锁，再锁目标 owner 行。这样等待既有 RPC 完成，也暂时阻挡所有 owner 的财务读写；默认锁等待上限 5 秒、单语句上限 30 秒。超时即中止，不自动延长或扩大范围。

原态必须完全符合清单及版本才创建三个零余额账户。事务仅停用 `ledger_entries.ledger_entry_immutable`，回填精确行的 `account_id` 并清空 `account_name`；不调用开户／流水／余额修正 RPC。随后强制 `SET CONSTRAINTS public.ledger_transfer_pair IMMEDIATE` 执行待触发事件，再恢复原不可变触发器为 `O` 并恢复延迟模式。其余 CHECK/FK、RLS、ACL、函数及触发器持续保持。

提交前比对所有原流水除两列以外的完整行摘要，检查三个零余额、无新流水或修正、精确映射、目录保护不变和 owner 创建信息不变；owner 版本只加一次。异常不捕获为成功，整个事务的数据及触发器 DDL 一起回滚。执行日志只报告 `BACKFILL_APPLIED` 或 `BACKFILL_ALREADY_COMPLETE`。

## 未知结果、重试与回退限制

响应丢失时先用私有参数只读核查三个固定开户 `request_id/request_hash`、14 个 ID 的同 owner 归属和 `account_name IS NULL`、owner 版本及目录保护；不要立即换请求号重跑。

完整已完成态允许后续合法改名、余额修正、新流水、退款及逻辑删除。原 SQL 再执行会 no-op，既不重置余额／名称／删除状态，也不再推进版本。版本必须至少是原版本加一；部分开户、部分回填、摘要或映射矛盾均拒绝，不自动补齐。后续受控读取用于验收现名、精确归属和版本；账户若已有正常业务变化，不能再断言其当前余额仍为零。

提交前失败可整段回滚，若客户端仍持有失败事务须先 `ROLLBACK`。提交成功后的逆向迁移不能当作普通代码回滚：旧流水已恢复可见，账户可能已有交易、改名、修正或删除，不能清零、删除账户或批量撤销归属。保留私有原名映射和执行证据；需回退时重新盘点并审阅单独的数据修复方案。

## 隔离验证

```sh
# 指向可用 PostgreSQL 17 的 bin；如使用解包版，另配置其库搜索路径。
export POSTGRES_BIN=/path/to/postgresql/17/bin
/home/lighthouse/.nvm/versions/node/v24.22.1/bin/node tests/support/run-ledger-backfill.mjs
```

测试不接受数据库 URL，始终 `initdb` 新集群、随机 `127.0.0.1` 端口并在结束后停止／清理自己的集群；不复用任何验收库。安装全部现有账单 SQL，业务调用通过真正的 `service_role` RPC，未模拟事务、回滚或锁。

覆盖精确 12／1／1、身份财务字段保留、零余额／一次版本推进、受控列表详情、保护恢复、即刻及业务修改后重试、删除回加与重删、版本／精确 ID／原名／目录／范围漂移、跨 owner、混合和名称冲突状态、回填中及恢复前后故障全回滚、未执行延迟事件时恢复失败、两个方向的真实锁等待及 SQL 字面量转义。测试故障只注入测试中的 SQL 副本，正式脚本没有故障开关。

机制参考：[PostgreSQL 17 SET CONSTRAINTS](https://www.postgresql.org/docs/17/sql-set-constraints.html)、[ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)、[显式锁](https://www.postgresql.org/docs/17/explicit-locking.html)、[Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations)。本机测试不能证明 Supabase 执行渠道和生产环境已验收；生产结果须由后续派发独立核验。
