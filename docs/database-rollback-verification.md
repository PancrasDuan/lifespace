# #149 PostgREST 选择性回滚验证记录

分支：`codex/149-postgrest-rollback`；基线：`origin/main` `2a1e49da2572d3daf5d18109babab4fbd400f88e`（与已上线功能树 `e5d8392` 相同）。工作区：`/home/lighthouse/orca/workspaces/lifespace/149-pg-hyperdrive`。2026-11-09 实施。

## 实现范围

- 恢复 `worker/adventure/planning.ts`、`worker/ledger.ts`、`worker/tasks.ts`、`worker/agent-auth.ts` 的 REST／RPC 实现；删除 Worker 运行时的 `pg` 事务模块、TypeScript 业务编排模块和 pg 专用测试支持。
- 保留 2026-11-08 已上线的页面、HTTP／MCP 契约、Auth／白名单／Agent Access、错误分类、分页、版本、幂等、余额／奖励和历史规则。
- 保留 `wrangler.jsonc` 的固定 preview、原生 Preview、Secret 清单、Hyperdrive binding、observability／Logs／Traces／采样／持久化／脱敏同配；Hyperdrive、专用角色和 RLS 迁移闲置，不删除。
- 部署守卫改为校验 Supabase Data API 地址与 Secret 声明；保留的 Hyperdrive ID 仍校验格式，本地连接串仍在构建和部署前清除。
- `pg` 仅为测试／开发依赖；生产构建产物不包含 `pg` 或 `pg-cloudflare`。
- 被取消的全量迁移子 session 留下的 5 个草稿文件已先归档到忽略目录 `.cache/149-preview/canceled-full-migration/`，逐文件 SHA-256 核对一致；随后工作树恢复为已上线 HEAD，再开始本分支，不与回滚交付混合。

## 本地执行结果

环境：Node `24.22.1`、Wrangler `4.156.1`、PostgreSQL `17.11`（解包到工作区 `.cache`，仅测试）、PostgREST `13.0.7`、系统 Chromium（浏览器回归稍后）。隔离运行器使用工作区 `.cache/tmp`，不读取或写入生产数据库。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test:api` | 308 项通过；154 项需显式数据库／在线 Auth 的用例跳过，不计作通过 |
| `npm run build` | 通过；生成配置移除 `.dev.vars` 和两层 Hyperdrive 本地连接串，产物未匹配到 `pg-cloudflare`／`pg` 业务导入 |
| `npm run test:database -- --ledger --runtime` | 账单 API 76 项通过；生产构建 workerd → 业务 `fetch` → 本机真实 PostgREST → PostgreSQL 冒烟通过 |
| `npm run test:database` | 人生冒险／首页待办 72 项通过；含非空五表升级、真实 RPC 事务、容量边界和测试用 `public.tasks` 读取 |
| `npm run test:secrets` | 2 项通过 |
| `npm run test:security:portable` | 预览上传守卫 7 项通过；清理竞态与临时目录套件需提交删除后的 Git 树或在实际 CI 运行，见未验证项 |
| 浏览器回归 | 尚未执行 |
| CI | 尚未执行；以 PR 最新 HEAD 的必需 `validate` 为准 |

## 真实 REST 链路证据

运行器在随机回环端口启动真实 PostgreSQL 17 和 PostgREST，Worker 通过 `SUPABASE_URL` 的 `/rest/v1/rpc/*` 访问；测试适配器只替换 Auth 身份，RPC 不 mock。覆盖：

- 冒险空账户与命令、预览、成功回执重放、版本冲突、取消完成、目标达成、成长／成就、分页与历史；100 次行动／10 个目标里程碑。
- 账本开户、改名、普通流水、分页、退款、转账、余额修正、删除预览／删除、版本提交失败回滚、并发请求号和跨 owner 拒绝。
- 退款额度竞争、同编号并发去重、父已删除后的历史回执、余额上限和转账第二侧失败回滚。
- 一万条退款的范围／净额聚合与整组删除；75 个长来源超过 900,000 字节封套时 `CAPACITY_REACHED` 且版本／经验不变。
- 首页旧待办通过真实 PostgREST 读取测试表，覆盖夏令时开始／结束、非整点午夜跳变和 501 条跨页。
- Agent 真实启用绑定停用后，下一次 MCP 请求立即返回 401；Agent 在线 Auth 与白名单检查保留。

`--runtime` 冒烟使用正式 `dist/lifespace/index.js`，但不安装 Hyperdrive binding；任何业务代码若回退到 pg／TCP 会直接失败。该冒烟验证了账户创建／重试、余额、跨 owner 拒绝、冒险创建／完成／幂等和成长 XP，并要求实际出现 `ledger_*`、`adventure_planning_command`、`adventure_growth_read` 的 REST 调用。

## 保留配置对照

| 项目 | 处理 |
|---|---|
| GitHub `preview` / 原生 Worker Preview / `main` 生产流程 | 保留，不改分支映射或部署入口 |
| 自定义域名、workers.dev 设置、固定测试地址 | 保留 |
| Secret 清单、Auth 前端 SDK、在线用户检查、白名单 | 保留；未输出任何值 |
| observability、Logs／Traces、全量采样、持久化、invocation logs、查询串脱敏 | 保留，生产／Preview 同配守卫和探针继续执行 |
| Hyperdrive binding、专用角色、RLS 迁移 | 保留闲置；不删除、不扩权、不改历史迁移 |
| 旧 RPC 函数、业务事实、事件、回执、余额、版本 | 保留；无生产 DDL／DML |
| `public.tasks` | 生产不恢复；仅隔离测试 fixture |

## 未验证与边界

- 未合并 `main`、未推送 preview、未发布生产、未修改 Cloudflare 配置；线上仍是已发布的 pg 版本。不能把本文件当作线上 REST 切流证据。
- 未执行生产真实用户登录、完整生产 Access／MCP 正向路径；未向共享正式库写测试事实。
- 浏览器回归、最终 CI、PR 评审和双轴复核仍待完成。
- 未做远端 PostgREST／Supabase 延迟和 CPU 比较。任何 CPU 数字只能来自真实 Worker 指标；本文件不将本机 walltime 冒充 CPU，也不预设回滚一定更快。
- `pg` 测试夹具会由隔离库管理员直接建表／清表；这不代表生产 Worker 仍有 pg 路径，也不代表测试库权限等同生产。

## 恢复 pg 路径

如需恢复 2026-11-08 的 pg 实现，以 [ADR 0010](adr/0010-worker-postgres-transactions.md)、PR #150 和 `docs/database-verification.md` 为依据，重新安装／核对 Hyperdrive、TLS、专用角色与 RLS，并运行当时的 `queryLedger`／`queryPlanning` 真实 pg 测试。不要直接部署旧 Worker 版本覆盖当前 preview、Secret、域名和监控配置；恢复前需重新取得用户对具体部署的授权。
