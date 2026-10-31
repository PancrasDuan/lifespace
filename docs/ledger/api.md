# 账单、退款与删除接口

#90–#94 的正式契约位于 `src/shared/ledger.ts`。所有接口均逐次核验现有登录身份与准入白名单，由 Worker 注入可信 owner，响应为 `Cache-Control: no-store`。浏览器角色没有两表及账单 RPC 权限，交易事实不提供修改接口。

| 接口 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/ledger/entries` | `requestId` UUID、`direction`、有符号整数分 `amountCents`、UTC 秒精度 `occurredAt`、`accountName`、`categoryCode`、`note` | `{ entryId, version, deleted }` |
| `GET /api/ledger/entries?page=1` | 页码默认 1，固定每页 30；可选 `startDate`／`endDate` 与 `version` | `{ items, total, page, pageSize: 30, version }` |
| `GET /api/ledger/entries/:id` | 本人流水标识；可选 `refundPage`（默认 1）与 `version` | `{ entry, parentEntry, refunds, refundCount, refundedCents, refundPage, refundPageSize: 30, version }` |
| `POST /api/ledger/entries/:id/refunds` | 父支出标识；`requestId`、正整数分 `amountCents`、UTC 秒精度 `occurredAt`、`note` | `{ entryId, version, deleted }` |
| `GET /api/ledger/entries/:id/delete-preview` | 本人未删除流水标识 | `{ entry, refundCount, scope, version }` |
| `POST /api/ledger/entries/:id/delete` | `{ scope }`，使用本次预览的具体范围凭据 | `{ entryId, version, deleted: true }` |

流水字段为 `id`、`direction`、`amountCents`、`occurredAt`、`accountName`、`categoryCode`、`note`、`parentEntryId`、`createdAt`、派生 `status`。普通流水的 `parentEntryId` 为 `null`；退款由收入与非空父关联识别。详情返回本人未删除父流水及独立分页的有效退款链接，每条链接只含 `id`、`occurredAt`、`amountCents`；完整备注、账户等通过单笔详情读取。关联按 `occurredAt DESC, id DESC`，每页最多 30 条，全部关联均可翻页访问，不依赖外层列表范围／页码。`refundCount`／`refundedCents` 为全部有效退款的总笔数／整数分金额，非父支出为 0；可退额使用原支出绝对值减去该全量金额。普通支出按全部有效退款派生 `completed`、`partial-refund`、`full-refund`，普通收入及退款始终 `completed`；原金额不变。列表按 `occurredAt DESC, id DESC`，总数、列表、状态和版本在同一事务锁内读取；空账户为版本 0，不创建元数据。首次写入安全建立版本行。

关联 `refundPage` 是十进制正安全整数，不设普通列表的 1,000,000 页上限；超出当前尾页返回空链接及真实全量总数。严格拒绝未知、重复和非法查询参数。首次详情确定 owner 版本，后续关联翻页及刷新携带该版本；不符时返回 `LIST_CHANGED`（409），页面提示关联已更新并重读关联第一页。切换父／子详情重新开始关联浏览；只保留当前关联页，避免无限累加。详情在 owner 共享锁内同时读取目标、父、全量 sum/count、状态、限定 30 条的关联与版本；SQL 先 LIMIT 再聚合，Worker 的 1 MiB 响应上限不变。

日期查询使用合法的 `YYYY-MM-DD`，起止同时提供且起始不晚于结束；全部时间同时省略。数据库将 `Asia/Shanghai` 开始日零点至结束日次日零点转为左闭右开区间，固定包含首尾自然日。非法日期、反向范围、重复参数及未知字段在 Worker 中拒绝，不调用查询。`version` 为可选的非负安全整数；与当前 owner 版本不符时返回 `LIST_CHANGED`（409），不附带条目。列表在共享锁内先核对版本，再读取总数和条目，同 owner 写事务持有排他锁；不同 owner 独立。

正式页默认全部时间第一页；今天、含今天的 7 天／30 天按北京时间计算。双日历维护临时草稿，本周／本月只填草稿，应用后开始新浏览；关闭时丢弃。查询缓存包含 owner、日期、页码及浏览会话，取消和迟到响应不会覆盖当前条件。翻页、重新聚焦与手动刷新携带已读版本；冲突提示列表已更新，保留日期并重新读取第一页，表单保持。普通保存与退款成功开始全部时间的新浏览；本页删除接纳回执版本、保留筛选和有效页，末页消失退到最近有效页；浏览器刷新和重新进入不持久恢复筛选。

普通创建不接收 owner、状态、父标识或预期旧版本。所有请求使用严格字段校验。金额绝对值最大 `99_999_999_999` 分，非零且符号与方向一致；账户和备注 trim 后分别为 1–50、0–500 个 Unicode 码点。日期、输入转换和显示统一使用实际 `Asia/Shanghai` 规则，传输采用 UTC ISO 8601；例如 `1988-06-01 00:30:00` 为 `1988-05-31T15:30:00Z`。历史重复小时确定取较晚瞬间，与 PostgreSQL 本地时间解释一致；不存在的本地时间拒绝并保留输入，不静默移时。未来时间与退款父下界最终比较 UTC 瞬间。原生时分秒方向键在 00／23／59 边界停止，数字编辑和日期段编辑保留。服务端与数据库拒绝未来时间和非秒精度。元输入通过整数运算转为分。

同 owner 的创建先锁版本行，再按 `requestId` 查重；相同内容返回原 `entryId` 和当前版本，异内容返回 `REQUEST_ID_REUSED`，不同编号相同内容可以分别保存。唯一性覆盖已删除记录；旧请求返回 `deleted: true`，不回传交易正文、不复活记录。实际插入与版本递增原子完成。版本范围为 JavaScript 安全整数。

退款固定服务端收入方向、父标识、交易账户和支出分类，不接受客户端覆盖。父必须为本人未删除普通支出；时间不早于父支出且允许同秒。`ledger_refund` 先持有 owner 版本行排他锁、检查包含已删除记录的请求编号，再校验父资格、时间与全部有效退款额度，最后插入并递增版本；失败完整回滚。重复成功请求在余额减少、已全额或父已删除后仍返回原标识和当前版本，不重建、不重新计入。退款重复请求比较父标识、金额、时间及 trim 后备注；不同编号的相同内容允许分别保存。

失败统一为 `{ error: { code, message } }`。稳定业务错误包括 `INVALID_ENTRY` / `INVALID_QUERY` / `FUTURE_TIME` / `REFUND_TIME`（400）、`REQUEST_ID_REUSED` / `LIST_CHANGED` / `REFUND_PARENT_INVALID` / `REFUND_LIMIT` / `DELETE_SCOPE_CHANGED`（409）、`NOT_FOUND`（404）、`LEDGER_UNAVAILABLE` / `SAVE_UNKNOWN` / `DELETE_UNKNOWN`（503），另沿用现有 `AUTH_*`。未知数据库或传输故障不回传原始响应、输入或凭据；创建／退款在无法确认时返回 `SAVE_UNKNOWN`，删除返回 `DELETE_UNKNOWN`。页面仅在当前挂载期间保存待确认命令供显式重试，不自动重提、不写本地存储；确认成功后重读失败只重试读取。

数据库安装顺序为 `db/ledger/create-ledger.sql` → `db/ledger/list-ledger.sql` → `db/ledger/refunds.sql` → `db/ledger/delete.sql`，仅包含 `ledger_entries` 与 `ledger_owner_revision`。只在只读核对目标结构后安装；正式环境建表与部署由集成交付执行，本票只在全新隔离本机数据库执行。受控入口为 `ledger_create(p_owner, p_input)`、`ledger_list(p_owner, p_page, p_start_date, p_end_date, p_version)`（后四项有默认值）、`ledger_detail(p_owner, p_id, p_refund_page, p_version)`（后两项有默认值；旧两参数重载被移除）、`ledger_refund(p_owner, p_parent, p_input)`、`ledger_delete_preview(p_owner, p_id)`、`ledger_delete(p_owner, p_id, p_scope)`；均只授予 `service_role` 调用，内部显式限定 owner，原始交易字段由触发器保护。退款扩展替换状态序列化与详情函数，不替换列表查询，便于与日期分页合并。活跃退款索引包含 owner、父标识、倒序时间和倒序 UUID，兼顾全量聚合与有界关联排序。

删除预览在 owner 共享锁内只读。`scope` 为 SHA-256 十六进制摘要：绑定可信 owner、目标及按 UUID 排序的全部有效退款标识，固定 64 字符，不受无关流水或列表版本影响，也不会因退款数量相同而忽略成员替换。内部 `ledger_delete_scope` 不授予 API 角色执行权限。删除在 owner 排他锁内先查目标（已删除直接成功），再比较 scope；冲突不写入、不增版本，页面重读预览并等待再次确认，不自动继续。确认卡片显示的范围在当前会话冻结，focus 刷新不悄悄更新它。父子删除时间与版本一次事务提交；退款单删释放余额，父状态动态恢复。只写 `deleted_at`，不修改原始事实、不物理删除、不恢复。没有实际变更的重复删除不增版本。

删除未知结果仅在当前页面内保留原目标和 scope，允许关闭确认后显式重试或查看列表，其他操作可继续。迟到删除成功仅关闭对应会话；成功后的读取失败只重读。重新加载页面不恢复或自动提交命令。原型及历史规格文件保留，不作为正式测试的替代。

可复用测试支持为 `tests/support/ledger-database.ts`，扩展现有执行器：

```sh
npm run test:database -- --ledger --browser
# 单 owner 100000 条合成数据、日期和深页 HTTP、EXPLAIN 索引证据：
npm run test:database -- --ledger --ledger-scale --browser
```

需显式配置 `POSTGRES_BIN`、`POSTGREST_BIN`，必要时配置 PostgreSQL 动态库路径。运行器创建独立临时库及端口、加载结构与事务权限探针、启动真实 PostgREST，最后停止进程并清理。`PLAYWRIGHT_PORT` 可隔离浏览器服务器端口，默认 5175；`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可选择本机 Chromium。缺少数据库地址时默认测试跳过，不能计为本票真实数据库通过。

规模测试同时创建另一个独立 owner 的 100000 条含退款事实：40000 条支出、60000 条退款（30000 条已删除），验证 completed／partial／full 状态、跨日期父子详情、删除预览、范围与父子删除。退款索引和真实 HTTP 的独立记录为 `.cache/ledger-refund-scale-index.json`／`.cache/ledger-refund-scale-http.json`，可用 `LEDGER_REFUND_SCALE_INDEX_REPORT`／`LEDGER_REFUND_SCALE_HTTP_REPORT` 指定。

普通流水规模测试默认在 `.cache/ledger-scale-index.json`／`.cache/ledger-scale-http.json` 记录环境、等价日期与深页 SQL 的索引计划、实际 Worker → PostgREST → PostgreSQL 耗时和稳定读取。可用 `LEDGER_SCALE_INDEX_REPORT`／`LEDGER_SCALE_HTTP_REPORT` 指定证据路径；不使用生产数据，不设置未经测量的性能承诺或产品条数上限。
