# #126 旧账户名称列清理

本次前向结构迁移删除 `public.ledger_entries.account_name` 和 `ledger_entries_account_name_check`、`ledger_entries_account_name_snapshot`，将 `account_id` 设为非空。`ledger_entry_immutable` 只去掉两处旧记录字段，仍保护其余事实、逻辑删除终态并拒绝物理删除。账户名称及页面/API 的 `accountName` 保持原接口，从关联账户的当前 `name` 返回，符合 ADR 0007。

可执行材料为 [20261105002135_remove_legacy_ledger_account_name_v1.sql](../../db/ledger/migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql)。文件名先由 Supabase CLI `migration new remove_legacy_ledger_account_name_v1` 生成，再按现有仓库组织放在 `db/ledger/migrations/`。没有新增通用迁移执行器、业务 RPC 或永久表。

## 安装与历史阶段

当前空库按以下顺序完整安装，最后再运行当前数据库探针和 HTTP 回归：

`create-ledger.sql → list-ledger.sql → refunds.sql → delete.sql → accounts.sql → account-entries.sql → transfers.sql → migrations/20261105002135_remove_legacy_ledger_account_name_v1.sql`。

前七个历史 SQL 不改写。已完成归属的存量库只追加最后一个文件；旧名称必须全部为 `NULL`，包括已删除流水，且所有流水已有 `account_id`。不固定行数或 owner，不新建账户或修改余额、版本；期间新增的合法已归属流水同样保留。

`maintenance/legacy-backfill.sql` 及原私有参数属于 #123/#124 的已执行历史阶段；删列后不再重放。历史两表 SQL 探针保存在 `tests/database/legacy/`，未归属 fixture 只供历史专项；`run-ledger-backfill.mjs` 在旧结构阶段运行它们。当前账户/流水/转账探针及 Worker HTTP 测试均在最后删列后的结构运行。

## 执行前核对与事务

生产执行由独立任务在固定评审提交、独立双轴评审和 CI 后处理。先读取迁移历史与目录，重核旧名非空和账户标识为空的数量均为零、只有批准的依赖，确认触发器启用、函数定义/安全上下文/权限、四表 RLS/ACL/外键及业务数据摘要。

用 [原只读目录查询](../../db/ledger/maintenance/legacy-backfill-catalog.sql) 在 `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC'; … COMMIT;` 中核对。PG17 干净安装的旧目录 SHA-256 为 `04898ad1a371ac32cb793acbf9aeaa93631d41a1d9acebcfd0c05e0e42e21e9c`，删列后为 `a022cf8559153d2dcdbf9810a212138cd61595d29dac0054bf565f462a9fe272`。时区固定为 UTC，以稳定 CHECK 中时间常量的反解析；版本、角色、权限或定义差异须审查，不直接替换预期 hash。

协调者通过 Supabase **`apply_migration`**，使用 `remove_legacy_ledger_account_name_v1` 名称和该文件的全部 SQL 一次提交；含 DDL 的迁移不能使用 `execute_sql`。脚本无私有参数。本次实现仅执行本机隔离测试。

脚本在一个 `BEGIN … COMMIT` 中：

1. 设置锁等待 5 秒、语句上限 30 秒；依次锁 `ledger_owner_revision → ledger_accounts → ledger_entries → ledger_balance_adjustments` 的 `ACCESS EXCLUSIVE`，等待已有业务事务并短暂阻挡财务读写。
2. 检查旧列存在、旧名全空/全部归属，严格匹配已审阅旧目录。未知 CHECK/索引/触发器/权限等拒绝；外部视图依赖由 `DROP … RESTRICT` 拒绝，整个事务回滚。`RESTRICT` 本身仍会自动删除本表索引，所以前置完整目录校验不可省略。
3. 保存四表完整行 JSON 的有序摘要，仅流水排除已确认为空的旧列。用 `pg_get_functiondef` 保留函数完整属性，替换两处旧字段后 `CREATE OR REPLACE`，保留 owner、ACL 及其他属性；不禁用触发器。
4. 显式删除两个 CHECK、设置非空、删除旧列；再次比较数据摘要和批准的最终目录。余额、修正记录、所有者版本以及全部其他流水字段保持原值。

脚本不捕获异常为成功，不使用 `CASCADE`，不执行任何业务 DML。提交前任何故障会撤销函数、约束、列及其他事务变更；失败会话先 `ROLLBACK`。超时或异常后不自动扩大范围。

## 未知结果与回退

响应丢失先只读查询 Supabase 迁移历史、列状态、函数、约束、目录和业务摘要。再次运行会拒绝已删列状态，不修改数据；不能将重复执行当作结果查询。只有确认旧结构完整且本次未提交，才重新安排同一审阅文件执行。

提交成功后，应用接口保持兼容，代码回退不应重放旧 SQL。需要恢复结构时单独审阅逆向 DDL；不得把业务流水、账户余额或版本恢复到先前值，也不撤销已完成的账户归属。原空列已移除，当前账户名称仍由账户表维护。

## 本机验证

```sh
# POSTGRES_BIN 指向 PG17 bin；需要时设置 LD_LIBRARY_PATH 和 POSTGREST_BIN。
npm run test:ledger-cleanup
npm run test:database -- --ledger
# 只用于历史阶段重现，和当前回归分开：
node tests/support/run-ledger-backfill.mjs
```

两个执行器都新建随机 `127.0.0.1` PG 实例，不接受已有数据库 URL。清理专项验证空库与非空库升级、完整行/目录的精确预期差异、所有函数属性与权限保留、残留旧名（包括空字符串）、未归属、未知索引/CHECK/视图、停用保护和函数上下文漂移拒绝、五个 DDL 阶段/数据变更/最终校验故障全回滚及重复执行拒绝。当前 SQL 探针验证全部不可变字段、非空、同所有者外键、逻辑删除保留、ACL/RLS 和转账配对；现有 HTTP 套件验证改名现名、修正、收支、退款、删除、转账及重试/并发规则。

未提供数据库时默认门控跳过不能算真实通过。生产执行渠道、必需 CI 及独立双轴评审由后续任务分别记录。本次没有 UI 改动，不另做人工 UI 验收。

机制参考：[PG17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)、[CREATE FUNCTION 属性/owner/ACL](https://www.postgresql.org/docs/17/sql-createfunction.html)、[Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations)。实施时核对了 [Supabase changelog](https://supabase.com/changelog) 及 [CLI v3 变更](https://supabase.com/changelog/supabase-cli-v3)；v3 默认指向本机，托管写入另有确认规则，本任务未运行托管写命令。
