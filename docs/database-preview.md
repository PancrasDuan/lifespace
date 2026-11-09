# #149 共享数据库预发

> 2026-11-09：业务访问已由 PR #155 回滚到 Worker → PostgREST → PostgreSQL。本配置 PR 重提固定 `preview` 分支、原生 Preview、共享库测试 owner、Secret 与 observability 配置；`preview` 分支本身仍运行上一次预发的 pg 版本，直到该分支在单独授权下更新并部署。本 PR 不把旧预发验收当作当前 REST 链路证据，也不推送 preview。

用户最终选择：保留正式 Supabase 项目和数据库配置，创建专用测试登录账号，预发只允许该账号访问。真实账号的数据按 owner 隔离。预发写入是真实提交的测试事实，保留既有幂等、版本、奖励、余额和历史语义。

## 构建与运行

GitHub `preview` 是固定预发集成分支，`main` 是正式分支。开发仍使用各任务的功能分支和工作区；预发验收后，再按具体 PR 的发布授权将变更合入 main。创建 preview 分支或发布预发不构成 main 合并授权。

采用原生 Worker Previews，固定 Preview 名称为 `preview`。Workers Builds 的预发构建必须真正部署到这个 Preview，不能只创建分支条目后向主 Worker 上传 Version URL。正式构建及部署命令保持原配置。

- 预发构建命令：`npm run build:ci`。
- 预发部署命令：`npm run preview`，执行 `wrangler preview --name preview --json`。
- 白名单通过各环境自己的 `AUTH_ALLOWED_EMAILS` Secret 配置，不向构建注入数据库密码、Auth 服务端 key 或另一套测试邮箱变量。
- 固定预发地址为 `https://preview-lifespace.dpqkindle.workers.dev`；以原生 Preview 的部署记录为准。

部署脚本拒绝任何非 preview 分支，先执行数据库部署配置检查，并清除构建产物中的 `.dev.vars`。检查原生 Preview 配置、Supabase Data API 地址与 Secret 声明、日志与 traces 后才部署；当前 Worker 配置不安装 Hyperdrive binding，因此部署不要求、也不接受本地数据库连接串。`--dry-run` 仅执行这些本地配置检查；Wrangler 原生 preview 命令没有部署 dry-run，不把该检查当成远端验收。

正式与预发使用同一份 observability 契约：`enabled`、全量 `head_sampling_rate`（含 logs 与 traces）、查询串脱敏、持久化 logs／invocation logs 与 traces 在 `wrangler.jsonc` 顶层和 `previews` 区块保持一致。`scripts/check-database-deployment.mjs` 在每次正式部署和预发上传前校验该契约及两边一致性，避免下一次 main 发布把生产 traces 或持久化配置恢复为旧值。

原生 Preview 不继承生产变量、密钥或数据绑定。`wrangler.jsonc` 的 `previews` 显式登记共享资源及测试准入；Previews Base 保存服务端密钥和 Access 配置，不向构建变量注入这些密钥。Base 密钥变动只自动应用到此后创建的 Preview，已有 Preview 必须单独同步并回读，不能仅确认 Base 已填写。

正式环境保留原 `AUTH_ALLOWED_EMAILS`；Previews Base 的同名 Secret 仅填写专用测试账号邮箱。两者独立配置，浏览器与 MCP 共用该环境的白名单，缺失或格式错误则拒绝访问。保留 Supabase Auth SDK 直连、在线用户核验和 Agent Access 验签，不增加认证代理。

`AUTH_HOOK_SECRET` 用于验证 Supabase 的 Before User Created HTTP Hook 签名，不参与已有账号的普通登录或续期。共享 Supabase 项目的注册 Hook 仍指向正式地址；不为本次预发改写该全局地址。

生产域名继续指向 main 的正式部署；workers.dev 正式入口保持关闭，Preview URL 单独开启。预发单独检查完整绑定、日志、traces 和版本，不能通过“返回了 URL”判断已配置完成。

2026-11-09 第一阶段整笔回滚后，Cloudflare 的 preview 分支构建因当时缺少 `npm run preview` 脚本而失败，不影响 main 生产部署。本次重提补充了 `preview` 脚本和分支守卫；实际 Cloudflare 分支构建结果以该分支后续 CI／构建记录为准，不用改保护规则或自动部署来掩盖。

## 数据隔离与配置差异

| 项目 | 正式与预发 |
|---|---|
| Supabase 项目、数据库结构／参数、Auth 服务 | 同一项目，不复制业务数据或真实用户 |
| Hyperdrive、专用登录角色、TLS CA、连接池与默认 placement | 资源保留闲置；Worker 不绑定 Hyperdrive，业务访问走 PostgREST |
| Worker 代码 | 正式运行已发布 main；预发运行固定 preview 分支的已登记提交 |
| 登录白名单 | 正式原值；预发仅测试邮箱，浏览器与 MCP 均检查此白名单 |
| 测试事实 | 只写专用测试 owner；不修改真实账号的任务、账户、流水或绑定 |

测试 owner 的身份来自在线核验后的 Auth 用户；请求不能自行指定 owner。RPC 内的 owner 条件、账户级锁、版本和事务沿用正式业务实现；闲置的 RLS 不参与当前 REST 路径。Auth app_metadata 中的测试用途标记只作运维记录，不参与授权判断。

只向财务和人生冒险的个人业务路径写合成数据。不向共享的旧 `public.tasks` 来源写测试行，也不为了页面测试创建该表。共享数据库的全库统计、备份和资源额度会包含测试账号，故并发及规模验证须控制负载；测试事实不通过绕过历史约束的 SQL 删除。

2026-11-08 曾按用户前一个选择创建 Free 项目 `lifespace-preview-149`（`exkzldhxsgkyizfelolg`），只安装了部分仓库结构，没有复制生产数据、创建 Auth 用户或写业务行。用户改用共享库后已停止导入并暂停该项目，保留结构供后续清理。

## 验证与交付

创建测试用户后验证现有 Auth 登录和测试 owner 一致；候选版本上传后继续检查登录、读写回读、幂等／版本、owner 隔离及正常前端交互。对其他 owner 的验证采用只读或回滚方式，不修改真实用户事实。完整交易竞争／故障测试仍由隔离 PostgreSQL 执行，不向正式表安装测试触发器。

原生 Preview 的 Metrics、Logs 和 Traces 在该 Preview 的控制台页查看。GraphQL 查询 `workersInvocationsAdaptive` 时按 `scriptName=lifespace`、`isPreview=1` 及 `previewSlug=preview` 过滤；核对部署后发出的实际请求已进入该记录。`cpuTimeP*` 单位为微秒。

测试密码与会话只保存在本工作区忽略目录的 0600 文件，运行时密钥仍由 Cloudflare 管理，不写入提交、构建变量、Issue 或 PR。预发成功不构成正式发布授权；具体 PR 合并、正式切流及付费升级仍待用户确认。

官方依据：[构建分支与模型迁移](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、[Preview 配置和密钥](https://developers.cloudflare.com/workers/previews/configuration/)、[资源共享](https://developers.cloudflare.com/workers/previews/resources/)、[独立可观测性](https://developers.cloudflare.com/workers/previews/test-and-debug/)。
