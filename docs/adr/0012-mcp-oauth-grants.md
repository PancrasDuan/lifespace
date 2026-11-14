# MCP 使用独立 OAuth 授权，网页登录继续由 Supabase 管理

Issue [#193](https://github.com/PancrasDuan/lifespace/issues/193) 已获方案实施授权。标准 `/api/agent/mcp` 改用 Cloudflare 官方 `@cloudflare/workers-oauth-provider@1.2.4` 的授权码 + PKCE S256，签发仅面向该 MCP resource 的不透明令牌。授权服务器与现有 Hono API 在同一 Worker，使用库的 `OAuthAuthorizationServer` 与 token/consent helpers，复用原账单服务；固定 issuer 来自服务端配置，不能由请求 Host 或客户端参数决定。

此决定替代 [ADR 0009](0009-agent-service-token-access.md) 中“优先手动发放 Service Token、不建设用户同意和管理页面”的选择，保留其独立凭据、逐请求在线准入、owner 隔离和在途边界。旧机器凭据仅可用于显式开启的 `/api/agent/legacy/mcp`，仍使用原绑定和 Access 校验。OAuth `client_id` 表示应用，同一应用可由多个用户授权；owner 从经过验证的 grant 取得，不经过机器绑定表。

Supabase SDK 继续管理浏览器会话。授权页通过原在线网页登录检查取得可信用户，并使用官方库的浏览器绑定、一次性 consent handle；网页 access/refresh token 不交给客户端。MCP token 不符合网页 REST 凭据契约，也不透传给 Supabase。三个工具分别检查 `ledger:accounts:read`、`ledger:entries:create`、`ledger:refunds:create`；scope 不足返回 HTTP 403 challenge，账单业务错误保留原 MCP 封装和 REST 数据契约。协议协商仍为 2025-11-25，不宣称整体升级到 MCP 2026。

KV 负责官方 OAuth 状态，数据库 `agent_oauth_grants` 负责业务授权。授权、工具请求及 code/refresh 兑换均在线核对业务授权；数据库原子标记 code 已兑换，拒绝 KV 旧副本中的 code 重放。授权管理先提交数据库撤销，再尽力删除 KV；**撤销提交后开始的数据库检查拒绝新调用及续期**。已通过检查的在途请求可以完成，不自动回滚。用户禁用、删除及白名单变化仍逐请求核对，存储或身份服务故障拒绝访问。RFC 7009 的单枚 token 撤销由库处理，受 KV 传播影响；需要立即停用一条连接时使用本站授权管理，不能把 KV 删除或 JWT 自然过期称为即时撤销。

每次同意产生独立、可撤销的连接记录，重新授权不会隐式撤销其他安装或扩大其权限；access token 15 分钟，业务授权及 refresh token 最长 30 天。基础发现只建议账户读取 scope，授权服务器公布全部三项权限；用户可明确选择其他权限。预注册信息优先，启用 CIMD 及其 SSRF 保护兼容标志；DCR 通过显式配置按已验证客户端的兼容需要启用。生产迁移、Access 路径调整和具体 PR 合并发布仍须按交付流程授权，步骤见 [运维说明](../mcp-oauth-operations.md)。
