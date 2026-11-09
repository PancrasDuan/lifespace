# 业务数据库访问与 #149 选择性回滚

2026-11-09，按 Issue #149 的决定，业务数据库访问回滚为 Worker → Supabase Data API／PostgREST → PostgreSQL。PR #155 已完整撤回 pg／Hyperdrive 业务实现并合并到 main（`622b5d41f921c086d9ce89987cfa7ba40f130960`，生产 Active `5c5b2377-d4ef-4434-8a85-7f2f6903407c`）。随后一次经修剪的配置 PR 只重提原 PR #150 中有用的监控、预发和部署守卫；业务访问仍只有 REST／RPC 一条路径。原 pg 实现见 [ADR 0010](adr/0010-worker-postgres-transactions.md)（历史），当前决定见 [ADR 0011](adr/0011-worker-postgrest-rollback.md)；五表／四表、账户锁、版本、幂等和历史事实规则继续有效。前端 Supabase Auth SDK、Worker 在线身份核验、白名单和 Agent Access 准入不变。

本次配置重提仍属需确认的变更：实现、验证和可评审 PR 已完成授权；合并、生产发布、预览分支推送、数据库 DDL／DML、删除 Hyperdrive／角色／旧函数和套餐变更均需另行确认。

## 代码与一致性边界

| 入口 | 当前实现 |
|---|---|
| 人生冒险页面读取、任务列表、历史、成长、奖励来源、迁移候选 | `worker/adventure/planning.ts` 调用既有 `adventure_*` RPC |
| 人生冒险命令、预览、奖励、终态和快照 | 同一 HTTP 适配器调用 `adventure_planning_command`／`adventure_planning_preview` |
| 财务账户、普通／退款／转账、余额、删除及分页 | `worker/ledger.ts` 调用既有 `ledger_*` RPC |
| 共享首页旧待办 | `worker/tasks.ts` 读取 `/rest/v1/tasks`；生产该表已由用户删除，失败按数据源错误呈现 |
| Agent owner 绑定 | `worker/agent-auth.ts` 调用 `agent_resolve_owner`，随后在线核对 Auth 用户 |

Worker 只做认证、准入、严格输入校验、可信 owner 注入、有界响应和稳定错误映射。PostgreSQL RPC 在单次函数调用中持有账户／owner 锁，核对版本、历史请求回执和业务资格，在同一提交中写当前实体、事件、余额／经验与版本，失败整次回滚。不要用多次独立 REST 请求拼接业务事务，也不要增加 KV 锁或双栈开关。

`SUPABASE_URL` 与 `SUPABASE_SECRET_KEY` 仅在 Worker 服务端配置。请求使用 `/rest/v1/rpc/<name>`，`apikey` 携带服务端密钥；旧 JWT 格式密钥才额外放入 `Authorization: Bearer`。owner 参数由 Worker 用在线身份覆盖。所有数据库请求设置 10 秒超时、`redirect: 'manual'`、响应体上限，并将数据库固定业务错误映射为既有 API／MCP 错误体；未知驱动、SQL、连接串和上游详情不进入响应或日志。

## 重提的原 PR #150 运维配置

以下内容不是业务数据库访问路径，本次按原 PR #150 修剪后重提：

- 固定 GitHub `preview` 分支、原生 Worker Preview 上传脚本与分支守卫、`main` 生产分支、自定义域名和 workers.dev 设置。
- `wrangler.jsonc` 的 `previews` 区块、共享 KV／ratelimit、Secret 清单、Auth 前端公开配置和在线准入。
- observability、Logs、Traces、全量 `head_sampling_rate`、持久化、invocation logs、查询串脱敏，以及生产／Preview 同配检查。
- 部署前的 Supabase Data API 地址与 Secret 声明守卫、构建产物 `.dev.vars` 清理、`preview` 脚本参数限制。
- CI 的 `preview` 分支触发、双 PostgreSQL 17 服务、固定 PostgREST 下载与真实 REST 数据库回归。
- Gitleaks／PostgREST 官方资产下载的官方 API 备用路径与固定 SHA-256 校验。

未重提的 pg 专属内容：`worker/database.ts`、`ledger-data.ts`、冒险 TS 事务编排模块、Hyperdrive binding／`localConnectionString`、`HYPERDRIVE` 类型声明，以及 `db/migrations/20261108000000_worker_database_role.sql` 的源码。`lifespace_worker` 角色、RLS 和该迁移记录仍在生产保留（记录 `20261108110124`），不删除、不扩权、不重执行、不反迁移；迁移源码只保留在 PR #150 的提交历史中。

`pg` 包仅为开发依赖，供隔离测试夹具直接核对数据库事实；生产 Worker 不导入 `pg`，构建产物不含 `pg-cloudflare` 或业务数据库连接串。

## 本地与 CI

Node 使用项目指定版本。安装 `npm ci` 后运行 `npm run build`。真实数据库测试需要 PostgreSQL 17 与 PostgREST 13.0.7：

```bash
POSTGRES_BIN=<PG17-bin> POSTGRES_LIB=<PG17-lib> POSTGREST_BIN=<PostgREST13.0.7> \
  npm run test:database -- --ledger --runtime --browser
POSTGRES_BIN=<PG17-bin> POSTGRES_LIB=<PG17-lib> POSTGREST_BIN=<PostgREST13.0.7> \
  npm run test:database -- --browser
```

运行器在随机回环端口创建独立 PostgreSQL 17，安装两份领域结构、历史夹具、测试触发器和仅测试用的 `public.tasks` 夹具，再启动真实 PostgREST。Vitest 适配器只替换 Auth 身份并转发真实 RPC；`--runtime` 直接运行 `dist/lifespace/index.js` 的 workerd 构建，不安装 Hyperdrive binding，业务请求只能走 Auth 与 `/rest/v1/rpc/*`。浏览器测试复用同一真实链路。隔离测试库中的 `public.tasks` 不代表恢复生产表。

CI 使用两个独立空 PostgreSQL 17 容器，固定下载并校验 PostgREST SHA-256，不注入生产密钥，不上传轨迹或业务产物。测试仍覆盖事务回滚、并发退款／转账、版本与分页、跨 owner、历史回执、成长奖励、Agent 绑定停用和首页待办。测试夹具可用 `pg` 直接读取隔离库核对事实，但生产 Worker 不导入 `pg`。

## 发布与回退

1. 恢复 REST 不需要生产 DDL／DML；旧函数和 `service_role` EXECUTE 权限已保留。发布前只读核对 20 个 RPC 入口、函数定义和权限，并用真实隔离 PostgreSQL + PostgREST + 正式构建 workerd 复验。
2. 对具体 PR 完成密钥扫描、类型、构建、真实 REST 数据库、浏览器、必需 CI 和双轴评审。合并发布由用户按项目流程确认；本轮不部署 preview、不推生产、不修改 Cloudflare 配置。
3. 发布后先验收页面、登录、冒险、财务、Agent MCP 和首页待办错误边界；观察错误率与延迟。首页 `public.tasks` 仍保持删除状态；数据源不可用不得伪装成空列表。
4. 若要恢复 pg 路径，从提交 `2a1e49d`（PR #150）取回实现，按 [ADR 0010](adr/0010-worker-postgres-transactions.md) 重新确认 Hyperdrive／TLS／专用角色／RLS、连接预算、部署守卫和回退版本，并重新安装 binding；不要直接部署旧 Worker 覆盖当前 preview、域名、Secret 或 observability 配置。反过来，若以后要清理闲置 Hyperdrive／角色，必须先确认 REST 已稳定且获得单独授权。

官方依据：[PostgREST 函数](https://docs.postgrest.org/en/v13/references/api/functions.html)、[Supabase Data API](https://supabase.com/docs/guides/api)、[Cloudflare Workers 可观测性](https://developers.cloudflare.com/workers/observability/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)。
