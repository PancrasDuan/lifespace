# 已退役 Agent 凭据绑定的保留边界

[#204](https://github.com/PancrasDuan/lifespace/issues/204) 退役 #130 的 Service Token 通道。`/api/agent/legacy/mcp` 固定 404；绑定表不再是在线鉴权入口，不应新建、发放或启用旧凭据。标准 OAuth 的 `client_id` 表示应用，owner 由可信 grant 确定，管理见 [OAuth 运维说明](mcp-oauth-operations.md)。生产停用及 Access 清理按 [退役清单](mcp-legacy-retirement.md) 执行；仓库变更不代表生产资源已清理。

## 保留的数据与权限

历史迁移 [20261106031343_agent_access_bindings.sql](../db/agent/migrations/20261106031343_agent_access_bindings.sql) 及 `agent_identity_bindings` / `agent_resolve_owner(text)` 保留，便于审计和历史结构验证。本任务不执行 DROP TABLE，不删除历史绑定，也不修改 OAuth 授权或账单数据。

表只保存 Client ID、关联 `auth.users.id`、启用状态、备注和创建时间，不保存 Client Secret、访问断言或邮箱。Client ID 唯一，新记录默认停用；原用户删除时关联绑定级联删除。RLS 与原权限继续保留：`anon` / `authenticated` 无表及 RPC 权限；`service_role` 可读取、解析，无写权限。管理员仅停用经核对属于本项目的旧记录。

历史 RPC 对启用记录返回 owner、未知或停用返回 null；保留它不表示 Worker 仍接受旧凭据。OAuth 在线用户/白名单检查不依赖它。不可通过恢复绑定或开关回退本次退役。

## 隔离验证

`npm run test:database -- --ledger --api tests/api/agent-bindings-database.test.ts` 保留真实 PostgreSQL/PostgREST 的历史结构、RLS、角色权限和停用解析探针。它不验证旧 Worker 通道可用。当前 MCP 工具和授权贯通改由 OAuth 测试覆盖，环境要求见 [账单测试说明](ledger/api.md)。
