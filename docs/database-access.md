# 业务数据库访问与 #149 切换

本分支使用 Worker → `pg` → Hyperdrive → Supabase PostgreSQL。数据库访问不再依赖业务 Data API；前端 Supabase Auth SDK、在线身份校验、白名单和 Agent Access 准入继续沿用原契约。[ADR 0010](adr/0010-worker-postgres-transactions.md) 替代 ADR 0002 的事务 RPC 编排决定。本票属于需确认的变更。生产权限和 Hyperdrive 已按用户 A 授权准备，正式 Worker 尚未切流；[生产准备记录](database-production-preparation.md) 中的 Free CPU 问题仍未解决，具体 PR 合并发布尚未授权。

## 代码与一致性边界

| 入口 | 实现 |
|---|---|
| 人生冒险命令、预览、奖励、终态、快照 | `worker/adventure/commands.ts`、`model.ts`、`preview.ts` |
| 人生冒险分页、历史、成长、日期列表 | `worker/adventure/data.ts`，保留原有有界 SQL 投影及能力查询 |
| 财务账户、普通／退款／转账、余额、删除及分页 | `worker/ledger-data.ts` |
| 共享首页旧待办 | `worker/tasks.ts`，单次 SQL 快照读取 |
| Agent 凭据绑定 | `worker/agent-auth.ts`，逐次查询启用绑定后在线核对 Auth 用户 |
| 同连接事务与释放 | `worker/database.ts` |

每次数据库操作创建一个 client；BEGIN、事务内 owner 上下文、锁、全部语句与 COMMIT 固定在该 client，失败时 ROLLBACK，最后关闭连接。连接不跨请求保存，不另建 `pg.Pool`，不使用 KV 锁。锁超时 3 秒、语句和闲置事务超时 10 秒。连接或提交失败仍返回原有结果未知／暂不可用错误，调用方沿用原请求重试；不自动重试写事务。

冒险持账户行排他锁，先查历史成功回执，再检查版本与当前资格。事件、当前实体、经验、版本同事务提交。账单持 owner 版本行排他锁，退款额度、余额范围和转账两侧在锁内统一检查；读取持共享锁覆盖条目、总数与分页版本。旧函数与迁移历史保留；新角色不能执行旧写函数。SQL 投影继续维护读取能力和集合统计，写资格与预览由 TypeScript 校验；变更领域规则时须同步核对投影能力与最终写入校验。

## 权限迁移与凭据

按既有顺序安装领域迁移后，应用 `db/migrations/20261108000000_worker_database_role.sql`。迁移创建 `lifespace_worker` 登录角色，不内嵌密码；拒绝已有超级用户、BYPASSRLS 或角色成员关系。该角色只有指定业务表的 SELECT／INSERT、所需列 UPDATE、纯投影与约束辅助函数权限，没有 DDL、DELETE、Auth 表、绑定管理及历史身份列修改权限。

owner 上下文仅由通过在线认证的 Worker 在事务内设置，RLS 对读写都检查该上下文。无上下文看不到个人业务行；Agent 绑定仅允许 SELECT 已启用项。RLS 防止遗漏 owner 条件，不把数据库凭据持有者视为不可信终端：服务端凭据仍能选择事务 owner，必须保存在服务端，不能交给浏览器或 Agent。

在已确认的切换阶段，通过受保护的管理通道为该角色设置随机密码，并只将其存入 Hyperdrive；不把密码作为 SQL 文件、命令行参数、日志、Issue 或 PR 内容。Supabase 服务端 Auth 密钥仍用于 Agent 的在线用户检查，不作为业务数据库登录密码。轮换数据库密码按 Hyperdrive 官方流程协调，旧凭据撤销后检查既有池的生命周期。

## Hyperdrive、TLS 与免费额度

2026-11-08 核查：Supabase 为 Free plan，区域 `ap-southeast-1`，PostgreSQL 17，`max_connections=60`；准备前连接采样为 14。Cloudflare API 已确认 Free plan，已创建 `lifespace-postgres` Hyperdrive，正式 Worker 未设置 placement。采样不是峰值容量证据。

使用 Supabase **Direct connection** 端点的 5432 端口，不叠加 Supavisor。Hyperdrive 支持该接入方式，无需为了 Hyperdrive 购买 Supabase IPv4 附加项；本地网络不支持 IPv6 时，优先用隔离本机数据库开发。生产 TLS 使用 `verify-full` 和与该 Supabase 项目匹配的 CA，校验域名与证书。Worker 到 binding 使用平台提供的连接串；不要对平台的本地代理强加远端 TLS 参数，也不要设置 `rejectUnauthorized:false`。

实际配置为 `caching: { disabled: true }`、`verify-full` 和最小起始 `origin_connection_limit=5`；5 并发只读验收成功，本轮观察角色连接数最大为 5。Hyperdrive 的连接上限是软限制，不能把 5 当作数据库硬隔离；总数 60 中仍须为 Auth、运维和其他客户端留余量。新加坡 placement 实测降低数据库往返耗时，但 CPU 验收仍未满足 Free 预算，当前保持正式 Worker 的默认 placement。

Hyperdrive Free 当前允许每日 100,000 条数据库语句；一次业务操作会消耗多条，不能把它换算成 100,000 次业务写入。超额会失败，不自动升级套餐。正式远端验收须检查实际账户计划、语句消耗、峰值连接和 Worker CPU 使用情况。

官方依据：[Supabase 接入](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)、[TLS](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)、[定价](https://developers.cloudflare.com/hyperdrive/platform/pricing/)、[连接限制](https://developers.cloudflare.com/hyperdrive/platform/limits/)、[本地开发](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)、[pg 事务](https://node-postgres.com/features/transactions)。

## 本地与 CI

Node 使用项目指定版本。安装 `npm ci` 后运行 `npm run build`。本地使用隔离 PostgreSQL 17 和固定版本 PostgREST 13.0.7；后者只供历史夹具、兼容权限探针和延迟比较，正式 Worker 数据路径没有业务 HTTP。开发时可通过忽略的本地环境向 Wrangler 设置 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，不要把真实连接串写入仓库。默认配置的回环地址和密码仅为本地占位，不能用于生产。

```bash
POSTGRES_BIN=<PG17-bin> POSTGREST_BIN=<PostgREST13.0.7> npm run test:database -- --ledger --runtime
POSTGRES_BIN=<PG17-bin> POSTGREST_BIN=<PostgREST13.0.7> npm run test:database
# 安装 Chromium 后，可追加 --browser；PLAYWRIGHT_PORT 选择工作区空闲端口。
```

运行器创建随机目录和回环端口，安装既有迁移、历史夹具和新权限迁移，生产 pg 路径使用真实受限角色。`--runtime` 直接运行生产构建的 workerd 与本地 Hyperdrive binding；这不能替代远端 Hyperdrive/TLS 验收。CI 使用两个独立空 PostgreSQL 17 容器，拒绝非空 CI 测试库，下载 PostgREST 固定版本并校验 SHA-256，不注入生产密钥、不上传轨迹或业务产物。

## 切换与回退

1. 对具体 PR 完成评审、CI 和用户合并发布确认；先解决 Free CPU 预算问题，并确认备份／恢复保障。已核对线上结构、迁移、角色属性和连接预算并固定旧 Worker 版本；用户未授权 B 的本地完整业务备份，因此没有导出业务行。
2. 安装增量角色／RLS 迁移，设置专用密码；原有数据、函数和 service_role RPC 权限保持。旧 Worker 可继续运行。生产当前没有 `public.tasks`，迁移对此只跳过授权，不创建表；首页旧待办继续呈现数据源不可用，不能假装为空。若以后接回该来源，应另行核对原表结构及只读授权。
3. 创建 Hyperdrive，禁用缓存，配置直连、TLS CA 和已评估的 pool；只读核对配置，再用受控请求验证跨 owner 拒绝、回读、并发、幂等及 TLS。凭据不进入公开响应或前端资源。
4. 功能分支已写入真实 Hyperdrive ID，须重新构建并核对最终 PR 提交。部署脚本检查 binding 格式并移除生成配置中的 `localConnectionString` 和 `.dev.vars`，不代替 CPU 预算、备份或合并发布授权检查；有效 binding 不能单独作为发布依据。
5. 发布并验收后保留兼容观察窗口。若需要回退，在用户明确授权后恢复原有 Worker 版本及所需 RPC 权限；保留新表权限迁移、历史事件、回执、余额和版本事实，不删库、不删除旧函数或反写余额。停用新登录与回收 Hyperdrive 要在旧路径恢复并验证后协调进行。

目前已安装生产权限迁移、设置专用凭据并创建 Hyperdrive；远端 TLS、RLS、事务回滚、正式读取和命令、连接并发及延迟抽样已执行。正式 Worker、主域名流量和套餐均未改变。Free CPU 风险、备份／恢复保障、最终用户身份下的完整 HTTP／MCP 验收及具体合并发布确认仍待完成。
