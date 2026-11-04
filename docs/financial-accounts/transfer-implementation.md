# 关联转账实施与结构升级

#121 基于已集成 #120 的 `1eb2d9c2e8f5f8d011f4a6e304bc19e9f9badb9b`，保持四表结构。正式页面提供账户区与单账户转账入口、转账后余额预览、对侧详情跳转和整笔转账删除。

`POST /api/ledger/transfers` 接收 `requestId`、`fromAccountId`、`toAccountId`、正整数分 `amountCents`、UTC 秒精度 `occurredAt` 及可选 `note`，返回 `{ transferId, outEntryId, inEntryId, version, deleted }`。所有者由 Worker 核验并注入；两个账户必须不同且属于本人，余额可以为零或负数，联动结果须在 ±99,999,999,999 分内。

`ledger_transfer` 取得所有者写锁后，创建支出／`transfer_out` 和收入／`transfer_in` 两行，分别更新余额，仅推进一次版本。转出行使用客户端原请求号，转入行使用数据库生成的内部请求号，两行共享数据库生成的 `transfer_id`。原号重试核对两个账户、金额、时间和规范化备注，返回原组；不同输入拒绝，已删除组不复活。分类新增仅限这两项，`direction` 保持收入／支出。

数据库类别约束、同组方向唯一索引及延迟配对约束共同保证同所有者、两个不同账户、等额相反、时间与备注一致、两侧删除状态一致；已有不可变字段保护包含账户与组标识。普通新建不能写转账分类，退款拒绝转账父流水。详情和删除预览均返回可空 `transferEntry`。删除范围摘要绑定所有者与实际影响流水标识，无关收支或账户修改不使确认失效；从任意一侧删除均撤销两边余额，重复删除不改余额或版本。

## 安装与回退边界

完整空库安装顺序：`create-ledger.sql` → `list-ledger.sql` → `refunds.sql` → `delete.sql` → `accounts.sql` → `account-entries.sql` → `transfers.sql`，均位于 `db/ledger/`。已有 #120 结构的环境只追加 `transfers.sql`；脚本是一次性升级，执行前核对结构，和匹配的 Worker／前端版本协调发布。隔离测试执行器已按该顺序重放并运行权限与配对探针。

脚本不回填旧流水、不创建转账表、不修改旧名称内容。旧未归属流水继续隐藏。生产结构执行、合并 main、发布及旧数据回填仍需另行授权，本任务仅在临时隔离数据库执行 SQL。

发布异常时先停止不兼容写入并协调回退；保留账户余额、转账组、配对约束和受控 RPC，不恢复仅支持单条删除的旧写入函数，也不删除字段／事实。若需撤销某笔转账，使用整组删除接口；不能以结构回滚或单侧修补替代余额事务。具体生产恢复操作须按届时数据状态核验并获授权。

## 验证接缝

沿用正式页面 → 真实 Worker → 隔离 PostgreSQL/PostgREST，仅替换测试身份、数据库地址及定点传输／写入故障。转账 HTTP 行为见 `tests/api/ledger-transfers-database.test.ts`，桌面、手机与未知结果恢复见 `tests/browser/ledger-transfers-database.spec.ts`，结构与权限探针见 `tests/database/ledger-transfers.sql`。默认 CI 缺少本机数据库时的跳过不计通过；必须显式运行 `npm run test:database -- --ledger --browser`。
