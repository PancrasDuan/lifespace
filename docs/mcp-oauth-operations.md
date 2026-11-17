# MCP OAuth 接入与运维

实现对应 [#193](https://github.com/PancrasDuan/lifespace/issues/193)、[ADR 0012](adr/0012-mcp-oauth-grants.md)。账单工具字段、结果、退款事实、requestId 重试和业务错误见 [MCP 接口](agent-mcp.md)。标准 OAuth 是唯一 MCP 接入方式；[#204 退役清单](mcp-legacy-retirement.md) 所列旧通道、凭据、配置及绑定表/RPC 已通过 [PR #207](https://github.com/PancrasDuan/lifespace/pull/207) 和 [PR #210](https://github.com/PancrasDuan/lifespace/pull/210) 完成生产清理，历史迁移保留。最终部署与线上核验见 [退役验证](qa-mcp-legacy-retirement.md#生产发布与验收)，初次 OAuth 上线记录保存在 [PR #194](https://github.com/PancrasDuan/lifespace/pull/194)。

2026-11-16 用户已确认真实客户端验证通过；未提供具体客户端版本、全部 OAuth 子流程或异地撤销传播的逐项记录，不能据此扩展验收结论。

## 客户端与用户

标准地址为 `https://lifespace.onepeace.cc.cd/api/agent/mcp`。无凭据请求返回 401，`WWW-Authenticate` 指向 `/.well-known/oauth-protected-resource/api/agent/mcp`；资源 metadata 指向同源 `/.well-known/oauth-authorization-server`。客户端应用已有预注册信息时优先使用；其次可通过 HTTPS Client ID Metadata Document 识别，文档 URL、redirect URI、客户端鉴权由官方库验证。按用户确认的界面范围，同意页聚焦当前账户、权限选择和授权/拒绝操作，移除客户端名称/域名区块、回调地址及其说明；服务端客户端识别和回调校验仍执行。授权管理以授权时间、权限和状态区分记录，不显示客户端名称、原始 URL 或说明段落；每条记录的撤销仍绑定其独立授权 ID。

授权码流程必须使用 PKCE S256。客户端完成 Supabase 登录、逐请求准入与明确同意后，只获得 MCP 授权码及专用 access/refresh token。网页登录的会话凭据不会出现在回调、MCP 配置或客户端响应里。同意页默认不勾选任何权限，包括客户端请求的 scope；用户可逐项选择或点击「全选」选中页面展示的全部四项权限，全部选中时同一按钮变为「取消全选」，点击后清空选择。全选和取消全选均不直接提交。至少选择一项后方可确认授权，空选时仍可拒绝。客户端未传 scope 时，服务端仍按只读解析请求，不据此替用户勾选。拒绝通过经过验证的回调返回 `access_denied`、state 和 issuer。

### WorkBuddy

在 WorkBuddy 的 MCP JSON 配置中添加以下条目，然后点击连接并完成浏览器授权。采用 [WorkBuddy 官方远程 HTTP 配置格式](https://open.workbuddy.cn/docs/connector)，不添加静态 Bearer Token、Supabase 凭据或旧 Access 请求头：

```json
{
  "mcpServers": {
    "lifespace": {
      "type": "streamableHttp",
      "url": "https://lifespace.onepeace.cc.cd/api/agent/mcp"
    }
  }
}
```

WorkBuddy 官方动态 OAuth 流程依赖 RFC 7591 客户端注册。生产配置为此显式启用 `MCP_OAUTH_DCR_ENABLED=true`，让 AS metadata 公布 `/oauth/register`。注册客户端不会授予账单权限，仍须通过用户登录、准入、PKCE 和明确同意。实际部署及 WorkBuddy 验收状态以 #193 和后续 PR 记录为准。

若点击连接没有打开浏览器，先检查客户端错误详情：`Connect Timeout Error` 表示网络连接尚未建立，需检查 WorkBuddy 代理及网络规则；缺少 `registration_endpoint` 或注册返回 404 表示对应部署未启用 DCR。不要手动打开不带客户端授权参数的 `/oauth/authorize`，也不要自行填写示例 Client ID 或回调地址。DCR、PKCE 的模拟及隔离运行时验证不能代替真实 WorkBuddy 的浏览器回跳验收。

| 工具 | 所需权限 |
| --- | --- |
| `list_ledger_accounts` | `ledger:accounts:read` |
| `list_ledger_entries` | `ledger:entries:read` |
| `get_ledger_entry` | `ledger:entries:read` |
| `create_ledger_entry` | `ledger:entries:create` |
| `create_ledger_refund` | `ledger:refunds:create` |

每项操作只要求自己的 scope；两个流水读取工具共用 `ledger:entries:read`。五个工具均为 POST，因此按工具名授权。无效令牌返回 401；权限不足返回 403，challenge 包含该操作所需 scope 和 resource metadata，客户端重新发起授权。既有授权没有新 scope 时不会被静默放宽，须由用户重新授权并勾选「读取账单流水」。刷新可以缩小权限，不能增加权限或改变 resource；应用显式拒绝库 1.2.4 默认静默取交集的增权请求。access token 15 分钟，refresh token 轮换，最长 30 天。官方库允许刚被替换的 refresh token 在替代 token 首次使用前重试；这不是跨用户或增权授权。

授权管理在 `/oauth/grants`，必须通过原网页登录，每页展示 20 条独立连接并可继续加载、撤销。列表 RPC 额外取一条判定下一页，读取预算 512 KiB，覆盖合法长客户端 URL 与名称。网页退出不会自动撤销 MCP 授权。重新授权建立新连接，不改变旧连接；无需继续使用的旧连接应明确撤销。数据库只保存授权标识、owner、客户端标识及名称、资源、scope、时间和官方 grant 标识，不保存 access/refresh token、授权码、Client Secret 或邮箱。客户端名称保留在授权记录中，页面不展示该字段。

#231 新增 `ledger:entries:read` 后，授权表原有 scope CHECK 上限为 3 项，必须先应用 [20261117000000_mcp_ledger_entries_read_scope.sql](../db/agent/migrations/20261117000000_mcp_ledger_entries_read_scope.sql) 再部署新 Worker。该前向迁移只替换 `agent_oauth_grants` 的 scope 约束，不改账单表、数据、RPC 或令牌周期；未应用时新 scope 的授权写入会被数据库拒绝，不能靠应用层放宽绕过。Issue #231 原文要求“不修改现有 REST 契约、数据库结构或迁移”；本迁移是授权存储约束的必要例外，超出该句范围，须由用户针对具体 PR 明确授权后才能合并或应用。

固定依赖 1.2.4 的三个内部诊断路径未经过 `onError`，可能记录客户端可控 URL 或原始异常。安装、构建和接口测试前均执行 `scripts/patch-oauth-provider.mjs`：校验原始 JS 的 SHA-256，仅将三条诊断改成固定消息，不更改协议逻辑；重复执行幂等，依赖内容变化时拒绝继续，升级须重新审查补丁。

## 环境和路由

- `MCP_OAUTH_ISSUER`：固定规范 origin，生产为 `https://lifespace.onepeace.cc.cd`；只允许 HTTPS，显式 localhost/127.0.0.1/::1 开发环境可用 HTTP。resource 固定为 issuer + `/api/agent/mcp`。其他 Host 不得改变 issuer。
- `OAUTH_KV`：专用 namespace，不能与旧测试、其他 issuer 或星座缓存混用。部署前显式绑定已核对的 namespace ID；不依赖部署工具自动创建未知资源。
- `global_fetch_strictly_public`：CIMD 必需，配合官方库的 HTTPS、大小、超时及 redirect 校验防 SSRF；不加载客户端 logo 或任意脚本。
- `MCP_OAUTH_DCR_ENABLED=true`：生产为 WorkBuddy 的动态 OAuth 接入显式开启 `/oauth/register`；其他环境未配置时仍关闭，预注册和 CIMD 继续可用。注册结果、scope 和回调仍由官方库及用户同意验证。
- `MCP_ALLOWED_ORIGINS`：可选的精确 Origin 逗号列表，不含通配符；同源网页自动允许。其他带 Origin 的请求（含 OPTIONS）拒绝。metadata、token 与 MCP 的 CORS 仅回显已允许 Origin，不使用 `*`。非浏览器客户端可以不带 Origin。
旧 `/api/agent/legacy/mcp` 在任何环境下均于业务鉴权前返回 404。`MCP_LEGACY_ENABLED`、`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD` 已退出运行时契约，残留配置不能开启兼容模式；生产配置清理按 [退役清单](mcp-legacy-retirement.md) 执行。

Wrangler 的 `run_worker_first` 包含 `/api/*`、`/.well-known/*`、`/oauth/*`。AS metadata、token、register 由服务端处理；授权和管理页才返回 SPA，未知服务端路径返回 404 JSON。认证与授权响应为 `no-store`，授权页禁止 framing，并使用 no-referrer；不削弱已有静态资源的完整 CSP。浏览器 token 只在同源 API 请求 Authorization 头内发送。

本地开发将忽略的 `.dev.vars` 中 `MCP_OAUTH_ISSUER` 设置为实际本机预览 origin（如 `http://127.0.0.1:5193`）；先用 Orca ports 核对端口。不会把开发 issuer 提交进生产配置。

## 撤销和故障边界

`agent_oauth_grant_revoke` 在 PostgreSQL 主库提交 `revoked_at` 后返回。每次 MCP 授权解析和 code/refresh 兑换都重新调用主库 RPC，不缓存、不走只读副本；后续开始的检查返回无效授权，即使另一区域的 KV 仍保留旧令牌。code 兑换还在同一数据库更新中原子认领使用标记，阻止跨地区旧 KV code 重放。数据库或 Supabase Auth 管理服务不可用返回 503，拒绝访问；未知/禁用/删除用户、未验证邮箱和白名单撤销继续拒绝。

撤销与正在处理的请求并发时，以**数据库授权检查的语句快照**为边界：在撤销提交之前已读到允许状态的请求可以继续；之后新开始的检查拒绝。撤销不会收回已返回数据、取消远端正在执行的账单事务或回滚在途请求。KV 清理故障不撤销数据库的拒绝状态，UI 不会误报为未撤销。

官方 RFC 7009 revocation endpoint 与 token endpoint 同为 `/oauth/token`，按官方库要求提交 token 与客户端鉴权信息。单枚 access token 撤销不撤销整条连接；refresh token 撤销撤销该库 grant，均受 KV 传播窗口影响。本站管理页的数据库撤销才提供上述新解析拒绝边界。异地真实传播验收与模拟旧 KV 测试分开记录。

## OAuth 初次上线的历史阶段与回退门禁

以下记录 #193 的初次上线及当时的回退方案，保留追溯，不是当前执行指令。#204 已替代其中保留/启用旧通道的决定；本次发布、清理与回退以 [退役清单](mcp-legacy-retirement.md) 为准，不得重新开放旧入口。

发布准备前的只读基线（2026-11-14）：Cloudflare 账户为仓库 Wrangler 账户，Access 应用 `e334ecac-3f93-4650-a0eb-39ab1fe02437`（LifeSpace Agent MCP）精确保护 `lifespace.onepeace.cc.cd/api/agent/mcp`；destination 相同，存在两条 `non_identity` 策略，`options_preflight_bypass=false`。这会拦截标准 MCP 首次请求。当时 Supabase 项目 `zvdcjzjfhkjasikchceo` 已有启用 RLS 的 `agent_identity_bindings`，OAuth 表/函数尚不存在。

| 阶段 | 门禁、证据与回退 |
| --- | --- |
| 本地交付 | 固定提交双轴评审、密钥扫描、CI validate；真实隔离 SQL/运行时及网页验证完成，用户对具体 PR/配置确认后才执行下列生产步骤 |
| 授权存储 | 完整读取并一次提交 [迁移](../db/agent/migrations/20261114130000_agent_oauth_grants.sql)，预检单次传输限额；此迁移是 additive，不变更旧绑定及账单。核对 RLS、表无公开权限、RPC 仅 service_role、用户 FK 和函数签名；保留新表即可回退旧 Worker，不删除授权审计状态 |
| 准备资源 | 专用 OAUTH_KV、固定 issuer 和实际客户端所需注册方式；仅新建空 namespace 不会改变生产 Worker。绑定 ID、变量及旧通道开关纳入 PR，不通过 Dashboard 普通变量作唯一依据 |
| Worker 发布 | 合并 PR 后核对 Workers Builds 的提交 SHA 和版本；在 Access 仍保护标准入口时，验证 metadata、OAuth 路由及 REST 拒绝。旧路径切换时存在短暂连接中断，维护窗口先告知用户 |
| Access 精确切换 | 先读取完整当前配置并安全备份（不含 Service Token secret）；将上述应用的 domain 与 public destination 从 `/api/agent/mcp` 精确改为 `/api/agent/legacy/mcp`，保留应用 ID/AUD、两条策略及其他设置，禁止扩大到整域 bypass。再核对标准地址无凭据返回 Worker 401、旧地址保持 Access 保护 |
| 客户端及异地验收 | 实际版本客户端完成 URL 发现、登录、同意/拒绝、刷新、scope 增权、重连和撤销；至少异地只读验证数据库撤销后的拒绝。写入验收只用隔离合成账单；未验证项分别保留，不能用 HTTP 模拟代替 |
| 回退 | 需用户授权：先将 Access 精确恢复原 domain/destination 和原策略，再恢复旧 Worker 版本，避免旧 Service Token 入口暂时公开。保留新授权表、KV 及原绑定；必要时先在数据库撤销新 grant，不改账单，不删除用户或原 Service Token |

2026-11-14 用户已确认两页界面并明确授权本次发布。发布准备已创建专用 KV 并完整应用授权表迁移（平台版本 `20261114144346_agent_oauth_grants`，对应仓库脚本 `20261114130000_agent_oauth_grants.sql`）；RLS、RPC ACL 和服务端只读调用已核对。Worker 发布及 Access 精确切换继续遵循上表门禁，阶段结果写入 PR；本次授权不延伸至其他生产改动。真实客户端验收按用户安排稍后进行。

## 验证入口

常规 `npm run test:api` 包含官方库完整模拟流程及旧账单契约回归；`npm run build` 后，配置本机 PG17、PostgREST 与动态库，执行：

```sh
npm run test:database -- --ledger
npm run test:database -- --ledger --api tests/api/mcp-oauth-database.test.ts tests/api/mcp-oauth-runtime.test.ts
PLAYWRIGHT_PORT=5193 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser -- tests/browser/mcp-oauth.spec.ts tests/browser/auth.test.ts tests/browser/shared-shell-scope.spec.ts
```

第二项在真实 workerd + KV + 一次性 PostgreSQL 中，读取生产构建的 DCR 开关，按公布的注册入口完成动态注册、同意、PKCE、刷新及撤销；Auth 身份服务为合成边界，不能称真实 Supabase Auth 或真实目标客户端验收。真实隔离账单测试覆盖原三个工具的 owner、余额、退款和幂等，并扩展流水列表、单笔详情、筛选、分页、关联与跨 owner 隔离。最终证据见 [验收记录](qa-mcp-oauth.md)。
