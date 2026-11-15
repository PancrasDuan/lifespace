# 旧 MCP Service Token 通道退役清单（#204）

[#204](https://github.com/PancrasDuan/lifespace/issues/204) 已完成生产退役与清理并关闭：[PR #207](https://github.com/PancrasDuan/lifespace/pull/207) 已上线、删除两条绑定、撤销专用 token 并清理 Access/配置；[PR #210](https://github.com/PancrasDuan/lifespace/pull/210) 按用户追加授权删除空绑定表与旧 RPC。用户于 2026-11-16 确认真实客户端已验证。最终生产与验证摘要见 [QA 记录](qa-mcp-legacy-retirement.md#生产发布与验收)。

下文保留当时的对象基线、执行门禁与回退范围，不能把执行前状态视为当前待清理项。用户的直接上线、删除旧数据及追加删表授权已执行；初版保留空表/RPC/记录的决定已由 [ADR 0015](adr/0015-retire-legacy-mcp.md) 与 [ADR 0016](adr/0016-remove-legacy-agent-bindings.md) 的后续决定替代。

## 对象与只读基线

2026-11-15 在仓库 Wrangler 账户 `7605a578df1909043d82848907722a87` 重新读取账户级 Access 全部应用、可复用策略、Service Token，以及唯一 zone 的应用及策略；所有列表核对分页。账户和 zone 返回同一应用，并非两份资源。未读取 Client Secret、用户资料或业务账单；未核查近期旧流量，退役依据是用户明确要求。

| 对象 | 执行前已核对的精确范围 | 最终处理 |
| --- | --- | --- |
| Worker | `lifespace`；域名 `lifespace.onepeace.cc.cd` | 先发布固定 404 版本，记录合并 SHA、Build ID、部署版本和只读探针 |
| Access 应用 | `e334ecac-3f93-4650-a0eb-39ab1fe02437`，LifeSpace Agent MCP；domain、self_hosted_domains、唯一 public destination 均精确为 `lifespace.onepeace.cc.cd/api/agent/legacy/mcp` | 验证 Worker 拒绝后删除，不扩大为整域 bypass |
| 应用策略 | `c895d548-57d9-458a-b4fc-e97e6f54db06`（LifeSpace owner agent）、`7247ee5c-c8b4-466d-8d85-20a3fc701518`（LifeSpace friend agent） | 均 `non_identity`、`reusable=false`，各仅 Include 一枚下列 token，Require/Exclude 为空；随该应用清理并验证无残留 |
| Service Token | `073c5950-6647-4a30-9d4c-18f6b4e08012`（LifeSpace Agent - owner）、`7e7dba85-a96d-494a-ac78-69799681a9b5`（LifeSpace Agent - friend）；执行前均 enabled、tags 为空 | 确认专用后先停用，移除 Access 策略引用后删除 |
| Supabase | `lifespace` / `zvdcjzjfhkjasikchceo`；`public.agent_identity_bindings` 2 条且均启用，Client ID 精确对应上述两枚 token，无其他绑定 | 先仅停用这两条，再按用户追加授权备份后删除；PR #210 删除空表及旧 RPC，保留全部历史迁移 |
| Worker 配置 | `MCP_LEGACY_ENABLED` 为普通变量 true；`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD` 为 runtime secrets | 仓库删除旧变量/类型；发布后核对旧普通变量消失，删除仅 `lifespace` 上的两枚旧 secret；不打印 secret 值 |
| 保留对象 | `agent_oauth_grants` 3 条，均未撤销且未过期；`OAUTH_KV` 绑定 `56d94963635d45d09618eaaa1a78cf7a` | 不撤销连接、不清空/删除 KV，不改用户、白名单、scope、令牌周期或账单 |

执行前只读结果：账户应用 1 个、可复用策略 0 个、Service Token 2 枚；zone 查询仅返回同一 legacy 应用。完整规则未发现其他引用或泛用 Service Token 规则。写入前已重读并递归核对 Include/Require/Exclude、rule groups、any valid service token、tag 规则、应用关联及其他可见使用方，未仅凭名称判断专用。共享或引用不明对象不得扩大删除；本次未发现此类对象。

## 阶段门禁、证据与回退

下表记录本次实际执行顺序。每步证据集中保存在 PR/Issue，不含凭据和个人信息。

| 阶段 | 执行动作与进入下一步的证据 | 回退或失败处理 |
| --- | --- | --- |
| 0. 授权与快照 | 最终提交双轴评审与 `validate` 通过；分支包含最新 main；用户授权具体 PR 和清理清单。重读上述全部引用，将完整 Access 配置、策略、无 secret 的 token 元数据、两条绑定原状态及 OAuth 授权状态摘要安全备份到忽略目录（0600），记录摘要；不要把仅行数比较称为状态未变证明 | 共享、引用变化、目标不符或授权缺失则停在此阶段；无生产写入 |
| 1. Worker 发布 | squash 合并后核对 Workers Builds 的合并 SHA、Build 与部署版本。标准无凭据 POST 为 Worker 401 Bearer challenge，metadata/AS/DCR 与原配置一致，REST 拒绝旧 Access 凭据。受保护阶段无可用旧 secret，发布门禁采用生产下载模块与已测构建逐字节哈希一致、真实 workerd 固定 404 的组合证据；移除 Access 后再核验正式域名 404，详见 PR #207 | 未以 Access 自身 403/重定向冒充 Worker 404，也未先撤 Access 取证。发布失败保留 Access 与绑定；恢复只保留 OAuth 且含 404 的已验证版本，不能直接回滚至恢复旧入口的版本 |
| 2. 停用旧绑定 | 管理通道在单事务内锁定并核对快照中的两条 Client ID、owner、原 enabled 状态；只将目标 enabled 设 false，断言更新数及目标总数均为 2。提交后核对总数仍 2、启用数 0、目标解析 null，其他绑定无变化；比对完整 OAuth 授权状态摘要，现有连接无变化 | 事务内不符即回滚；提交后如需恢复两条原状态，须单独授权且先恢复必要保护。常规故障恢复保持停用，继续修复 OAuth，不删除表或历史记录 |
| 3. 停用专用 token | 再查引用及元数据；逐枚以现名和 `enabled=false` 更新并读回，保持其他字段。Cloudflare 拒绝删除仍有策略引用的 token（12139），因此先保持停用，进入下一步移除专用引用 | 停用未删除时可恢复 enabled，但需符合授权和保护条件；不能用应用 revoke sessions 代替 token 停用/删除 |
| 4. 清理 Access 与 token | 再核对精确 domain/destinations、两条非可复用策略及引用；删除目标应用，核对应用/两条策略均不再存在，再删除两枚已停用的专用 token 并确认无残留 | 旧路径不经 Access 直接返回 Worker 404。已删除 token 的原 Client Secret 无法恢复；重建应用可能产生新 ID/AUD，不能称可原样恢复。失败保持 Worker 固定 404，按新 PR 修复 |
| 5. 旧数据、配置与收尾 | 按用户“删除旧配置与旧数据”的授权，备份并删除精确核对的两条旧绑定；删除仅 `lifespace` 的 `CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`，核对 `MCP_LEGACY_ENABLED` 无残留，其他绑定与 OAuth KV 保留。再次核对部署 SHA、正式域名 46 项探针及 OAuth/业务数据摘要；其后 PR #210 删除空表/RPC，用户于 2026-11-16 确认真实客户端已验证 | 配置故障以保留 OAuth 的新部署修复，恢复配置本身不能重开旧入口。限定恢复资料安全留存；不恢复旧凭据或已删除数据。异地传播未另行验收 |

停用绑定必须使用阶段 0 从 token 元数据取得并与数据库核对的两个精确 Client ID；不得执行无 WHERE 的全表更新，不凭 owner 或备注批量匹配。安全备份保留对应 owner 仅用于归属核对和恢复，不进入仓库、日志或公开证据。OAuth 状态比对按授权 ID 核对 owner、client、resource、scope、expires_at、revoked_at 等不变量，避免只比较数量；可保存有序记录的摘要，原数据仅在受控环境处理。

Cloudflare [Service Token 文档](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) 区分可恢复的停用与不可恢复的删除；仅撤销 Access 会话不能阻止现有 Client ID/Secret 换取新会话。[策略管理说明](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/) 说明非可复用策略的应用生命周期及共享策略影响。不得清理其他账户、整域 Access、OAuth KV、授权记录、用户或账单。

## 验证边界

自动回归覆盖所有 HTTP 方法、无凭据/伪造 Access 断言/Service Token 头/浏览器 cookie/无效 Bearer，以及真正由测试官方库签发的有效 OAuth 与网页登录凭据；残留 true 开关仍 404，且不读取请求 body、KV、身份/账单上游。原工具契约与真实隔离账单数据库改从 OAuth 入口验证，保留用户在线准入与 REST 隔离。模拟 Auth/KV、真实隔离 PostgreSQL/PostgREST、真实 workerd/KV、生产平台与真实客户端分别记录，不能互相替代。

PR #207 的生产退役与旧数据/配置清理、PR #210 的空表/RPC 删除均已完成，执行版本、备份及生产核验分别记录在两个 PR。2026-11-16 用户确认真实客户端已验证；未提供具体客户端版本、完整子流程或异地撤销传播记录，不据此扩展验收结论。


## 空表与 RPC 收尾

用户在上线后明确要求删除 `agent_identity_bindings`。PR #210 已执行迁移 [20261115151152_retire_legacy_agent_bindings.sql](../db/agent/migrations/20261115151152_retire_legacy_agent_bindings.sql)，平台记录为 `20261115153337_retire_legacy_agent_bindings`。执行前已核对固定 404 Worker 在生产、表为空、全部 SQL/PLpgSQL 函数/视图/外键引用，安全备份真实列/约束/索引/RLS/策略/ACL、旧函数定义及迁移历史，并在隔离库验证恢复脚本。

迁移使用单事务、5秒锁等待与15秒语句超时：锁定旧表、拒绝非空、拒绝其他字符串函数引用，先 `DROP FUNCTION ... RESTRICT` 再 `DROP TABLE ... RESTRICT`，最后通知 PostgREST 重载。任何依赖冲突整体回滚，不使用 CASCADE，不删除历史创建迁移。数据库与 Worker 发布互不依赖：新旧已退役 Worker 均不访问这两个对象。执行后验证对象不存在、原 OAuth 授权/用户/账单摘要未变，正式域名旧路径仍404、OAuth发现/401保持正确。

回退仅在需要时恢复安全备份的这两个空对象及权限；不恢复旧入口、凭据或已删除数据。备份是限定对象的恢复资料，不是完整数据库备份。
