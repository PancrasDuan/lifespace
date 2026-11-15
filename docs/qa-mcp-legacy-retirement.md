# #204 旧 MCP 通道退役验证

本记录对应任务分支 `codex/204-retire-legacy-mcp`；起点及目标 main 为 `ae138f4c029c6bd79c74c4c885f819e726a3b4a7`。最终评审 HEAD、独立双轴结果及 CI 在关联 PR 固定记录。涉及鉴权、公开接口和生产配置，属于需确认的变更；本地实现和 PR 准备已授权，生产发布/清理尚未授权或执行。

## 行为与范围

旧 `/api/agent/legacy/mcp` 在身份鉴权前固定 404，不处理 body、旧 JWT、KV、用户绑定或账单。删去 Access 专用验签、兼容开关和配置类型；MCP transport 必须提供工具授权回调，移除旧通道不传授权回调的调用形态。标准入口继续由上层 OAuth 中间件验证 Origin、grant 和用户/白名单，scope 与工具契约不变。原普通创建/退款/账户契约测试已迁到标准 OAuth，数据库测试分配独立合成 owner，避免与 OAuth 套件共用版本/余额。

未修改 UI、OAuth 流程、scope、token 周期、REST 或账单业务。保留旧绑定表/RPC/迁移及权限测试；未新增生产迁移。生产资源快照与执行顺序见 [清理清单](mcp-legacy-retirement.md)。

## 已执行验证（2026-11-15）

使用 Node.js v24.22.1。日志保存在本工作区忽略目录 `.cache/204-*.log`，没有上传带凭据日志或测试轨迹。

| 验证 | 结果与边界 |
| --- | --- |
| `npm run test:api` | 379 项通过、219 项数据库环境相关测试跳过；之后新增一项旧 Access/REST 隔离断言，退役测试文件单独 9 项通过；最终完整数量以 PR CI 为准。跳过不计为通过 |
| 退役拒绝 | GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS × 空配置/残留 true 配置 × 五类凭据，均 404；有效测试 OAuth/网页登录 token 也 404，原 Request.bodyUsed=false，KV/get、上游和业务未调用；旧头不能访问网页 REST/其他 Agent 路径 |
| 真实隔离数据库 | 4 文件 17 项全部通过、0 跳过；含 10 项迁移到 OAuth 的原账单 MCP 契约、4 项 OAuth 数据库、2 项历史绑定权限、1 项真实 workerd/KV 贯通。一次性 PG17/PostgREST 真正执行授权和账单事务，Auth 服务为合成边界 |
| 真实 Worker 构建 | 对 `dist/lifespace` 生产构建注入遗留开关/Access 配置，workerd+真实 KV 跑 DCR/同意/PKCE/刷新/撤销；有效两类 token/无凭据的旧路径 GET/POST/OPTIONS 均 404，未调用 outboundService |
| 浏览器回归 | OAuth/登录/共享页面 43 项通过（桌面/手机自动化）；本次无 UI 变化，未要求新增 UI 验收，不能称用户或真实客户端验收 |
| 类型与构建 | `npm run types`、`npm run build`（含 typecheck）通过；`node scripts/check-mcp-oauth-config.mjs` 通过 |
| 安全 | `npm run test:security:portable` 4 项通过；`npm run check:secrets` 全可达历史及当前 Git 源码扫描通过，`npm run test:secrets` 1 项通过；提交前再次通过钩子扫描 |

数据库端口与安全子进程在沙箱内被 EPERM 拒绝后，在获自动审批的沙箱外重跑通过。Gitleaks 首次官方包下载超时，使用本机已有同固定版本 8.30.1 的缓存，复制到任务自己的缓存后完成扫描。数据库首轮两套测试共用 owner 导致余额/版本串扰，分开测试身份后重新通过；没有放松业务断言。

## 额外检查的未解决项

额外运行 `npm run test:database:runner`，配置实际 PG/PostgREST 后 3 通过、7 失败。该命令同时运行范围外的人生冒险回归；现有断言仍写死旧数量（期望 5，实际类别 17、迁移 6），另外命中人生冒险进度、迁移结构比较及浏览器运行失败。本票修改该运行器仅在 `ledgerOnly` 分支增加一条合成 auth 用户；失败用例走非 ledger 分支，尚未单独复跑完整基线比较，不能把它列为通过或声称所有失败均已证实是基线问题。本票不改人生冒险或为通过检查改写其预期。

## 生产与客户端未验证项

Cloudflare 和 Supabase 只做了明确目标的只读核验，未改任何外部对象。生产仍存在旧开关、两条 enabled 绑定、两枚 token 及 legacy Access 应用；3 条有效 OAuth grant 保持原状态。标准生产入口/退役行为须在最终部署 SHA 后验收，真实 Supabase Auth、WorkBuddy/Codex 既有连接、多地区及用户验收尚未完成。没有用模拟 KV/Auth、隔离运行时或测试通过替代这些验收。
