# Agent 账单 MCP 接口

标准入口为 `/api/agent/mcp`，采用 OAuth Bearer、授权码 + PKCE 和独立 MCP token；#193 的实现与生产启用状态见 [OAuth 运维说明](mcp-oauth-operations.md) 和 [ADR 0012](adr/0012-mcp-oauth-grants.md)。#204 永久退役 #130 的旧 Service Token 通道；`/api/agent/legacy/mcp` 在鉴权前固定返回 404，旧请求头与残留开关均不能启用。现有五个工具继续与网页共用校验、错误和数据库事务，网页 REST 继续使用 Supabase 登录。

## 工具与 REST 契约

- `list_ledger_accounts` 返回本人完整账户列表和版本，包括账户名称、标识及余额；与 `GET /api/ledger/accounts` 共用空参数校验与服务。
- `list_ledger_entries` 与 `GET /api/ledger/entries` 共用查询解析和读取服务。`page` 默认 1，`startDate`／`endDate` 必须成对提供，可选 `accountId` 与 `version`；返回同一 `{ items, total, page, pageSize, version }`，保留北京时间自然日、账户筛选、30 条分页及版本冲突 `LIST_CHANGED` 规则。未知字段、重复或非法参数返回 `INVALID_QUERY`，不调用数据库。
- `get_ledger_entry` 与 `GET /api/ledger/entries/:id` 共用读取服务。`id` 必填，`refundPage` 默认 1，可选 `version`；返回同一 `{ entry, parentEntry, transferEntry, refunds, refundCount, refundedCents, refundPage, refundPageSize, version }`，保留本人未删除流水隔离、父流水、退款关联分页、转账对侧及版本冲突语义。非法或不存在/跨 owner 的 `id` 返回 `NOT_FOUND`；其他非法或未知查询字段返回 `INVALID_QUERY`，不调用数据库。
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

本次新增流水列表和单笔详情两个只读工具，仍不提供转账、删除、账户新增/修改或历史搜索。退款前 Agent 可用 `get_ledger_entry` 读取父支出详情，并完整展示父关联（标识、原金额及时间）、本次退款金额与时间、继承账户（标识和当前名称）及分类、备注，等待明确确认；字段改变后重新完整展示并确认。信息不足时补齐核对，不猜测关联。服务端只能校验业务事实，不能独立证明外部对话已确认；未知结果继续原请求重试，不因重新核对改用新请求号。

### MCP v2 兼容性

`serverInfo.version` 升为 `2.1.0`，MCP 协议协商版本保持原值。全部五个工具的业务错误体统一为 REST 的 `{ error: { code, message } }`；客户端须从 `structuredContent.error` 读取错误，不能继续读取 v1 的顶层 `code`／`message`。列表与详情的严格输入、业务错误和成功数据均与 REST 共用同一校验与序列化；未知字段、重复/非法参数不会调用数据库。账户工具的额外查询字段也统一返回业务 `INVALID_QUERY`，普通创建与退款均保留 REST 的具体校验提示和未知结果消息。成功业务数据不变。

列表与详情使用新增的 `ledger:entries:read` scope；旧授权不会自动获得该权限，调用时返回 HTTP 403 `insufficient_scope` challenge，重新授权并选择「读取账单流水」后方可使用。两个工具只读，注解为 `readOnlyHint: true`、`destructiveHint: false`。

标准入口按已配置的精确 Origin 列表支持 CORS/OPTIONS。OAuth 权限不足在工具业务错误 catch 之外返回 HTTP 403 和所需 scope；不得将其封装为 HTTP 200 的业务失败。认证无效返回 HTTP 401 Bearer challenge。各工具所需权限见 [OAuth 运维说明](mcp-oauth-operations.md#客户端与用户)。

新 scope 需要先应用 [授权表 scope 约束迁移](../db/agent/migrations/20261117000000_mcp_ledger_entries_read_scope.sql) 再部署本版 Worker；该迁移只扩展 `agent_oauth_grants` 的 scope CHECK，不改变账单表、数据或 RPC。未应用时新 scope 的授权写入会被数据库拒绝。

## 接入和发布前置

标准客户端只配置 MCP URL，再按照 metadata 完成客户端识别、网页登录、明确同意与 PKCE。不要把网页 Supabase access/refresh token 配给 Agent。授权管理、逐请求准入、撤销边界、生产 Access 的精确迁移及回退门禁见 [OAuth 运维说明](mcp-oauth-operations.md)。

## 测试与回退

运行接口测试、类型检查、构建及隔离数据库测试；隔离数据库验证覆盖绑定、禁用、跨账户拒绝、REST／MCP 成功与错误契约一致、列表筛选与分页、详情父流水／关联退款／转账对侧、退款事实及余额、并发额度、时间和余额边界、事务回滚、请求编号去重及提交后响应丢失。完整账单隔离测试为 `npm run test:database -- --ledger`；单独 Agent 链路可加 `--api tests/api/agent-mcp-database.test.ts`，所需本机工具见 [账单测试说明](ledger/api.md)。OAuth 测试使用真实官方库、模拟 KV 与合成 Auth；账单服务、授权检查及 PostgreSQL／PostgREST 为真实隔离链路。历史绑定测试仅保留数据库结构与权限边界，在线请求不再调用绑定解析。真实 Cloudflare、Supabase Auth 管理接口和目标 Agent 仍需分别验收，不能用 HTTP 模拟替代。退款扩展未新增这些配置；#193 OAuth 另有授权表迁移、专用 KV 与 Access 路径调整，须按运维门禁执行。

生产退役、外部对象清理及回退顺序见 [退役清单](mcp-legacy-retirement.md)。保留历史绑定表及限制性权限，不删除或更改已有账单；OAuth 授权和 KV 不因旧通道退役而撤销。
