# MCP OAuth 接入与运维

实现对应 [#193](https://github.com/PancrasDuan/lifespace/issues/193)、[ADR 0012](adr/0012-mcp-oauth-grants.md)。账单工具字段、结果、退款事实、requestId 重试和业务错误见 [MCP 接口](agent-mcp.md)。当前为待合并发布实现，生产仍使用原 Service Token 入口。

## 客户端与用户

标准地址为 `https://lifespace.onepeace.cc.cd/api/agent/mcp`。无凭据请求返回 401，`WWW-Authenticate` 指向 `/.well-known/oauth-protected-resource/api/agent/mcp`；资源 metadata 指向同源 `/.well-known/oauth-authorization-server`。客户端应用已有预注册信息时优先使用；其次可通过 HTTPS Client ID Metadata Document 识别，文档 URL、redirect URI、客户端鉴权由官方库验证。按用户确认的界面范围，同意页聚焦当前账户、权限选择和授权/拒绝操作，移除客户端名称/域名区块、回调地址及其说明；服务端客户端识别和回调校验仍执行。授权管理以授权时间、权限和状态区分记录，不显示客户端名称、原始 URL 或说明段落；每条记录的撤销仍绑定其独立授权 ID。

授权码流程必须使用 PKCE S256。客户端完成 Supabase 登录、逐请求准入与明确同意后，只获得 MCP 授权码及专用 access/refresh token。网页登录的会话凭据不会出现在回调、MCP 配置或客户端响应里。同意页默认勾选客户端请求的权限；没有 scope 时默认只读，用户可选择其他三项已公布权限。拒绝通过经过验证的回调返回 `access_denied`、state 和 issuer。

| 工具 | 所需权限 |
| --- | --- |
| `list_ledger_accounts` | `ledger:accounts:read` |
| `create_ledger_entry` | `ledger:entries:create` |
| `create_ledger_refund` | `ledger:refunds:create` |

每项操作只要求自己的 scope。三个工具均为 POST，因此按工具名授权。无效令牌返回 401；权限不足返回 403，challenge 包含该操作所需 scope 和 resource metadata，客户端重新发起授权。刷新可以缩小权限，不能增加权限或改变 resource；应用显式拒绝库 1.2.4 默认静默取交集的增权请求。access token 15 分钟，refresh token 轮换，最长 30 天。官方库允许刚被替换的 refresh token 在替代 token 首次使用前重试；这不是跨用户或增权授权。

授权管理在 `/oauth/grants`，必须通过原网页登录，每页展示 20 条独立连接并可继续加载、撤销。列表 RPC 额外取一条判定下一页，读取预算 512 KiB，覆盖合法长客户端 URL 与名称。网页退出不会自动撤销 MCP 授权。重新授权建立新连接，不改变旧连接；无需继续使用的旧连接应明确撤销。数据库只保存授权标识、owner、客户端标识及名称、资源、scope、时间和官方 grant 标识，不保存 access/refresh token、授权码、Client Secret 或邮箱。客户端名称用纯文本渲染。

固定依赖 1.2.4 的三个内部诊断路径未经过 `onError`，可能记录客户端可控 URL 或原始异常。安装、构建和接口测试前均执行 `scripts/patch-oauth-provider.mjs`：校验原始 JS 的 SHA-256，仅将三条诊断改成固定消息，不更改协议逻辑；重复执行幂等，依赖内容变化时拒绝继续，升级须重新审查补丁。

## 环境和路由

- `MCP_OAUTH_ISSUER`：固定规范 origin，生产为 `https://lifespace.onepeace.cc.cd`；只允许 HTTPS，显式 localhost/127.0.0.1/::1 开发环境可用 HTTP。resource 固定为 issuer + `/api/agent/mcp`。其他 Host 不得改变 issuer。
- `OAUTH_KV`：专用 namespace，不能与旧测试、其他 issuer 或星座缓存混用。部署前显式绑定已核对的 namespace ID；不依赖部署工具自动创建未知资源。
- `global_fetch_strictly_public`：CIMD 必需，配合官方库的 HTTPS、大小、超时及 redirect 校验防 SSRF；不加载客户端 logo 或任意脚本。
- `MCP_OAUTH_DCR_ENABLED=true`：仅为已验证需要 DCR 的客户端开放 `/oauth/register`。默认关闭，不把 DCR 作为新客户端的首选。注册结果、scope 和回调仍由官方库及用户同意验证。
- `MCP_ALLOWED_ORIGINS`：可选的精确 Origin 逗号列表，不含通配符；同源网页自动允许。其他带 Origin 的请求（含 OPTIONS）拒绝。metadata、token 与 MCP 的 CORS 仅回显已允许 Origin，不使用 `*`。非浏览器客户端可以不带 Origin。
- `MCP_LEGACY_ENABLED=true`：按实际旧客户端需要开启 `/api/agent/legacy/mcp`；其 `CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD` 和绑定沿用 [旧通道管理](agent-access-bindings.md)，不自动创建或迁移真实绑定。

Wrangler 的 `run_worker_first` 包含 `/api/*`、`/.well-known/*`、`/oauth/*`。AS metadata、token、register 由服务端处理；授权和管理页才返回 SPA，未知服务端路径返回 404 JSON。认证与授权响应为 `no-store`，授权页禁止 framing，并使用 no-referrer；不削弱已有静态资源的完整 CSP。浏览器 token 只在同源 API 请求 Authorization 头内发送。

本地开发将忽略的 `.dev.vars` 中 `MCP_OAUTH_ISSUER` 设置为实际本机预览 origin（如 `http://127.0.0.1:5193`）；先用 Orca ports 核对端口。不会把开发 issuer 提交进生产配置。

## 撤销和故障边界

`agent_oauth_grant_revoke` 在 PostgreSQL 主库提交 `revoked_at` 后返回。每次 MCP 授权解析和 code/refresh 兑换都重新调用主库 RPC，不缓存、不走只读副本；后续开始的检查返回无效授权，即使另一区域的 KV 仍保留旧令牌。code 兑换还在同一数据库更新中原子认领使用标记，阻止跨地区旧 KV code 重放。数据库或 Supabase Auth 管理服务不可用返回 503，拒绝访问；未知/禁用/删除用户、未验证邮箱和白名单撤销继续拒绝。

撤销与正在处理的请求并发时，以**数据库授权检查的语句快照**为边界：在撤销提交之前已读到允许状态的请求可以继续；之后新开始的检查拒绝。撤销不会收回已返回数据、取消远端正在执行的账单事务或回滚在途请求。KV 清理故障不撤销数据库的拒绝状态，UI 不会误报为未撤销。

官方 RFC 7009 revocation endpoint 与 token endpoint 同为 `/oauth/token`，按官方库要求提交 token 与客户端鉴权信息。单枚 access token 撤销不撤销整条连接；refresh token 撤销撤销该库 grant，均受 KV 传播窗口影响。本站管理页的数据库撤销才提供上述新解析拒绝边界。异地真实传播验收与模拟旧 KV 测试分开记录。

## 生产阶段与回退门禁

2026-11-14 只读核对得到：Cloudflare 账户为仓库 Wrangler 账户，Access 应用 `e334ecac-3f93-4650-a0eb-39ab1fe02437`（LifeSpace Agent MCP）精确保护 `lifespace.onepeace.cc.cd/api/agent/mcp`；destination 相同，存在两条 `non_identity` 策略，`options_preflight_bypass=false`。这会拦截标准 MCP 首次请求。Supabase 项目 `zvdcjzjfhkjasikchceo` 现有 `agent_identity_bindings` 启用 RLS，尚无 `agent_oauth_grants` 或同名函数。本轮只读核对未改变两平台生产配置。

| 阶段 | 门禁、证据与回退 |
| --- | --- |
| 本地交付 | 固定提交双轴评审、密钥扫描、CI validate；真实隔离 SQL/运行时及网页验证完成，用户对具体 PR/配置确认后才执行下列生产步骤 |
| 授权存储 | 完整读取并一次提交 [迁移](../db/agent/migrations/20261114130000_agent_oauth_grants.sql)，预检单次传输限额；此迁移是 additive，不变更旧绑定及账单。核对 RLS、表无公开权限、RPC 仅 service_role、用户 FK 和函数签名；保留新表即可回退旧 Worker，不删除授权审计状态 |
| 准备资源 | 专用 OAUTH_KV、固定 issuer 和实际客户端所需注册方式；仅新建空 namespace 不会改变生产 Worker。绑定 ID、变量及旧通道开关纳入 PR，不通过 Dashboard 普通变量作唯一依据 |
| Worker 发布 | 合并 PR 后核对 Workers Builds 的提交 SHA 和版本；在 Access 仍保护标准入口时，验证 metadata、OAuth 路由及 REST 拒绝。旧路径切换时存在短暂连接中断，维护窗口先告知用户 |
| Access 精确切换 | 先读取完整当前配置并安全备份（不含 Service Token secret）；将上述应用的 domain 与 public destination 从 `/api/agent/mcp` 精确改为 `/api/agent/legacy/mcp`，保留应用 ID/AUD、两条策略及其他设置，禁止扩大到整域 bypass。再核对标准地址无凭据返回 Worker 401、旧地址保持 Access 保护 |
| 客户端及异地验收 | 实际版本客户端完成 URL 发现、登录、同意/拒绝、刷新、scope 增权、重连和撤销；至少异地只读验证数据库撤销后的拒绝。写入验收只用隔离合成账单；未验证项分别保留，不能用 HTTP 模拟代替 |
| 回退 | 需用户授权：先将 Access 精确恢复原 domain/destination 和原策略，再恢复旧 Worker 版本，避免旧 Service Token 入口暂时公开。保留新授权表、KV 及原绑定；必要时先在数据库撤销新 grant，不改账单，不删除用户或原 Service Token |

上述阶段尚未执行生产变更。不得把方案批准或本地通过作为任意生产迁移、Access 修改或直接上线的授权。

## 验证入口

常规 `npm run test:api` 包含官方库完整模拟流程及旧账单契约回归；`npm run build` 后，配置本机 PG17、PostgREST 与动态库，执行：

```sh
npm run test:database -- --ledger
npm run test:database -- --ledger --api tests/api/mcp-oauth-database.test.ts tests/api/mcp-oauth-runtime.test.ts
PLAYWRIGHT_PORT=5193 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser -- tests/browser/mcp-oauth.spec.ts tests/browser/auth.test.ts tests/browser/shared-shell-scope.spec.ts
```

第二项在真实 workerd + KV + 一次性 PostgreSQL 中完成发现、同意、PKCE、刷新及撤销；Auth 身份服务为合成边界，不能称真实 Supabase Auth 或真实目标客户端验收。真实隔离账单测试覆盖原三个工具的 owner、余额、退款和幂等。最终证据见 [验收记录](qa-mcp-oauth.md)。
