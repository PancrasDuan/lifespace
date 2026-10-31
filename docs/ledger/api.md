# 普通账单接口与后续扩展接缝

#91／#92 的正式契约位于 `src/shared/ledger.ts`。所有接口均逐次核验现有登录身份与准入白名单，由 Worker 注入可信 owner，响应为 `Cache-Control: no-store`。浏览器角色没有两表及账单 RPC 权限，交易事实不提供修改接口。

| 接口 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/ledger/entries` | `requestId` UUID、`direction`、有符号整数分 `amountCents`、UTC 秒精度 `occurredAt`、`accountName`、`categoryCode`、`note` | `{ entryId, version, deleted }` |
| `GET /api/ledger/entries?page=1` | 页码默认 1，固定每页 30；可选 `startDate`／`endDate` 与 `version` | `{ items, total, page, pageSize: 30, version }` |
| `GET /api/ledger/entries/:id` | 本人流水标识 | `{ entry, parentEntry, refunds, version }` |

流水字段为 `id`、`direction`、`amountCents`、`occurredAt`、`accountName`、`categoryCode`、`note`、`parentEntryId`、`createdAt`、派生 `status`。普通流水的 `parentEntryId` 与详情 `parentEntry` 为 `null`，`refunds` 为 `[]`，`status` 为 `completed`。列表按 `occurredAt DESC, id DESC`，总数、列表和版本在同一事务锁内读取；空账户为版本 0，不创建元数据。首次写入安全建立版本行。

日期查询使用合法的 `YYYY-MM-DD`，起止同时提供且起始不晚于结束；全部时间同时省略。数据库将 `Asia/Shanghai` 开始日零点至结束日次日零点转为左闭右开区间，固定包含首尾自然日。非法日期、反向范围、重复参数及未知字段在 Worker 中拒绝，不调用查询。`version` 为可选的非负安全整数；与当前 owner 版本不符时返回 `LIST_CHANGED`（409），不附带条目。列表在共享锁内先核对版本，再读取总数和条目，同 owner 写事务持有排他锁；不同 owner 独立。

正式页默认全部时间第一页；今天、含今天的 7 天／30 天按北京时间计算。双日历维护临时草稿，本周／本月只填草稿，应用后开始新浏览；关闭时丢弃。查询缓存包含 owner、日期、页码及浏览会话，取消和迟到响应不会覆盖当前条件。翻页、重新聚焦与手动刷新携带已读版本；冲突提示列表已更新，保留日期并重新读取第一页，表单保持。普通保存成功开始全部时间的新浏览；浏览器刷新和重新进入不持久恢复筛选。

普通创建不接收 owner、状态、父标识或预期旧版本。所有请求使用严格字段校验。金额绝对值最大 `99_999_999_999` 分，非零且符号与方向一致；账户和备注 trim 后分别为 1–50、0–500 个 Unicode 码点。日期和显示固定北京时间，传输采用 UTC ISO 8601；服务端与数据库拒绝未来时间和非秒精度。元输入通过整数运算转为分。

同 owner 的创建先锁版本行，再按 `requestId` 查重；相同内容返回原 `entryId` 和当前版本，异内容返回 `REQUEST_ID_REUSED`，不同编号相同内容可以分别保存。唯一性覆盖已删除记录；旧请求返回 `deleted: true`，不回传交易正文、不复活记录。实际插入与版本递增原子完成。版本范围为 JavaScript 安全整数。

失败统一为 `{ error: { code, message } }`。稳定业务错误包括 `INVALID_ENTRY` / `INVALID_QUERY` / `FUTURE_TIME`（400）、`REQUEST_ID_REUSED` / `LIST_CHANGED`（409）、`NOT_FOUND`（404）、`LEDGER_UNAVAILABLE` / `SAVE_UNKNOWN`（503），另沿用现有 `AUTH_*`。未知数据库或传输故障不回传原始响应、输入或凭据；写请求在无法确认时返回 `SAVE_UNKNOWN`。页面仅在当前挂载期间保存待确认命令供显式重试，不自动重提、不写本地存储；确认成功后重读失败只重试读取。

数据库依次安装 `db/ledger/create-ledger.sql`、`db/ledger/list-ledger.sql`，仅包含 `ledger_entries` 与 `ledger_owner_revision`。只在只读核对目标结构后安装一次；正式环境建表与部署由集成交付执行，本票只在全新隔离本机数据库执行。受控入口为 `ledger_create(p_owner, p_input)`、`ledger_list(p_owner, p_page, p_start_date, p_end_date, p_version)`、`ledger_detail(p_owner, p_id)`；列表后四项有默认值。均只授予 `service_role` 调用，内部显式限定 owner，原始交易字段由触发器保护。

#93 实现退款命令并扩展派生状态和详情关联；#94 增加删除预览与原子删除。原型和既有设计文件保留作为交互依据。

可复用测试支持为 `tests/support/ledger-database.ts`，扩展现有执行器：

```sh
npm run test:database -- --ledger --browser
# 单 owner 100000 条合成数据、日期和深页 HTTP、EXPLAIN 索引证据：
npm run test:database -- --ledger --ledger-scale --browser
```

需显式配置 `POSTGRES_BIN`、`POSTGREST_BIN`，必要时配置 PostgreSQL 动态库路径。运行器创建独立临时库及端口、加载结构与事务权限探针、启动真实 PostgREST，最后停止进程并清理。`PLAYWRIGHT_PORT` 可隔离浏览器服务器端口，默认 5175；`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可选择本机 Chromium。缺少数据库地址时默认测试跳过，不能计为本票真实数据库通过。

规模测试默认在 `.cache/ledger-scale-index.json`／`.cache/ledger-scale-http.json` 记录环境、等价日期与深页 SQL 的索引计划、实际 Worker → PostgREST → PostgreSQL 耗时和稳定读取。可用 `LEDGER_SCALE_INDEX_REPORT`／`LEDGER_SCALE_HTTP_REPORT` 指定证据路径；不使用生产数据，不设置未经测量的性能承诺或产品条数上限。
