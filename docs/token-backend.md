# Token 服务端契约（阶段 02）

> 本文保留阶段范围与当时验证；累计实现、已收敛结论及独立验收门禁见 [统一集成验收](token-integration.md)。

对应 #209，依赖 #206 / PR #208 的 `8b970d1f2825ab0fe6b7c398a16e25f095ff6847`；main / merge-base `f04aee12ed25d720f2c93e3a6d572b9653076c16`。分支 `codex/209-token-backend`，阶段 PR 目标 `codex/206-token-contract`。持久化、鉴权、公开协议属于需确认变更；本地开发、合成数据、隔离库、提交与阶段 PR 已授权，所有阶段完成后由总控统一集成验收和合并。当前没有生产迁移、凭据操作或部署。

## 存储与权限

`db/token/migrations/20261115152721_token_backend.sql` 是一次事务内的增量迁移，由 Supabase CLI **3.1.0** `migration new token_backend --workdir <独立目录>` 生成名称，再按仓库领域目录保存。读取了当前 [CLI v3 changelog](https://supabase.com/changelog/supabase-cli-v3)、[函数安全](https://supabase.com/docs/guides/database/functions)、[Data API 权限](https://supabase.com/docs/guides/api/securing-your-api)及 [PostgREST 请求事务/头部](https://docs.postgrest.org/en/stable/references/transactions.html)。未执行远端 CLI、`apply_migration` 或生产可写测试。

`token_private` 中的 devices、registrations、rate_limits、rollups、models 均开启 RLS，撤销 PUBLIC/anon/authenticated/service_role 的表与 schema 权限。显式给 service_role 登记管理和只读查询 RPC 执行权；给 anon 仅 `token_usage_upload`、`token_usage_heartbeat`。所有辅助函数撤销执行权，所有特权函数固定空 search_path、完整限定对象名。允许匿名调用包装函数是设备令牌权限模型的必要边界，函数内部验证令牌摘要，不能将 publishable key 视为身份。

只保存设备、登记状态、凭据摘要、接收水位和当前主/模型统计；没有逐事件、正文、路径、原始系统标识或成功上传历史。主汇总键 `(device_id, date, agent)`；模型键为 `JSON.stringify(modelId)`，null 是显式未知桶，provider 只作标签。模型行不另存版本，从主行得到同一版本；读取在同一 SQL 快照完成。字段不报告、null、0 与金额精度/费用覆盖状态沿用 `token-usage-contract.ts`。未知或 unverified 不升级为完整费用。

## Worker API

所有接口禁止缓存。POST 必须 application/json，无 query，最多 4096 字节，额外字段拒绝。浏览器接口都经过既有 `/auth/v1/user` 在线会话与当前邮箱白名单检查，Token 数据对获准账户共享；设备凭据不授予读取权限。API 仅提供后端，确认页由后续前端阶段实现，不能将 API 测试称为浏览器用户全流程验收。

| 方法 / 路径 | 输入 | 输出 / 语义 |
| --- | --- | --- |
| POST `/api/token/registrations/start` | `{deviceId,hostname,platform:"macos"\|"linux"}` | 201 `{requestId,code,claimSecret,expiresIn:600,interval:5,verificationPath:"/token/devices/confirm"}` |
| POST `/api/token/registrations/inspect` | 浏览器登录；`{code}` | requestId/deviceId/hostname/platform/status/expiresAt/replacesExisting；没有领取凭据或令牌 |
| POST `/api/token/registrations/decide` | 浏览器登录；`{requestId,code,approve,replaceExisting}` | `{status:"approved"\|"denied"}`；已有设备必须明确 replaceExisting，包括领取时才出现的竞争绑定 |
| POST `/api/token/registrations/claim` | `{requestId,claimSecret}` | pending / denied / expired / slow_down / superseded，或 claimed + deviceId/generation/uploadToken/tokenExpiresAt/upload 连接参数 |
| POST `/api/token/devices/disable` | 浏览器登录；`{deviceId}` | `{deviceId,disabled:true}`；下一次旧凭据上传拒绝，已提交统计保留 |
| GET `/api/token/devices?after=...` | 浏览器登录，可选上一页 cursor | `{devices,nextCursor,serverTime}`；100/页，按 ASCII deviceId 排序 |
| GET `/api/token/usage?...` | 浏览器登录，以下筛选 | `{rows,nextCursor,timeZone,scope}`；最多 250 行、约 4 MiB/页 |
| GET `/api/token/summary?...` | 同筛选，无 after | `{totals,daily,models,rowCount,timeZone,scope}`；整个筛选范围的统计 |

登记短码有 40 位随机空间，领取凭据 256 位；领取凭据与上传令牌均 base64url、43 字符。上传令牌使用 `HKDF-SHA-256(UTF8(claimSecret), salt=UTF8(requestId), info=UTF8("lifespace-device-upload-v1"), length=256)` 后 base64url，无 padding。只有 Worker 发给终端的 claimed 响应包含上传令牌。服务端长期与短期均只保存两种凭据的 SHA-256 摘要，不保存原文或密文；各自入口只接受对应凭据。

登记批准和领取均受创建时起 10 分钟限制，批准不续期。有效领取请求最少间隔 5 秒，提前轮询返回 slow_down/interval=5，状态写入不回滚；并发领取恰有一次激活/提升代际，其他请求限速，稍后重试返回同一代际和令牌。终端应先落盘 start 响应，再轮询；若 start 响应丢失，重新开始登记。领取窗口结束后恢复需重新登记，已有成功领取的上传令牌持续有效至停用或轮换，没有固定过期日。被另一登记替代或停用后领取返回 superseded，不再次激活。拒绝、到期请求不能领取。

每来源 IP 每小时最多 10 次登记、每设备最多 3 个 pending；浏览器每账户每小时最多 60 次短码核对。限流在真实数据库内原子更新，超额仍持久化计数；Worker 将 Cloudflare 提供的 IP 只取摘要，未提供时共享 local-unknown 桶。新登记时删除过期登记及超过两小时的限流行；闲置系统可能保留到期状态/摘要至下次登记，没有可恢复上传令牌。误输短码只返回未找到，高熵领取请求不泄露其他申请状态。Origin/CORS 不授予匿名浏览器业务读取，业务操作仍需 Bearer 会话。

错误响应沿用 `{error:{code,message}}`；格式/范围/计数溢出 400、未找到/到期检查 404、状态/需明确重新绑定 409、限流 429、无法确认服务结果 503。503 不证明写入失败，按相同请求或 inspect/claim 恢复。数据库异常文本、服务端密钥和原始请求不出现在日志或公开响应。

## Supabase 直传与恢复

终端直接 POST Supabase HTTPS `/rest/v1/rpc/token_usage_upload`，头为 `apikey:<publishable key>`、`Content-Type:application/json`、`X-LifeSpace-Device-Token:<独立令牌>`；现代 publishable key 不放 Bearer。普通统计不经 Worker。参数：

```ts
{ p_generation: "1", p_snapshot: TokenUsageSnapshot, p_hash: "<64-char lowercase SHA-256>" }
```

metadata.snapshotVersion 在该传输层必填、正整数十进制字符串，最多 40 位；generation 是成功领取返回的服务器整数字符串。新采集器必须在 SQLite 事务中保存不可变快照、版本和摘要；同主汇总每次实际替换递增版本，重试沿用原请求。无需每次扫描都变化版本，但有不同内容在途时，A→B→A 的最终 A 必须形成更新版本。版本不是时间戳/摘要。数据库以代际优先、版本其次比较，锁定设备后校验与写入；新代际接受从 1 开始，旧 token 立即失效；不能因相同 deviceId 恢复权限。服务端不解析原始日志。[ADR0020](adr/0020-token-recorded-usage-authority.md)已在 #223 更新采集职责：接受Tokscale成功且通过输出校验的已记录统计，允许有效更正下降，不再以独立逐日志完整性证明或上游warning冻结；graph缺席旧日期不自动清空，真正失败不生成替代快照。

每次最多 1 MiB（数据库 JSONB 文本大小）、500 模型项、单份主汇总整体替换；不提供局部模型 patch 或批量多主汇总事务。共享传输 schema 是 `src/shared/token-backend-contract.ts`；PostgreSQL jsonb 无法表示 NUL/孤立 surrogate，日期限定 0001–9999，传输层提前拒绝，不改变阶段 01 对正常 JSON 的摘要算法。数据库重新验证所有字段/主子对账，重建紧凑 JSON/UTF-16 字典序，再对 UTF-8 字节取 SHA-256，不能直接 digest(jsonb::text)。

回执为 `{persisted:true,deviceId,date,agent,generation,snapshotVersion,contentHash,result,receivedAt}`，result 是 replaced / unchanged / duplicate。同代际同版本同摘要幂等；同版本异内容 TOKEN_VERSION_CONFLICT；旧版本 TOKEN_STALE_VERSION；摘要不符 TOKEN_HASH_MISMATCH；令牌/代际/停用错误 TOKEN_CREDENTIAL_INVALID。错误没有 persisted 确认，不清队列；数据库通过 PostgREST 返回固定 message/code，HTTP 状态不是队列确认依据。仅当本地待传项的 identity、generation、snapshotVersion、contentHash 全部匹配回执才可清除；旧确认不能删除新任务。

新版本同内容只推进水位/诊断元数据和接收时间，保留主内容更新时间与模型行；不同内容事务替换主/子，允许下降、重归属、删除旧子项。所有失败包括中途模型插入失败都回滚主行、模型和设备接收时间，不累计历史版本。

无新增用量直接调用 `token_usage_heartbeat`：`{p_device,p_generation,p_hostname,p_sync_hours}`，同设备令牌头，周期仅 1/3/6/8/12/24 小时，回执 `{persisted:true,deviceId,generation,receivedAt}`。不分配主汇总版本、没有虚构失败数、没有远程配置/重扫。设备 overdue 为启用且未曾收到或最后接收时间超过两个同步周期；停用状态单列。重绑后未首次同步显示逾期/未收到，历史统计保留。

## 筛选与对账

日期必填 startDate/endDate，有效公历日，闭区间最多相差 366 天，覆盖闰年年度日历。可选单个 agent、deviceId、modelKey；未知模型用字面字符串 `null`，已知模型用 JSON.stringify(modelId)，查询 URL 需正常编码；provider 不作筛选键。拒绝重复参数与未知字段。

无 modelKey 的 totals/daily 使用主行；有 modelKey 只使用命中的子行指标与费用，不额外加入主行。模型图数据始终来自子行，分类 partial/missing 不能假装可重建主总量。计数合计先传播未报告，再传播 null；已知计数合计超出安全整数时拒绝。费用按币种独立合计，用 numeric 精确加法返回规范十进制字符串，保留 unknown/partial/unverified 与实际/估算/未分类字段。缓存比例应使用汇总 cacheRead/input，仅在两者已知且 input>0 时计算。

summary 最多处理符合全部筛选条件的 100000 主行，响应最多约 4 MiB，超限 TOKEN_QUERY_TOO_BROAD；缩小日期/设备/Agent 范围。明细按 `date/deviceId/agent` ASCII 键连续分页，cursor 只用于相同筛选；读完 nextCursor=null 才算完整明细，但完整范围总计直接取 summary。多次请求之间不提供冻结数据库快照，正在上传时 summary 与多页明细可能变化；刷新以获取当前结果，不将多页历史读当作原子全库导出。各页包含服务器收到的版本、摘要和模型覆盖；所有查询都排除凭据摘要和 owner/服务器信息。

## 验证与最终交付顺序

`npm run test:token-database` 总是创建全新本地集群、随机 127.0.0.1 端口，从不接受远端连接字符串。`POSTGRES_BIN` 指向 PostgreSQL bin；可选 `POSTGREST_BIN` 指向固定二进制；CI 必须提供两者并执行该任务，validate 包含数据库门禁。测试使用合成身份与随机临时凭据，正常完成或失败后停止并删除本实例；本机 /tmp 空间不足时可将 TMPDIR 指向本工作区忽略的 test-results 子目录（不能置于开发服务器明确禁止的 .cache 路径）。本机 PG 17.11 / PostgREST 13.0.7 已用于实测；CI 下载官方同版本，验证 release SHA-256。常规 API 测试无数据库环境时跳过数据库组，不能代替专项执行。

独立 PostgreSQL 实测包括共享固定向量/Unicode/缺失/null/零/金额、严格字段与完整分类对账、A→B→A/乱序/重传/并发/冲突、下降/模型替换删除/事务回滚、跨设备写入拒绝/私有表与管理函数权限、停用/重绑/轮询/过期/拒绝/并发领取/响应丢失恢复、心跳/年度分页/模型筛选与费用合计、Worker 接真实 DB 授权、PostgREST 混合大小写请求头读取及匿名 RPC 权限。API 回归另测当前登录/白名单拒绝、严格参数、秘密响应隔离。最终命令与结果、固定 SHA 双轴评审和 CI 由阶段报告记录。

最终统一交付门禁：先备份新增 schema/数据/权限及迁移历史并演练恢复，核对生产 Data API 只暴露 public、不暴露 token_private；完整单事务执行迁移→验证权限/函数→发布包含全部阶段的 Worker/前端→用独立合成登记验证 HTTPS apikey 与头部→再接真实采集器。先迁移再部署可兼容旧 Worker；迁移不改现有业务表。若新功能异常，先停用新设备入口/回退 Worker 到集成前版本，保留汇总与摘要；若要完整移除新增 schema/函数，应先导出并核对依赖，再单独授权 drop，不将可恢复数据随代码回退删除。没有生产变更时本阶段无需执行回退。

仍需总控后续完成：正式浏览器确认页、采集器 SQLite/来源完整性/本机身份与凭据保存、真实 macOS/Linux 双设备、最终原型对照、托管 Supabase gateway 的 publishable-key HTTPS 完整链路及生产迁移/上线验收。本地 PostgREST 证明头部/事务行为，不等于已经通过托管网关或用户浏览器验收。
