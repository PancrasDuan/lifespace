# #149 PostgREST 回滚与配置重提验证记录

本文件记录两个阶段：第一阶段把 main 整笔回滚到 PostgREST（PR #155），第二阶段在回滚后的 main 上修剪重提原 PR #150 的运维配置（本 PR）。两阶段的业务访问都只有 Worker → Supabase Data API／PostgREST → PostgreSQL RPC 一条路径。

## 第一阶段：整笔回滚（PR #155，已合并）

分支 `codex/149-revert-pg-hyperdrive`，HEAD `0c588cf`；PR #155 squash 合并后 main 为 `622b5d41f921c086d9ce89987cfa7ba40f130960`，文件树 `84473fbc6af43e09158b4a28092cf7438558d8ee`，等于 PR #150 之前的 `72784a6`。

主管独立验收结果：生产构建 `cfd8d972-ab8f-44f3-a147-f937dc953cef`（main／`622b5d4`／success），Active version `5c5b2377-d4ef-4434-8a85-7f2f6903407c` 承接 100%，只读冒烟通过（首页、Auth 配置、匿名与受保护接口、Agent 无凭据、专用测试账号生产拒绝、直接 REST 只读 RPC）。main push CI `42563882007` 为 completed／success。

数据库只读核对：49 个 public 函数、10 张业务表；`lifespace_worker` 角色与迁移记录 `20261108110124` 保留；`public.tasks` 仍不存在；Hyperdrive 资源 `a3307e803a27447f854d2e1a9253b5ae` 闲置、缓存关闭、生产不再绑定。没有反向 DDL／DML、没有删除云资源。第一阶段没有保留完整 observability（生产日志开、Trace=false、`redact_query_string=false`），这正是第二阶段要补回的配置。

## 第二阶段：修剪重提（本 PR）

分支 `codex/149-retain-preview-observability`，基线 `origin/main` `622b5d41f921c086d9ce89987cfa7ba40f130960`。参考原选择性回滚分支 `8a6c72f`，逐文件挑选，不 cherry-pick 整笔、不 revert #155。

### 保留清单

- `wrangler.jsonc`：`workers_dev:false`、`preview_urls:true`、顶层与 `previews` 完整 observability（enabled、sampling=1、`redact_query_string`、logs persist＋invocation_logs、traces persist），`previews` 的 vars／KV／ratelimit。
- 部署守卫 `scripts/check-database-deployment.mjs`：Supabase Data API 地址、必需 Secret 声明、生产／Preview observability 同配；构建后清理 `.dev.vars`。
- `scripts/upload-preview.mjs`：只允许 `preview` 分支、只接受 `--dry-run`、部署前执行配置检查；`package.json` 新增 `preview` 脚本、`deploy` 先执行守卫。
- CI：`preview` 分支的 push／PR 触发、40 分钟超时、两个 PostgreSQL 17 服务、固定 PostgREST 下载，以及 `--ledger --runtime --browser`（5432）与 `--browser`（5433）真实 REST 数据库回归。
- 真实 REST 测试支持：`tests/support/worker-rest-runtime.mjs`、`tasks-database.ts`、`tests/api/tasks-database.test.ts`、`adventure-boundaries-database.test.ts`、`ledger-boundaries-database.test.ts`、Agent 绑定停用、多邮箱白名单、预发拒绝真实 owner、成长里程碑优化及相应 20s 超时。
- 安全：Gitleaks／PostgREST 官方资产下载的 GitHub API 备用路径与固定 SHA-256（`scripts/github-release.mjs`），`test:secrets` 覆盖备用路径和摘要拒绝。
- 文档：ADR 0010（历史）、ADR 0011（当前决定）、统一数据库访问、预发配置、git-workflow 预发段及各领域 #149 头注。

### 剔除清单

- `worker/database.ts`、`ledger-data.ts`、`worker/adventure` 的 TS 事务编排模块与 pg 业务代码：业务仍由 main 上的 REST／RPC 适配器承担。
- Hyperdrive binding 与 `localConnectionString`、`worker-configuration.d.ts` 的 `HYPERDRIVE` 类型：Worker 不重新绑定；云资源和专用角色保持闲置。
- `db/migrations/20261108000000_worker_database_role.sql` 源码：生产已应用（记录 `20261108110124`），源码只保留在 PR #150 提交历史，不重新放回迁移目录，避免重执行或反迁移。
- `docs/database-production-preparation.md`、`docs/database-verification.md`：只在 PR #150 历史中保留，不重提过期切流文案。
- `public.tasks`：生产不恢复，仅隔离测试 fixture。

## 本地执行结果

环境：Node `24.22.1`、Wrangler `4.156.1`、PostgreSQL `17.11`（解包到工作区 `.cache`，仅测试）、PostgREST `13.0.7`、系统 Chromium。隔离运行器使用工作区 `.cache/tmp`；Chromium 使用 `/run/user/1000` 避免 socket 路径过长。未读写生产数据库。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test:api` | 308 项通过；156 项需显式数据库／在线 Auth 的用例跳过，不计作通过 |
| `npm run build` | 通过；`.dev.vars` 构建后删除；产物未匹配 `pg-cloudflare` 或 `HYPERDRIVE`（各 0 次） |
| `npm run test:database -- --ledger --runtime` | 账单 API 76 项通过；生产构建 workerd → 业务 `fetch` → 本机真实 PostgREST → PostgreSQL 冒烟通过 |
| `npm run test:database` | 人生冒险／首页待办 72 项通过；含非空五表升级、真实 RPC 事务、容量边界和测试用 `public.tasks` 读取 |
| `npm run test:database -- --ledger --browser` | 真实账单浏览器 70 项通过 |
| `npm run test:database -- --browser` | 真实人生冒险浏览器 37 项通过 |
| `npm run test:browser` | 298 项通过、109 项条件跳过 |
| `npm run test:security` | 7 项通过（Worker 产物脱敏、前端密钥隔离、生产构建隔离运行时、开发服务器凭据隔离、部署产物清理、日志检查、Git 凭据检查） |
| `npm run test:security:portable` | 11 项通过（含预览上传守卫 7 项） |
| `npm run test:secrets` | 2 项通过 |
| `node scripts/check-database-deployment.mjs` | 通过 |
| `WORKERS_CI_BRANCH=preview node scripts/upload-preview.mjs --dry-run` | 通过（未上传）；`main` 分支被拒绝，退出码 1 |

## 真实 REST 链路证据

运行器在随机回环端口启动真实 PostgreSQL 17 和 PostgREST，Worker 通过 `SUPABASE_URL` 的 `/rest/v1/rpc/*` 访问；测试适配器只替换 Auth 身份，RPC 不 mock。覆盖：

- 冒险空账户与命令、预览、成功回执重放、版本冲突、取消完成、目标达成、成长／成就、分页与历史；100 次行动／10 个目标里程碑。
- 账本开户、改名、普通流水、分页、退款、转账、余额修正、删除预览／删除、版本提交失败回滚、并发请求号和跨 owner 拒绝。
- 退款额度竞争、同编号并发去重、父已删除后的历史回执、余额上限和转账第二侧失败回滚。
- 一万条退款的范围／净额聚合与整组删除；75 个长来源超过 900,000 字节封套时 `CAPACITY_REACHED` 且版本／经验不变。
- 首页旧待办通过真实 PostgREST 读取测试表，覆盖夏令时开始／结束、非整点午夜跳变和 501 条跨页。
- Agent 真实启用绑定停用后，下一次 MCP 请求立即返回 401；Agent 在线 Auth 与白名单检查保留。

`--runtime` 冒烟使用正式 `dist/lifespace/index.js`，不安装 Hyperdrive binding；任何业务代码若回退到 pg／TCP 会直接失败。该冒烟验证了账户创建／重试、余额、跨 owner 拒绝、冒险创建／完成／幂等和成长 XP，并要求实际出现 `ledger_*`、`adventure_planning_command`、`adventure_growth_read` 的 REST 调用。

## 未验证与边界

- 未合并 `main`、未推送 `preview`、未发布生产、未修改 Cloudflare／Supabase 配置；本文件不代表线上已切换该配置。
- 未执行生产真实用户登录、完整生产 Access／MCP 正向路径；未向共享正式库写测试事实。
- 最终 PR CI 与双轴评审以本分支最新 HEAD 为准，见 PR 记录。
- 未做远端 PostgREST／Supabase 延迟和 CPU 比较。任何 CPU 数字只能来自真实 Worker 指标；本文件不将本机 walltime 冒充 CPU，也不预设回滚一定更快。
- `pg` 测试夹具会由隔离库管理员直接建表／清表；这不代表生产 Worker 仍有 pg 路径，也不代表测试库权限等同生产。

## 上线与回退

合并后由 main 的 Cloudflare Workers Builds 常规发布；部署守卫会校验 REST 地址、Secret 与 observability 同配。发布后验收页面、登录、冒险、财务、Agent MCP 和首页待办错误边界。回退代码可重新 revert 本 PR 的配置提交；不要删除已有 RPC 函数、业务事实或 Hyperdrive／角色资源。若要恢复 pg 路径，按 [ADR 0010](adr/0010-worker-postgres-transactions.md) 从提交 `2a1e49d` 取回实现并重新验收；不要直接部署旧 Worker 覆盖 preview、Secret、域名和监控配置。
