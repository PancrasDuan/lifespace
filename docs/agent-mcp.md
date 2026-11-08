# Agent 账单 MCP 接口

Issue #130 的 Agent 入口为 `/api/agent/mcp`，使用 Streamable HTTP；#151 扩展登记退款。它与现有网页普通流水及退款接口共用校验、错误与数据库事务；网页现有接口继续使用 Supabase 登录鉴权。Agent 身份和绑定配置见 [ADR 0009](adr/0009-agent-service-token-access.md) 与 [绑定管理](agent-access-bindings.md)。

## 工具

- `list_ledger_accounts` 返回本人完整账户列表和版本，包括账户名称、标识及余额。
- `create_ledger_entry` 创建一笔普通收入或支出；参数与现有创建契约一致，分类代码和名称由共享定义生成。工具要求 Agent 在对话中完整展示所有业务字段并等待用户确认。
- `create_ledger_refund` 为本人未删除的普通支出追加一笔关联收入。参数为 `parentEntryId`（父支出 UUID）、`requestId`（本次请求 UUID）、`amountCents`（1–99,999,999,999 正整数分）、`occurredAt`（UTC 秒精度时间）及 `note`（必填，可空，trim 后最多 500 个 Unicode 码点）。拒绝额外字段；方向固定收入，账户和分类继承父流水，原支出金额保持不变。复用 [退款契约](ledger/api.md) 的父资格、累计额度、时间、余额和幂等规则，成功返回 `{ entryId, version, deleted }`。

每笔普通创建或退款请求的 `requestId` 必须唯一，两者共用当前所有者的请求号空间。结果未知（`SAVE_UNKNOWN`）时只使用原编号及相同参数重试，不生成新编号；退款重试包含相同父标识、金额、时间和 trim 后备注。成功请求在已全退、余额变化或父子已删除后仍返回原回执和当前版本；`deleted: true` 不表示新建或恢复了流水。相同请求号换参数返回 `REQUEST_ID_REUSED`。接口没有自动重试，也不能独立证明外部对话中的确认。

登记退款前，Agent 必须核对父支出并完整展示父关联（标识及原支出事实）、本次退款金额与时间、继承账户（标识和当前名称）与分类、备注，等待用户明确确认；任何字段变化后重新完整展示并确认。当前没有历史流水读取工具，新建回执也不包含完整父流水。由用户从财务页提供父流水详情，结合本人账户查询核对；不能只凭金额或猜测的 ID 提交。信息不足时先补齐，不把服务端校验成功当作用户确认。可退额度在提交时由数据库按全部有效退款重新校验。

工具不提供转账、删除或通用历史流水查询。入口只接收无浏览器 `Origin` 的请求；浏览器类 Agent 是否兼容尚未验证。

## 接入和发布前置

1. 只读核对目标 Cloudflare 账户、现有 Worker 路由、Access 设置和 Supabase 项目；避免更改其他 Worker 或网页路径。分别准备测试用户及其绑定，不能使用真实流水做破坏性测试。
2. 在隔离环境部署迁移并验证；正式数据库迁移和生产 Access 配置须按项目交付流程另行审核与授权。数据库迁移不会由 Worker 自动部署执行。
3. 为目标域名的精确 `/api/agent/mcp` 路径配置 Cloudflare Access，仅允许选定的 Service Token。必须验证不经 Access 的其他域名、`workers.dev` 或预览路径不能绕过 Worker 的签名与受众检查；不得给整个业务域名套用该规则。
4. 为 Worker 配置 `CF_ACCESS_TEAM_DOMAIN`（完整 `https://<team>.cloudflareaccess.com`，不带末尾斜杠）及目标 Access 应用的 `CF_ACCESS_AUD`。两者尚未加入仓库默认部署配置；未配置时 Agent 入口拒绝请求，不影响现有网页鉴权。部署前需将非密钥配置纳入实际 Wrangler 配置或使用受控的 Worker secrets；单独在 Dashboard 设置的普通变量可能被后续 Wrangler 部署覆盖。详见 [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)。
5. 管理员为每个 Agent 创建单独的 Service Token，按 [绑定管理](agent-access-bindings.md) 核对用户后配置绑定。Client Secret 只经安全渠道交给用户，不能写入仓库、Issue、日志或对话。
6. 在隔离环境先验证 Codex 的连接、完整字段确认、账户查询、普通创建、退款与重复请求；退款还须核对父支出及继承信息、修改后再次确认与未知结果原请求重试。再检查 WorkBuddy、Grok Bot 能否携带 Access 凭据连接。同一入口的兼容性不能仅凭 HTTP 单元测试推断。

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

运行接口测试、类型检查、构建及隔离数据库测试；隔离数据库验证覆盖绑定、禁用、跨账户拒绝、退款事实及余额、并发额度、时间和余额边界、事务回滚、请求编号去重及提交后响应丢失。完整账单隔离测试为 `npm run test:database -- --ledger`；单独 Agent 链路可加 `--api tests/api/agent-mcp-database.test.ts`，所需本机工具见 [账单测试说明](ledger/api.md)。签名使用合成密钥，Auth 与公钥服务在测试中受控；账单服务、绑定解析及 PostgreSQL／PostgREST 为真实隔离链路。真实 Cloudflare、Supabase Auth 管理接口和目标 Agent 仍需分别验收，不能用 HTTP 模拟替代。本次扩展无需新增迁移、绑定或生产配置。

回退先停用绑定及对应 Cloudflare Service Token；保留数据库绑定表与限制性权限。必要时回退 Worker 代码，但不删除或更改已有账单。已通过鉴权的在途请求不自动回滚。
