# MCP 仅保留独立 OAuth 接入，退役 Service Token 兼容通道

用户在 [#204](https://github.com/PancrasDuan/lifespace/issues/204) 要求旧兼容模式下线。标准 OAuth 已独立按可信 grant 确定 owner；继续维护旧 Access JWT、机器绑定和开关会保留另一条准入路径。因此移除旧校验与开关，`/api/agent/legacy/mcp` 在业务鉴权前永久返回 404，即使部署遗留旧配置也不能恢复。此决定替代 [ADR 0012](0012-mcp-oauth-grants.md) 中保留显式开启 legacy 通道的部分，及 [ADR 0009](0009-agent-service-token-access.md) 的在线 Service Token 接入方式；OAuth 的用户/白名单在线核验、scope、撤销与在途边界继续有效。

数据库保留 `agent_identity_bindings`、受限 RPC 及原迁移，停用本项目旧记录以保留追溯；不改变 `agent_oauth_grants`、OAuth KV、既有连接、用户或账单。生产必须先核验拒绝旧入口的 Worker 已发布，才停用绑定、撤销专用 Service Token、移除精确保护 legacy 的 Access 应用/策略和无用配置。任何共享对象均留存。具体门禁、对象与回退见 [退役清单](../mcp-legacy-retirement.md)。退役不取消已通过旧版本鉴权的在途业务，发布和破坏性外部清理仍按项目分级取得具体授权。
