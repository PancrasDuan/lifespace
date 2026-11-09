# 业务数据库通过 pg 与 Hyperdrive 访问，由 Worker 编排事务

状态：2026-11-08 曾按 Issue #149 的方向实施并上线（PR #150）；2026-11-09 已被 [ADR 0011](0011-worker-postgrest-rollback.md) 替代，并由 PR #155 完整撤回。本文仅保留为历史记录和恢复 pg 路径的依据，不再代表当前实现。

> 历史说明：pg／Hyperdrive 业务代码只存在于提交 `2a1e49da2572d3daf5d18109babab4fbd400f88e`（PR #150）及其后续预发／监控提交中；main 在 PR #155 后已不含 `worker/database.ts`、TS 事务编排模块或 Hyperdrive binding。生产仍保留已应用的 `lifespace_worker` 角色与 RLS 迁移（迁移记录 `20261108110124`），源码不重新放回 `db/migrations/`，避免被误当作待执行迁移；该迁移不会重执行，也不会反迁移。

Worker 使用请求内的 `pg.Client`，通过 Hyperdrive 连接 Supabase PostgreSQL，业务读取和写入不再经过 Data API。适合应用层维护的命令校验、幂等判断、奖励和余额规则及多语句事务编排移到 TypeScript；约束、索引、行锁和集合查询继续由 PostgreSQL 执行。此决定替代 ADR 0002 中“所有业务写入通过事务 RPC”“Worker 不增加应用层事务管理器”的限制，以及 ADR 0008 中由数据库事务函数承载编排的实现选择；五表／四表、账户锁、历史事实、版本和请求回执决定保持。

每次操作新建 client，BEGIN、全部查询及 COMMIT／ROLLBACK 固定同一连接，最终关闭 client；跨请求连接复用由 Hyperdrive 管理。不得用 KV 锁替代账户级数据库锁。专用登录角色不具有超级用户、BYPASSRLS、DDL、删除历史或 Auth 表权限；业务表使用事务内 owner 上下文和 RLS。Agent 绑定仅授予读取启用绑定的权限。Worker 仍在建立业务事务前完成在线身份和准入检查。

Hyperdrive 查询缓存关闭，以保持写后读、版本快照和凭据停用语义。生产连接采用 Supabase 直连端点和 TLS 身份验证，避免叠加 Supavisor；本地及 CI 使用隔离 PostgreSQL 和相同运行时代码，不依赖生产凭据。数据库位于新加坡；连接预算与 placement 依据实际容量和测量确定，不能从区域名直接推断最佳设置。Free plan 优先，不自动升级。

旧函数和历史迁移保留，作为渐进切换、行为对比及兼容回退的依据，不在本票删除已有数据。切换前安装增量权限迁移并验证新角色；回退时协调旧 Worker 与原有 RPC 权限，不回滚业务事实或余额。Supabase Auth 的前端 SDK、会话及 Worker 在线检查保持 ADR 0001／0009 的契约，不增加认证代理。

依据：[pg 事务](https://node-postgres.com/features/transactions)、[Hyperdrive 连接生命周期](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)、[Supabase 接入](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)。
