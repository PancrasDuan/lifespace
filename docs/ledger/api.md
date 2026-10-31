# 普通账单接口与后续扩展接缝

#91 的正式契约位于 `src/shared/ledger.ts`。所有接口均逐次核验现有登录身份与准入白名单，由 Worker 注入可信 owner，响应为 `Cache-Control: no-store`。浏览器角色没有两表及账单 RPC 权限，交易事实不提供修改接口。

| 接口 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/ledger/entries` | `requestId` UUID、`direction`、有符号整数分 `amountCents`、UTC 秒精度 `occurredAt`、`accountName`、`categoryCode`、`note` | `{ entryId, version, deleted }` |
| `GET /api/ledger/entries?page=1` | 页码默认 1，固定每页 30 | `{ items, total, page, pageSize: 30, version }` |
| `GET /api/ledger/entries/:id` | 本人流水标识 | `{ entry, parentEntry, refunds, version }` |

流水字段为 `id`、`direction`、`amountCents`、`occurredAt`、`accountName`、`categoryCode`、`note`、`parentEntryId`、`createdAt`、派生 `status`。普通流水的 `parentEntryId` 与详情 `parentEntry` 为 `null`，`refunds` 为 `[]`，`status` 为 `completed`。列表按 `occurredAt DESC, id DESC`，总数、列表和版本在同一事务锁内读取；空账户为版本 0，不创建元数据。首次写入安全建立版本行。

普通创建不接收 owner、状态、父标识或预期旧版本。所有请求使用严格字段校验。金额绝对值最大 `99_999_999_999` 分，非零且符号与方向一致；账户和备注 trim 后分别为 1–50、0–500 个 Unicode 码点。日期和显示固定北京时间，传输采用 UTC ISO 8601；服务端与数据库拒绝未来时间和非秒精度。元输入通过整数运算转为分。

同 owner 的创建先锁版本行，再按 `requestId` 查重；相同内容返回原 `entryId` 和当前版本，异内容返回 `REQUEST_ID_REUSED`，不同编号相同内容可以分别保存。唯一性覆盖已删除记录；旧请求返回 `deleted: true`，不回传交易正文、不复活记录。实际插入与版本递增原子完成。版本范围为 JavaScript 安全整数。

失败统一为 `{ error: { code, message } }`。稳定业务错误包括 `INVALID_ENTRY` / `INVALID_QUERY` / `FUTURE_TIME`（400）、`REQUEST_ID_REUSED`（409）、`NOT_FOUND`（404）、`LEDGER_UNAVAILABLE` / `SAVE_UNKNOWN`（503），另沿用现有 `AUTH_*`。未知数据库或传输故障不回传原始响应、输入或凭据；写请求在无法确认时返回 `SAVE_UNKNOWN`。页面仅在当前挂载期间保存待确认命令供显式重试，不自动重提、不写本地存储；确认成功后重读失败只重试读取。

数据库安装源为 `db/ledger/create-ledger.sql`，仅包含 `ledger_entries` 与 `ledger_owner_revision`。只在只读核对目标结构后安装一次；正式环境建表与部署由集成交付执行，本票只在全新隔离本机数据库执行。受控入口为 `ledger_create(p_owner, p_input)`、`ledger_list(p_owner, p_page)`、`ledger_detail(p_owner, p_id)`；均只授予 `service_role` 调用，内部显式限定 owner，原始交易字段由触发器保护。

#92 在此基础上增加 `startDate` / `endDate` 与可选 `version` 查询及版本变化行为；#93 实现退款命令并扩展派生状态和详情关联；#94 增加删除预览与原子删除。当前接口拒绝尚未交付参数，正式页面不展示这些操作入口。原型和既有设计文件保留作为后续交互依据。

可复用测试支持为 `tests/support/ledger-database.ts`，扩展现有执行器：

```sh
npm run test:database -- --ledger --browser
```

需显式配置 `POSTGRES_BIN`、`POSTGREST_BIN`，必要时配置 PostgreSQL 动态库路径。运行器创建独立临时库及端口、加载结构与事务权限探针、启动真实 PostgREST，最后停止进程并清理。`PLAYWRIGHT_PORT` 可隔离浏览器服务器端口，默认 5175；`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可选择本机 Chromium。缺少数据库地址时默认测试跳过，不能计为本票真实数据库通过。
