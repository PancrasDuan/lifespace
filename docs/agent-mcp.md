# Agent 账单 MCP 接口

Issue #130 的 Agent 入口为 `/api/agent/mcp`，使用 Streamable HTTP。它与现有 `POST /api/ledger/entries` 共用创建校验和数据库事务；网页现有接口继续使用 Supabase 登录鉴权。Agent 身份和绑定配置见 [ADR 0009](adr/0009-agent-service-token-access.md) 与 [绑定管理](agent-access-bindings.md)。

## 工具

- `list_ledger_accounts` 返回本人完整账户列表和版本，包括账户名称、标识及余额。
- `create_ledger_entry` 创建一笔普通收入或支出；参数与现有创建契约一致，分类代码和名称由共享定义生成。工具要求 Agent 在对话中完整展示所有业务字段并等待用户确认。

每笔创建请求的 `requestId` 必须唯一；结果未知时只使用原编号及相同参数重试。接口没有自动重试，也不能独立证明外部对话中的确认。工具不提供退款、转账或历史流水查询。入口只接收无浏览器 `Origin` 的请求；浏览器类 Agent 是否兼容尚未验证。

## 接入和发布前置

1. 只读核对目标 Cloudflare 账户、现有 Worker 路由、Access 设置和 Supabase 项目；避免更改其他 Worker 或网页路径。分别准备测试用户及其绑定，不能使用真实流水做破坏性测试。
2. 在隔离环境部署迁移并验证；正式数据库迁移和生产 Access 配置须按项目交付流程另行审核与授权。数据库迁移不会由 Worker 自动部署执行。
3. 为目标域名的精确 `/api/agent/mcp` 路径配置 Cloudflare Access，仅允许选定的 Service Token。必须验证不经 Access 的其他域名、`workers.dev` 或预览路径不能绕过 Worker 的签名与受众检查；不得给整个业务域名套用该规则。
4. 为 Worker 配置 `CF_ACCESS_TEAM_DOMAIN`（完整 `https://<team>.cloudflareaccess.com`，不带末尾斜杠）及目标 Access 应用的 `CF_ACCESS_AUD`。两者尚未加入仓库默认部署配置；未配置时 Agent 入口拒绝请求，不影响现有网页鉴权。部署前需将非密钥配置纳入实际 Wrangler 配置或使用受控的 Worker secrets；单独在 Dashboard 设置的普通变量可能被后续 Wrangler 部署覆盖。详见 [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)。
5. 管理员为每个 Agent 创建单独的 Service Token，按 [绑定管理](agent-access-bindings.md) 核对用户后配置绑定。Client Secret 只经安全渠道交给用户，不能写入仓库、Issue、日志或对话。
6. 在隔离环境先验证 Codex 的连接、完整字段确认、账户查询、创建与重复请求；再检查 WorkBuddy、Grok Bot 能否携带 Access 凭据连接。同一入口的兼容性不能仅凭 HTTP 单元测试推断。

## Codex 配置示例

以下是本地 Codex 的配置形状；环境变量需由使用者通过安全方式在 Codex 进程环境中提供，不要将真实值写入配置文件。`env_http_headers` 的可用性与运行位置、Codex 版本有关，部署前须实测。[Codex 配置参考](https://developers.openai.com/codex/config-reference)

```toml
[mcp_servers.lifespace]
url = "https://<lifespace-host>/api/agent/mcp"

[mcp_servers.lifespace.env_http_headers]
CF-Access-Client-Id = "LIFESPACE_ACCESS_CLIENT_ID"
CF-Access-Client-Secret = "LIFESPACE_ACCESS_CLIENT_SECRET"
```

此示例未提供凭据。对浏览器、远程托管环境及不同 Agent，不保证可读取本地环境变量；须使用对应客户端支持的安全凭据配置方式。

## 测试与回退

运行接口测试、类型检查、构建及隔离数据库测试；隔离数据库验证覆盖绑定、禁用、跨账户拒绝和同一请求编号去重。真实 Cloudflare、Supabase Auth 管理接口和目标 Agent 仍需分别验收，不能用 HTTP 模拟替代。

回退先停用绑定及对应 Cloudflare Service Token；保留数据库绑定表与限制性权限。必要时回退 Worker 代码，但不删除或更改已有账单。已通过鉴权的在途请求不自动回滚。
