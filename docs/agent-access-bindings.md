# 已退役 Agent 绑定存储

[#204](https://github.com/PancrasDuan/lifespace/issues/204) 已使旧 `/api/agent/legacy/mcp` 固定404，并完成旧凭据、Access、配置与两条绑定记录的清理。用户进一步要求移除空表；迁移 [20261115151152_retire_legacy_agent_bindings.sql](../db/agent/migrations/20261115151152_retire_legacy_agent_bindings.sql) 删除 `agent_identity_bindings` 及 `agent_resolve_owner(text)`。决定见 [ADR 0016](adr/0016-remove-legacy-agent-bindings.md)，生产具体执行证据见 #204 关联 PR。

标准 OAuth 的 `client_id` 表示应用，owner由可信 grant 确定，不使用机器绑定表；原用户/白名单仍在线核验。管理见 [OAuth 运维说明](mcp-oauth-operations.md)。

历史创建迁移 [20261106031343_agent_access_bindings.sql](../db/agent/migrations/20261106031343_agent_access_bindings.sql) 保留追溯，新环境按顺序运行迁移后也不存在旧对象。不应重新创建绑定、发放旧凭据或恢复旧入口。删除前备份真实表/RPC定义、索引/约束、RLS/策略及ACL；详见 [清理与恢复门禁](mcp-legacy-retirement.md#空表与-rpc-收尾)。

`npm run test:database -- --ledger --api tests/api/agent-bindings-database.test.ts tests/api/agent-mcp-database.test.ts tests/api/mcp-oauth-database.test.ts` 在真实隔离PostgreSQL/PostgREST中验证迁移拒绝/回滚及重放、旧表/RPC不存在，并继续运行OAuth与账单事务；环境要求见 [账单测试说明](ledger/api.md)。
