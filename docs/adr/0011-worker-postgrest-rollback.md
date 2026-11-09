# 业务数据库访问回滚到 PostgREST 事务 RPC

状态：2026-11-09 已采纳；PR #155 已完整撤回 pg／Hyperdrive 业务实现并上线（main `622b5d41f921c086d9ce89987cfa7ba40f130960`，生产 Active `5c5b2377-d4ef-4434-8a85-7f2f6903407c`）。随后一次经修剪的配置 PR 只重提原 PR #150 中有用的监控／预发／部署改进，不改变本决定。

## 背景

PR #150 将全部业务读取和写入改为 Worker 内的 `pg.Client` → Hyperdrive → PostgreSQL，并由 TypeScript 编排事务。上线后用户核查数据库函数，先要求继续把业务函数迁移到 TypeScript，随后取消该方向并明确要求：“回滚至 worker-pg REST api-pgsql，本次改的其他配置可以保留。”用户进一步确定顺序：先把 main 整体回滚，之后再把有用配置修剪后重新提交。本决定是对业务数据访问的选择性回滚，不是对 PR #150 全部配置的整树回退。

## 决定

业务数据库访问恢复为 Worker → Supabase Data API／PostgREST → PostgreSQL RPC。冒险命令、预览、读取、历史与成长，账本账户、普通流水、退款、转账、余额、删除，Agent owner 绑定解析和首页旧待办均使用原受控 RPC／REST 入口。Worker 继续逐次验证身份、准入、请求结构和响应；可信 owner 由 Worker 注入，浏览器和 Agent 不能指定。数据库函数在单次调用内完成行锁、版本检查、请求幂等、余额／额度检查、事实与事件写入及提交或回滚。

以下当前行为保持不变：

- 最新页面、HTTP／MCP 契约、错误分类、分页与版本快照、并发退款额度、转账双侧余额联动、历史事实、XP 奖励和请求幂等。
- 前端 Supabase Auth SDK 直连、Worker 在线会话核验、邮箱白名单、Agent Access 验签及独立凭据绑定。
- 固定 GitHub `preview` 分支与原生 Worker Preview、`main` 生产流程、域名、Secret、Auth 在线检查，以及 observability、Logs／Traces、全量采样、持久化、invocation logs、查询串脱敏和生产／Preview 同配守卫。
- 原 PR #150 引入的 Hyperdrive 资源、专用 `lifespace_worker` 角色和 RLS 迁移先保留闲置；不删除云资源、不回收权限、不删除历史迁移、函数或业务数据。当前 Worker 配置不安装 Hyperdrive binding，也不设置本地连接串；不得把这些资源当作当前业务访问链路。

前端 SDK 不增加认证代理。Worker 不恢复应用层数据库事务管理器，也不提供 pg 与 REST 双栈开关；本决定只保留一种业务访问路径，避免生产行为依赖请求级开关。

## 测试与证据

真实链路测试使用正式 Worker HTTP 入口、正式构建的 workerd 和本机真实 PostgREST → 隔离 PostgreSQL 17。Vitest 适配器只替换 Auth 身份并转发 `/rest/v1/rpc/*`，不模拟 RPC 返回值；运行器在数据库和 PostgREST 就绪后执行 API 与浏览器场景。生产构建冒烟不安装 Hyperdrive binding，只允许 Auth 与 REST 请求，从而在业务代码误回 pg 时直接失败。

`pg` 包仅保留为测试／开发依赖，供测试夹具直接核对数据库事实；生产 Worker 不导入 `pg`，构建产物不含 `pg-cloudflare` 或业务数据库连接串。隔离测试库中的 `public.tasks` 仅用于首页旧待办链路验证；生产已由用户删除该表，不回建。

CI 使用两个独立的空 PostgreSQL 17 容器，固定下载并校验 PostgREST SHA-256；`preview` 分支的推送和 PR 也执行同一套必需检查（不因此自动部署）。GitHub `preview` 的部署只由 `npm run preview` 在 `preview` 分支上执行，功能分支和 main 被脚本拒绝。

## 后果与回退

旧 RPC 函数、历史迁移和业务事实继续保留，因此本次回滚不需要数据库 DDL／DML。若要恢复 2026-11-08 的 pg 路径，需从历史提交 `2a1e49d`（PR #150）取回业务代码与测试，另按 [ADR 0010](0010-worker-postgres-transactions.md) 重新确认 Hyperdrive、专用角色、RLS、TLS、连接预算和部署守卫，并重新运行真实 pg 事务验收；不得直接部署旧 Worker 版本覆盖固定分支、原生 Preview、Secret 和 observability 配置。

本决定替代 ADR 0010 中“业务读取和写入不再经过 Data API／PostgREST”及“TypeScript 承载多语句事务编排”的实现选择；ADR 0010 保留为历史记录，ADR 0002 的事务 RPC 调用链及 ADR 0008 的数据库事务函数选择在本决定范围内恢复有效。

依据：[PostgREST RPC](https://docs.postgrest.org/en/v13/references/api/functions.html)、[Supabase Data API](https://supabase.com/docs/guides/api)、[Issue #149](https://github.com/PancrasDuan/lifespace/issues/149)。
