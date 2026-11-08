# #149 共享数据库预发

用户最终选择：保留正式 Supabase 项目和数据库配置，创建专用测试登录账号，预发只允许该账号访问。真实账号的数据按 owner 隔离。预发写入是真实提交的测试事实，保留既有幂等、版本、奖励、余额和历史语义。

## 构建与运行

本次采用 Workers Builds 的非生产分支构建及 Version URL，上传候选版本，不切换正式 Active Deployment，也不执行不可逆的 Worker Previews 模型迁移。正式分支继续是 main，正式构建及部署命令保持原配置。

- 预发构建命令：`npm run build:ci`。
- 预发上传命令：`npm run preview`，只执行 `wrangler versions upload`。
- 预发构建变量：`LIFESPACE_PREVIEW_TEST_EMAIL`，指定已创建的测试邮箱；不向构建注入数据库密码或 Auth 服务端 key。
- 本轮验证分支为 `codex/149-pg-hyperdrive`，稳定别名由分支名生成。具体 URL、候选版本 ID、提交 SHA 及实测结果记录在 PR #150；其他分支使用预发时也须核对目标提交与测试用途。

上传脚本拒绝缺少／无效测试邮箱及 main 分支，先执行数据库部署配置检查，并清除构建目录的本地连接串及 `.dev.vars`。候选版本继承现有 runtime secrets 和变量，只设置候选版本的 `PREVIEW_TEST_EMAIL`。浏览器与 MCP 的准入在此变量非空时只允许该邮箱；配置格式无效则拒绝访问。

正式 Wrangler 配置显式将 `PREVIEW_TEST_EMAIL` 置空，恢复原 `AUTH_ALLOWED_EMAILS`。上传脚本要求构建产物包含这个复位默认值，再通过 CLI 覆盖候选版本。不能直接改写候选版本的正式白名单密钥：Cloudflare 会从最近上传、未必已部署的版本继承 secret，后续正式上传可能继承测试值。此方案保留原密钥，不创建覆盖密钥文件。

Worker 的 workers.dev 正式入口保持关闭，只开启预览 URL。预发保留现有 Supabase Auth SDK 直连、在线用户核验和 Agent Access 验签，不增加认证代理。

预览 URL 开关属于整个 Worker。尚未合并本配置的旧 main 若以 `preview_urls: false` 再次部署，会关闭已有候选入口；遇到 404 应先回读该开关，不能据此判断数据库迁移失败。恢复时保留 `enabled: false`，只将 `previews_enabled` 设为 `true`，不改变正式部署或流量。

## 数据隔离与配置差异

| 项目 | 正式与预发 |
|---|---|
| Supabase 项目、数据库结构／参数、Auth 服务 | 同一项目，不复制业务数据或真实用户 |
| Hyperdrive、登录角色、TLS CA、缓存、连接池与默认 placement | 复用本次已配置的资源 |
| Worker 代码 | 正式保留原版本；预发运行当前功能分支 |
| 登录白名单 | 正式原值；预发仅测试邮箱，浏览器与 MCP 均检查此白名单 |
| 测试事实 | 只写专用测试 owner；不修改真实账号的任务、账户、流水或绑定 |

测试 owner 的身份来自在线核验后的 Auth 用户；请求不能自行指定 owner。RLS、查询条件及账户级锁沿用正式业务实现。Auth app_metadata 中的测试用途标记只作运维记录，不参与授权判断。

只向财务和人生冒险的个人业务路径写合成数据。不向共享的旧 `public.tasks` 来源写测试行，也不为了页面测试创建该表。共享数据库的全库统计、备份和资源额度会包含测试账号，故并发及规模验证须控制负载；测试事实不通过绕过历史约束的 SQL 删除。

2026-11-08 曾按用户前一个选择创建 Free 项目 `lifespace-preview-149`（`exkzldhxsgkyizfelolg`），只安装了部分仓库结构，没有复制生产数据、创建 Auth 用户或写业务行。用户改用共享库后已停止导入并暂停该项目，保留结构供后续清理。

## 验证与交付

创建测试用户后验证现有 Auth 登录和测试 owner 一致；候选版本上传后继续检查登录、读写回读、幂等／版本、owner 隔离及正常前端交互。对其他 owner 的验证采用只读或回滚方式，不修改真实用户事实。完整交易竞争／故障测试仍由隔离 PostgreSQL 执行，不向正式表安装测试触发器。

Version URL 与正式版本属于同一 Worker，统计时须按候选版本 ID 过滤，避免混合生产和预发 CPU。CPU 验收使用相同输入及数据规模，并记录分布、错误率和请求／SQL 数；旧版混合接口均值不能替代相同任务创建的对照。

Version URL 不支持 Workers Logs、Wrangler tail 或 Logpush。CPU 可通过 GraphQL `workersInvocationsAdaptive` 按 `scriptName` 和 `scriptVersion` 查询，`cpuTimeP*` 的单位为微秒；不能将 `isPreview: 1` 直接用于此类旧版 Version URL（本次实测记录为 0）。GraphQL 的运行错误数须与 HTTP 状态分别检查，业务 502 也可能记录为 invocation success。

测试密码与会话只保存在本工作区忽略目录的 0600 文件，运行时密钥仍由 Cloudflare 管理，不写入提交、构建变量、Issue 或 PR。预发成功不构成正式发布授权；具体 PR 合并、正式切流及付费升级仍待用户确认。

官方依据：[构建分支](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、[预览命令与 Version URL](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#preview-command)、[版本上传](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload)、[Version URL 限制](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/#limitations)。
