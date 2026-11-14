# Agent 账单 MCP 接口

标准入口为 `/api/agent/mcp`，采用 OAuth Bearer、授权码 + PKCE 和独立 MCP token；#193 的实现与生产启用状态见 [OAuth 运维说明](mcp-oauth-operations.md) 和 [ADR 0012](adr/0012-mcp-oauth-grants.md)。#130 的旧 Service Token 方案按需迁到显式开启的 `/api/agent/legacy/mcp`，原绑定只用于旧通道。#151 的三个工具继续与网页共用校验、错误和数据库事务，网页 REST 继续使用 Supabase 登录。
## 工具与 REST 契约

- `list_ledger_accounts` 返回本人完整账户列表和版本，包括账户名称、标识及余额；与 `GET /api/ledger/accounts` 共用空参数校验与服务。
- `create_ledger_entry` 与 `POST /api/ledger/entries` 共用普通收支创建契约，字段及校验提示一致；分类代码和名称来自共享定义。
- `create_ledger_refund` 与 `POST /api/ledger/entries/:id/refunds` 共用退款服务。MCP 的 `id` 对应 REST 路径参数 `id`，其余 `requestId`、`amountCents`、`occurredAt`、`note` 与 REST 请求正文一致，不再使用另一套父标识名称。金额为 1–99,999,999,999 正整数分；时间为 UTC 秒精度；备注必填、可空，trim 后最多 500 个 Unicode 码点。额外字段及非法输入均由同一业务校验处理，非法父标识同样返回 `NOT_FOUND`。

| 内容 | REST | MCP |
| --- | --- | --- |
| 父支出标识 | 路径 `:id` | `arguments.id` |
| 退款正文 | 四个业务字段 | `arguments` 中同名四个字段 |
| 成功数据 | `{ entryId, version, deleted }` | `result.structuredContent` 和文本内容中的相同数据 |
| 业务错误体 | `{ error: { code, message } }` | `result.structuredContent` 和文本内容中的相同错误体 |

两种入口共用业务参数校验、成功数据及错误序列化，错误代码和具体校验提示不再由 MCP 单独改写。REST 契约保持不变；MCP 必须保留 [JSON-RPC 与工具结果封装](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：业务失败使用 HTTP 200 的 `result.isError: true`，REST 仍使用原业务 HTTP 状态码。无效 JSON-RPC、未知工具及非对象的工具参数属于协议错误，继续使用 MCP 协议错误响应；鉴权仍发生在工具执行之前。

退款固定新增关联收入，账户与分类继承父支出，原支出金额不变；父资格、累计退款额度、时间、余额、幂等及未知结果语义均沿用 [现有退款契约](ledger/api.md)。每笔普通创建或退款的 `requestId` 必须唯一，两者共用当前所有者的请求号空间。结果未知时只用原编号及原参数重试，不生成新编号；成功请求在已全退、余额变化或父子删除后仍返回原回执和当前版本，`deleted: true` 不会重建或恢复流水。修改原请求参数返回 `REQUEST_ID_REUSED`。

本次只增加退款工具，取消获取流水的 MCP 工具；保留原有账户查询和普通创建。不提供转账、删除、流水详情、列表或历史搜索。退款前由用户从财务页提供父支出详情，Agent 完整展示父关联（标识、原金额及时间）、本次退款金额与时间、继承账户（标识和当前名称）及分类、备注，等待明确确认；字段改变后重新完整展示并确认。信息不足时补齐核对，不猜测关联。服务端只能校验业务事实，不能独立证明外部对话已确认；未知结果继续原请求重试，不因重新核对改用新请求号。

### MCP v2 兼容性

`serverInfo.version` 升为 `2.0.0`，MCP 协议协商版本保持原值。全部三个工具的业务错误体统一为 REST 的 `{ error: { code, message } }`；客户端须从 `structuredContent.error` 读取错误，不能继续读取 v1 的顶层 `code`／`message`。账户工具的额外查询字段也统一返回业务 `INVALID_QUERY`，普通创建与退款均保留 REST 的具体校验提示和未知结果消息。成功业务数据不变。

标准入口按已配置的精确 Origin 列表支持 CORS/OPTIONS；旧入口继续拒绝浏览器 Origin。OAuth 权限不足在工具业务错误 catch 之外返回 HTTP 403 和所需 scope；不得将其封装为 HTTP 200 的业务失败。认证无效返回 HTTP 401 Bearer challenge。各工具所需权限见 [OAuth 运维说明](mcp-oauth-operations.md#客户端与用户)。

## 接入和发布前置

标准客户端只配置 MCP URL，再按照 metadata 完成客户端识别、网页登录、明确同意与 PKCE。不要把网页 Supabase access/refresh token 配给 Agent。授权管理、逐请求准入、撤销边界、生产 Access 的精确迁移及回退门禁见 [OAuth 运维说明](mcp-oauth-operations.md)。

## 旧 Service Token 配置示例

以下是本地 Codex 的配置形状；环境变量需由使用者通过安全方式在 Codex 进程环境中提供，不要将真实值写入配置文件。`env_http_headers` 的可用性与运行位置、Codex 版本有关，部署前须实测。[Codex 配置参考](https://developers.openai.com/codex/config-reference)

```toml
[mcp_servers.lifespace]
url = "https://<lifespace-host>/api/agent/legacy/mcp"

[mcp_servers.lifespace.env_http_headers]
CF-Access-Client-Id = "LIFESPACE_ACCESS_CLIENT_ID"
CF-Access-Client-Secret = "LIFESPACE_ACCESS_CLIENT_SECRET"
```

此示例未提供凭据。对浏览器、远程托管环境及不同 Agent，不保证可读取本地环境变量；须使用对应客户端支持的安全凭据配置方式。

## 测试与回退

运行接口测试、类型检查、构建及隔离数据库测试；隔离数据库验证覆盖绑定、禁用、跨账户拒绝、REST／MCP 成功与错误契约一致、退款事实及余额、并发额度、时间和余额边界、事务回滚、请求编号去重及提交后响应丢失。完整账单隔离测试为 `npm run test:database -- --ledger`；单独 Agent 链路可加 `--api tests/api/agent-mcp-database.test.ts`，所需本机工具见 [账单测试说明](ledger/api.md)。签名使用合成密钥，Auth 与公钥服务在测试中受控；账单服务、绑定解析及 PostgreSQL／PostgREST 为真实隔离链路。真实 Cloudflare、Supabase Auth 管理接口和目标 Agent 仍需分别验收，不能用 HTTP 模拟替代。退款扩展未新增这些配置；#193 OAuth 另有授权表迁移、专用 KV 与 Access 路径调整，须按运维门禁执行。

旧通道回退先停用绑定及对应 Cloudflare Service Token；保留数据库绑定表与限制性权限。必要时回退 Worker 代码，但不删除或更改已有账单。已通过鉴权的在途请求不自动回滚。
