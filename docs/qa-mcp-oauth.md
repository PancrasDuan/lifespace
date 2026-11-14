# #193 OAuth 验证记录

工作区 `/home/lighthouse/orca/workspaces/lifespace/193-mcp-oauth`，分支 `codex/193-mcp-oauth`，基线 `e235846dc3be0aaef5fb308bc89a82a58e2a6d6e`。2026-11-14 已重新成功 fetch，origin/main 仍为该提交。交付分级为需确认的变更；实施和 PR 已授权，生产存储、Access、具体合并发布等待可审查结果后的授权。

## 已执行

| 检查 | 实际结果与边界 |
| --- | --- |
| Node | 用户级 Node v24.22.1；官方 OAuth Provider 固定 1.2.4，npm 审计 0 漏洞 |
| 常规接口 | 353 通过、208 条件跳过；跳过项不计为数据库或运行时验收。跳过的隔离数据库/运行时用例另行执行 |
| 完整隔离账单 | PostgreSQL17.11、PostgREST13.0.7：78 通过、0 跳过。原三个工具、退款、owner、幂等、事务及旧绑定回归；新授权表的真实 SQL 约束、RLS、RPC ACL 及用户删除级联探针通过 |
| OAuth 隔离运行时 | 完整账单回归内的 4 个 OAuth 数据库用例通过，另执行真实 workerd/KV 用例 1 项通过；均无跳过。发现、同意、S256 兑换、刷新、REST 隔离及撤销；保留 KV 旧副本仍拒绝新请求和续期；code 重放被主库原子标记拒绝；已通过检查的在途调用可完成，撤销之后的新解析拒绝 |
| 授权/原登录浏览器 | Chromium 156.0.8078.47：37 通过。1440px/390px、原登录注册恢复、确认/拒绝、键盘焦点、防重复提交、客户端文本转义、授权管理与共享外围布局；Auth/授权接口为合成边界。评审焦点修复后新增授权页 7 项全部通过，含同意/拒绝异步错误、双连接确认/保留、撤销失败重试与成功结果焦点 |
| 全站浏览器 | 首轮固定提交远端四分片/validate 通过；本地全量执行受同工作区并行 Vite 缓存和收集中测试变更影响，已停止，该部分结果不作为最终证据。修复后将串行复跑全量与最终 CI |
| 类型/构建 | typecheck、Vite Workers/客户端构建通过；OAuth 按请求加载，保持原 Node 托管的 REST/浏览器夹具可用 |
| 完整安全检查 | 7 项通过；递归覆盖全部 Worker 分块与 sourcemap，检查生产构建、前端资源、开发文件隔离、部署凭据清理与日志脱敏 |
| 便携安全检查 | 4 项通过；修复新文件未进入 Git 快照前的验证前置后完成，最终暂存版本复核亦通过 |
| 密钥扫描 | 全本地可达历史 181 commits 与当前 Git 源码/新增文件扫描通过；提交钩子及最终提交扫描后补证据 |
| 前端机械检查 | impeccable detector 对新增 TSX/CSS 返回 `[]`；人工查看下面三份合成截图，无横向溢出。Agent 自验不等于用户界面验收 |
| 发布前置门禁 | `scripts/check-mcp-oauth-config.mjs` 对尚未绑定 ID 的当前构建返回非零，明确停止发布；未运行 deploy |

常规 OAuth 测试使用**真实官方库**，只模拟 KV/身份/业务授权边界，涵盖预注册、CIMD、显式 DCR、code/PKCE/redirect/resource 错误、过期及 audience 拒绝、scope 增权与刷新、拒绝/浏览器绑定/账户变化、共享客户端多用户、跨用户撤销、用户删除/停用/邮箱/白名单、KV/数据库故障、精确 Origin/CORS/OPTIONS 与分页。不可用模拟 Auth 证明真实 Supabase Auth 管理行为。

## 界面依据与截图

本次是既有认证界面的新增状态，沿用 `AuthLayout`、字体、配色、控件和响应式规则，未改原登录、标题、导航及账单页面。架构 SVG 并非 UI 原型。没有新增视觉风格或修改 DESIGN.md；已有 PRODUCT.md 的历史账单描述不作为此次业务需求。截图由本分支 Playwright 用合成用户/客户端生成，桌面/手机授权页展示用户选择写入权限后的状态。

- [桌面授权页](design/mcp-oauth-consent-desktop.png)
- [手机授权页](design/mcp-oauth-consent-mobile.png)
- [手机授权管理撤销后](design/mcp-oauth-grants-mobile.png)

## 真实平台与待验收

- Cloudflare 与 Supabase 只读检查及精确阶段/回退方案见 [运维说明](mcp-oauth-operations.md#生产阶段与回退门禁)。未修改真实账单、原绑定、Access 策略或数据库。
- 自动审批拒绝创建生产账户持久化 `lifespace-mcp-oauth` KV namespace，理由是用户将生产配置变更保留到结果审查后授权；资源未创建。Wrangler 暂无 OAUTH_KV ID，deploy 门禁明确拒绝自动创建。后续须批准创建并将 ID 纳入新提交。
- 本机 Codex CLI 为 0.169.0，登录命令提供 auto/CIMD/DCR 选项；尚未执行真实客户端 OAuth、刷新、增权、重连、撤销或外部对话验收。用户本会话明确选择“先完成实现与 PR，客户端稍后验收”。Grok Bot/WorkBuddy 等亦未验收。上述能力选项不构成互操作通过。
- 真实 Supabase Auth、多地区网络传播、生产 Access 切换、生产部署和用户界面验收尚未完成。数据库迁移不会随 Worker 自动执行，不能在新表缺失时宣称生产可用。
- 固定提交的规范/需求双轴评审、PR 和必需 CI 在形成提交后继续，结论仅覆盖其明确 SHA。

## 首轮独立评审与修复

固定范围 `e235846dc3be0aaef5fb308bc89a82a58e2a6d6e...ea0935818ffd6d6e97a96b1c8884cb505b7ba2f2`：Standards 发现 P2 三项（内部 CIMD 日志、已允许 Origin 实际 POST 被拒绝、长元数据列表超过读取预算），Spec 发现 Origin 同一项；UI finish 发现两处 P2 焦点接续问题。对应修复：固定依赖诊断脱敏补丁及原始指纹校验；标准入口明确传入已校验 Origin 策略，旧入口保留限制；20条分页/512KiB预算及长元数据回归；错误挂载后聚焦、确认/保留/成功结果接续。上述修复均有针对性回归；UI finish 两项代码增量评分 resolved，disposition 为 ship（限两项修复），最终7项浏览器已通过。规范/需求最终固定提交增量复核后更新结论。

独立界面文档核对确认是既有 AuthLayout 的普通扩展，保留绿白色、原字体、双栏及680px折叠；新增域名/回调明示、scope逐选、同意拒绝和撤销焦点接续。未创建新视觉系统文件；PRODUCT.md中“拟新增账单/自由账户/不含转账”为已有历史漂移，本任务未修。合成UI预览为 http://127.0.0.1:5194/oauth/authorize 与 /oauth/grants，独立Orca终端保持运行，不连接生产数据。
