# Agent 凭据与用户绑定

> #149：2026-11-09 起 Worker 通过 `agent_resolve_owner` RPC 逐次读取启用绑定；该 REST 链路已随 PR #155 上线，原 pg／Hyperdrive 实现保留为历史与恢复路径。当前权限与切换方案见[统一数据库访问](database-access.md)。

此文描述 Issue #130 的数据库部分；不包含 Cloudflare 凭据的创建、发放或 Agent 入口部署。迁移为 [20261106031343_agent_access_bindings.sql](../db/agent/migrations/20261106031343_agent_access_bindings.sql)，由 Supabase CLI 生成文件名。正式数据库执行前须只读核对目标项目、现有结构、权限与交付授权。

## 数据与权限

`agent_identity_bindings` 只保存 Cloudflare Service Token 的 Client ID、关联的现有 `auth.users.id`、启用状态、备注与创建时间；不保存 Client Secret、访问断言或用户邮箱。一枚 Client ID 唯一绑定一个用户；同一用户可以绑定多枚凭据。新记录默认停用，用户删除时关联记录随之删除。

表启用 RLS，`anon` 和 `authenticated` 无表或 RPC 访问权限。`service_role` 可以读取绑定表、执行 `agent_resolve_owner(text)`，没有表的写权限；创建、修改和停用绑定由有数据库管理权限的操作员在受控环境中完成。解析函数使用调用者权限，不接受客户端提供的用户标识。

`agent_resolve_owner(p_client_id text)` 对启用记录返回 `{ "ownerId": "<用户 UUID>" }`，对未知或停用记录返回 JSON `null`。调用方必须先验证 Cloudflare 签名身份断言，再将其中可信的 Client ID 交给解析函数；之后还要核验用户与准入白名单。绑定或身份服务不可用时应拒绝请求。

## 管理边界

1. 管理员在 Cloudflare 创建单独的 Service Token，核对其 Client ID；Client Secret 只安全交付使用者，不进入 SQL、仓库、日志或聊天。
2. 管理员通过受控数据库管理操作，使用已核对的现有用户 UUID 和 Client ID 创建一条**停用**绑定，确认归属后再启用。不要把客户端传入的用户标识当作可信绑定依据。
3. 停用时先关闭绑定，再在 Cloudflare 禁用或撤销对应 Service Token。新的解析请求不会再获得 owner；已在途请求不自动回滚。不同地区撤销生效时间需另行验收。
4. 需要变更归属时，建议停用旧绑定并为目标用户发放新凭据，避免误把现有凭据转交给其他用户。

此数据库迁移只新增表和受限 RPC，不创建真实绑定，也不会自动随 Worker 发布执行。若回退 Worker，应保留绑定表及限制性权限，先停用相关凭据；不要以删除表作为常规回退。

## 隔离验证

通过 `npm run test:database -- --ledger --api tests/api/agent-bindings-database.test.ts` 运行合成用户、真实 PostgreSQL 与 PostgREST 测试。该测试需要项目文档规定的 `POSTGRES_BIN`、`POSTGREST_BIN` 和必要动态库路径；临时测试库包含最小 `auth.users` 夹具，不使用真实账号或生产数据库。
