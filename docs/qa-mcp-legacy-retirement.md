# #204 旧 MCP 通道退役验证

旧 MCP 退役与用户追加的空表/RPC 删除均已合并、上线并完成生产核验，见 [PR #207](https://github.com/PancrasDuan/lifespace/pull/207) 与 [PR #210](https://github.com/PancrasDuan/lifespace/pull/210)。两次变更涉及鉴权、公开接口、生产配置和持久化结构，按需确认的变更交付；用户已明确授权合并、直接上线和删除旧配置/旧数据，随后追加授权删除空表。2026-11-16 用户反馈“真实客户端我验证过了”，真实客户端验证记录为用户已确认通过。

初次退役分支为 `codex/204-retire-legacy-mcp`，基线 `ae138f4c029c6bd79c74c4c885f819e726a3b4a7`；后续删表分支为 `codex/204-remove-legacy-bindings`。固定提交、双轴评审与必需 CI 分别保存在上述 PR。

## 行为与范围

旧 `/api/agent/legacy/mcp` 在身份鉴权前固定 404，不处理 body、旧 JWT、KV、用户绑定或账单。删去 Access 专用验签、兼容开关和配置类型；MCP transport 必须提供工具授权回调，移除旧通道不传授权回调的调用形态。标准入口继续由上层 OAuth 中间件验证 Origin、grant 和用户/白名单，scope 与工具契约不变。原普通创建/退款/账户契约测试已迁到标准 OAuth，数据库测试分配独立合成 owner，避免与 OAuth 套件共用版本/余额。

未修改 UI、OAuth 流程、scope、token 周期、REST 或账单业务。PR #207 删除旧通道、凭据、配置与两条绑定记录；PR #210 通过前向迁移删除空的旧绑定表/RPC，保留历史创建迁移，将旧权限测试改为对象缺失的 404 回归。生产资源快照、执行顺序与限定恢复范围见 [清理清单](mcp-legacy-retirement.md)。

## 已执行验证（2026-11-15）

使用 Node.js v24.22.1。日志保存在本工作区忽略目录 `.cache/204-*.log`，没有上传带凭据日志或测试轨迹。

| 验证 | 结果与边界 |
| --- | --- |
| `npm run test:api` | 最终全量 380 项通过、219 项数据库环境相关测试跳过；退役测试文件单独 9 项通过。跳过不计为通过 |
| 退役拒绝 | GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS × 空配置/残留 true 配置 × 五类凭据，均 404；有效测试 OAuth/网页登录 token 也 404，原 Request.bodyUsed=false，KV/get、上游和业务未调用；旧头不能访问网页 REST/其他 Agent 路径 |
| 真实隔离数据库 | PR #207 的 4 文件 17 项全部通过、0 跳过；含 10 项迁移到 OAuth 的原账单 MCP 契约、4 项 OAuth 数据库、2 项历史绑定权限、1 项真实 workerd/KV 贯通。PR #210 将其中 2 项旧对象权限检查改为旧表/RPC 均 404 后，17 项再次全部通过，并验证迁移拒绝/回滚/重放。一次性 PG17/PostgREST 真正执行授权和账单事务，Auth 服务为合成边界 |
| 真实 Worker 构建 | 对 `dist/lifespace` 生产构建注入遗留开关/Access 配置，workerd+真实 KV 跑 DCR/同意/PKCE/刷新/撤销；有效两类 token/无凭据的旧路径 GET/POST/OPTIONS 均 404，未调用 outboundService |
| 浏览器回归 | OAuth/登录/共享页面 43 项通过（桌面/手机自动化）；本次无 UI 变化，未要求新增 UI 验收，不能称用户或真实客户端验收 |
| 类型与构建 | `npm run types`、`npm run build`（含 typecheck）通过；`node scripts/check-mcp-oauth-config.mjs` 通过 |
| 安全 | `npm run test:security:portable` 4 项通过；`npm run check:secrets` 全可达历史及当前 Git 源码扫描通过，`npm run test:secrets` 1 项通过；提交前再次通过钩子扫描 |

数据库端口与安全子进程在沙箱内被 EPERM 拒绝后，在获自动审批的沙箱外重跑通过。Gitleaks 首次官方包下载超时，使用本机已有同固定版本 8.30.1 的缓存，复制到任务自己的缓存后完成扫描。数据库首轮两套测试共用 owner 导致余额/版本串扰，分开测试身份后重新通过；没有放松业务断言。

## 额外运行器检查（范围外，保留原结果）

`npm run test:database:runner` 执行 [planning-runner-cli.test.mjs](../tests/database/planning-runner-cli.test.mjs)，检查数据库测试运行器的参数、测试筛选、通过/跳过计数、迁移阶段和浏览器执行报告。它会调用人生冒险 HTTP、数据库迁移与浏览器测试；这与上表已通过的 MCP/OAuth/账单专项回归分开记录。

2026-11-15 配置实际 PG/PostgREST 后，该额外命令 10 项中 3 通过、7 失败，日志为本工作区忽略目录 `.cache/204-runner.log`：

| 失败项 | 日志中的实际表现 |
| --- | --- |
| 3 项筛选/计数断言 | 仍预期 5 项；实际类别测试 17 项通过，迁移测试 6 项跳过 |
| 1 项默认全阶段执行 | 冒险 `todayTaskProgress.total` 预期 7，实际 6 |
| 1 项筛选后保留迁移阶段 | 新库与升级库的 schema 比较报告 `functions` 不一致 |
| 2 项仅浏览器执行 | goal-model/default 的浏览器子进程非零退出；现有日志不足以确定根因 |

本任务对运行器的修改仅在 `ledgerOnly` 分支增加合成 auth 用户；上述失败走非 ledger 分支，未单独复跑完整基线对照，不能将它们列为通过或断言均为已证实的基线问题。2026-11-16 用户明确要求与本次无关的可以不用处理，因此保留说明，本次不扩展修复。

## 生产发布与验收

| 项目 | 已完成结果 |
| --- | --- |
| PR #207 | squash 合并 `f04aee12ed25d720f2c93e3a6d572b9653076c16`；旧绑定 2 条、专用 Service Token 2 枚、legacy Access 应用 1 个及其 2 条策略已删除，旧开关与 2 项 Access secret 无残留 |
| PR #210 | squash 合并 `6c218846e8920dd99cae4ef6685d9d2ad19e5944`；生产旧绑定表与解析 RPC 均不存在，原创建迁移保留 |
| 最终生产版本 | Workers Build `7020973d-3836-4853-869a-0f953a2c05f0` 成功且对应 #210 合并 SHA；version `4cc8db8d-4ba7-4e4c-aa31-89801676961b` 100% 部署 |
| 生产只读核验 | 正式域名 46 项探针通过，含 35 个 legacy 方法/凭据组合返回 404；标准 OAuth 401/metadata、REST 隔离与页面访问正常。匿名 PostgREST 旧 RPC 为 404/PGRST202，旧表为 404/PGRST205；收尾复核再次通过 |
| 保留对象 | 删表前后 3 条 OAuth grant、4 个用户、4 张账单表的完整行摘要及数量一致；OAUTH_KV 保留，旧配置未回归 |
| 真实客户端 | 2026-11-16 用户确认已验证；这是用户验收反馈，独立于 Agent 的模拟/隔离回归，不据此补写具体客户端版本、全部 OAuth 子流程或异地传播已通过 |

异地撤销传播没有单独验收记录。生产服务端凭据的额外本地探针曾返回 401，未计为删表验证，也未据此修改凭据；生产公开 key 的匿名 404 与 SQL 对象缺失查询已独立验证删除结果。

## 用户追加的空表/RPC 删除

PR #210 的迁移删除旧表与 `agent_resolve_owner(text)`，历史创建迁移保留。隔离数据库从历史创建迁移升级到删表版本，验证非空拒绝、字符串函数引用（含大写名称）拒绝、视图依赖导致整体回滚、成功删除及幂等重放，并在对象缺失状态跑原 OAuth/三个工具回归；PostgREST 对各角色的旧 RPC 及旧表均返回 404。本机 PG17/PostgREST/workerd 回归 17 项通过、0 跳过。实际生产定义生成的恢复脚本也已在一次性 PG17 中恢复，列、约束、索引、RLS/原策略、表/函数 owner 和 ACL、函数正文/配置/注释逐项一致。

生产平台于 2026-11-15 一次完整提交迁移 `20261115153337_retire_legacy_agent_bindings`，对应仓库文件 `20261115151152_retire_legacy_agent_bindings.sql`，1,258 字节，SHA-256 `c33e07ab0513410ad1fb911b84f7bd0ea8d22a637b7967f4326036967dcefaac`。备份与恢复验证材料安全保存在主仓库忽略目录 `.cache/204-retirement-release/schema-retirement/`，目录 0700、文件 0600；收尾时 14 个备份文件的清单哈希与权限均通过复核。这是限定对象恢复资料，不是完整数据库备份。
