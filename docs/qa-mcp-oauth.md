# #193 OAuth 验证记录

工作区 `/home/lighthouse/orca/workspaces/lifespace/193-mcp-oauth`，分支 `codex/193-mcp-oauth`，基线 `e235846dc3be0aaef5fb308bc89a82a58e2a6d6e`。2026-11-14 已重新成功 fetch，origin/main 仍为该提交。交付分级为需确认的变更；用户已确认授权页和管理页，并明确授权本次 PR 及所需 KV、授权存储迁移、Access 路径切换和发布。真实客户端仍按其安排稍后验收。

## 已执行

| 检查 | 实际结果与边界 |
| --- | --- |
| Node | 用户级 Node v24.22.1；官方 OAuth Provider 固定 1.2.4，npm 审计 0 漏洞 |
| 常规接口 | 353 通过、208 条件跳过；跳过项不计为数据库或运行时验收。跳过的隔离数据库/运行时用例另行执行 |
| 完整隔离账单 | PostgreSQL17.11、PostgREST13.0.7：78 通过、0 跳过。原三个工具、退款、owner、幂等、事务及旧绑定回归；新授权表的真实 SQL 约束、RLS、RPC ACL 及用户删除级联探针通过 |
| OAuth 隔离运行时 | 完整账单回归内的 4 个 OAuth 数据库用例通过，另执行真实 workerd/KV 用例 1 项通过；均无跳过。发现、同意、S256 兑换、刷新、REST 隔离及撤销；保留 KV 旧副本仍拒绝新请求和续期；code 重放被主库原子标记拒绝；已通过检查的在途调用可完成，撤销之后的新解析拒绝 |
| 授权/原登录浏览器 | Chromium 156.0.8078.47：37 通过。1440px/390px、原登录注册恢复、确认/拒绝、键盘焦点、防重复提交、客户端文本转义、授权管理与共享外围布局；Auth/授权接口为合成边界。评审焦点修复后新增授权页 7 项全部通过，含同意/拒绝异步错误、双连接确认/保留、撤销失败重试与成功结果焦点 |
| 全站浏览器 | 修复后冻结代码、重装依赖并以单 Vite 串行复跑：352 通过、123 条件跳过，Playwright 最终记录 `status: passed`、失败列表为空；命令会话最终返回 143，故不作为正常退出证据。固定代码提交 `285ca13451d55100c26f7a89edf717768386fdff` 的远端四浏览器分片及必需 validate 均成功，见 [CI #235](https://github.com/PancrasDuan/lifespace/actions/runs/43598608598)。此前受并行 Vite 缓存与收集中测试变更影响的停止轮次不计入结果；条件跳过不计为真实数据库浏览器验收 |
| 类型/构建 | typecheck、Vite Workers/客户端构建通过；OAuth 按请求加载，保持原 Node 托管的 REST/浏览器夹具可用 |
| 完整安全检查 | 7 项通过；递归覆盖全部 Worker 分块与 sourcemap，检查生产构建、前端资源、开发文件隔离、部署凭据清理与日志脱敏 |
| 便携安全检查 | 4 项通过；修复新文件未进入 Git 快照前的验证前置后完成，最终暂存版本复核亦通过 |
| 密钥扫描 | 全本地可达历史与当前 Git 源码/新增文件扫描通过，两个代码提交的提交钩子通过；远端密钥扫描成功。后续仅证据文档变更仍执行提交钩子与最终扫描 |
| 前端机械检查 | impeccable detector 对新增 TSX/CSS 返回 `[]`；人工查看下面三份合成截图，无横向溢出。Agent 自验不等于用户界面验收 |
| 架构素材 | 更新后的 `docs/design/mcp-https-auth.svg` 经 Chromium 渲染、实际看图及 `data-max-width` 文字宽度检查，均通过；原素材摘要保留在调研文档，未改原 main 工作区文件 |
| 发布前置门禁 | 缺少 ID 的负例明确停止发布；绑定已创建的专用 KV 后检查通过，生产构建和 Wrangler dry run 正常退出。dry run 使用任务专属配置目录，未在本地上传 Worker；生产由 Workers Builds 发布 |

常规 OAuth 测试使用**真实官方库**，只模拟 KV/身份/业务授权边界，涵盖预注册、CIMD、显式 DCR、code/PKCE/redirect/resource 错误、过期及 audience 拒绝、scope 增权与刷新、拒绝/浏览器绑定/账户变化、共享客户端多用户、跨用户撤销、用户删除/停用/邮箱/白名单、KV/数据库故障、精确 Origin/CORS/OPTIONS 与分页。不可用模拟 Auth 证明真实 Supabase Auth 管理行为。

## 界面依据与截图

本次是既有认证界面的新增状态，沿用 `AuthLayout`、字体、配色、控件和响应式规则，未改原登录、标题、导航及账单页面。架构 SVG 并非 UI 原型。没有新增视觉风格或修改 DESIGN.md；已有 PRODUCT.md 的历史账单描述不作为此次业务需求。截图由本分支 Playwright 用合成用户/客户端生成，桌面/手机授权页展示用户选择写入权限后的状态。

用户明确要求删除整个客户端信息区块，包括名称、域名/链接、回调地址和说明。当前授权页只保留账户、三项权限、选中数量、简短有效期和授权/拒绝操作。管理页同步删除客户端名称、原始 URL、说明段落和页脚链接，以授权时间、权限列表、状态和撤销/保留按钮组织记录；成功反馈仅为“授权已撤销”。权限行以原生复选框、可点击标签及选中背景引导，按钮直接说明“授权所选权限”；说明与控件名称分开关联。使用 Modern Web Guidance 的 forms、checkbox、accessibility 指南及 impeccable distill/polish 核对；首轮精简的授权、原登录和共享外围布局共 39 项浏览器正常退出通过，管理页补齐桌面/手机后相关 8 项浏览器通过，类型/构建通过，detector 返回 `[]`，截图已同步并看图。预览和截图仍使用合成数据；用户已确认两页界面，真实客户端互操作仍待完成。

- [桌面授权页](design/mcp-oauth-consent-desktop.png)
- [手机授权页](design/mcp-oauth-consent-mobile.png)
- [桌面授权管理撤销后](design/mcp-oauth-grants-desktop.png)
- [手机授权管理撤销后](design/mcp-oauth-grants-mobile.png)

## 真实平台与待验收

- 生产阶段/回退方案见 [运维说明](mcp-oauth-operations.md#生产阶段与回退门禁)。用户发布授权后已完成下面的资源与数据库准备；旧绑定、账单及 Access 原策略未在准备阶段修改。
- 无生产授权时，自动审批曾拒绝创建 KV。用户明确授权发布后，已创建独立 `lifespace-mcp-oauth`，ID `56d94963635d45d09618eaaa1a78cf7a`，并纳入 Wrangler 配置；不再依赖自动创建。
- 本机 Codex CLI 为 0.169.0，登录命令提供 auto/CIMD/DCR 选项；尚未执行真实客户端 OAuth、刷新、增权、重连、撤销或外部对话验收。用户本会话明确选择“先完成实现与 PR，客户端稍后验收”。Grok Bot/WorkBuddy 等亦未验收。上述能力选项不构成互操作通过。
- 真实 Supabase Auth、多地区网络传播及真实客户端验收仍待完成；用户本地界面验收已通过。数据库迁移已显式执行，不依赖 Worker 自动迁移。生产 Access 切换与部署的后续结果分别记录在 PR。
- [PR #194](https://github.com/PancrasDuan/lifespace/pull/194) 保存固定提交规范/需求双轴评审、必需 CI 和用户发布授权；新增资源配置的增量复核、最终 SHA、合并及部署结果同样在 PR 记录。

## 生产准备记录（2026-11-14）

- 迁移全文 5445 字节、SHA-256 `63c94d2c165810995632e7633c2a32f07ebf3407c2b8834cea070a8fe6716e91`，一次提交完整事务。平台仅新增一条 `20261114144346_agent_oauth_grants` 历史记录，对应仓库已测试脚本 `20261114130000_agent_oauth_grants.sql`；未拆分或改写历史。
- 生产新表为空、RLS 启用、owner 外键删除级联及约束完整；anon/authenticated/service_role 均无直接表读权限，四个业务 RPC 仅 service_role 可执行，JSON helper 不授予调用者权限，函数 search_path 固定 pg_catalog。
- 用现有服务端配置调用新授权列表 RPC（不存在的合成 owner）返回 HTTP 200 和空数组；未创建用户/授权或写入账单。
- Supabase advisor 的新提示为 [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)，符合表不直接对外开放、仅经受限 RPC 访问的设计。原有 [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 提示在准备前已存在，本次未调整该 Auth 设置。
- Access 完整配置及两条原策略已保存于忽略目录 `.cache/193-release/access-before.json`，权限 0600，SHA-256 `6cf82d9325af6af686d1835ff11a0acde26201d943c33ad7a6d1e096775d9d71`。切换前 Worker 版本为 `331d0e2e-66e1-4ae6-a983-da35bb1bfe08`；后续阶段保留回退依据。

## 首轮独立评审与修复

固定范围 `e235846dc3be0aaef5fb308bc89a82a58e2a6d6e...ea0935818ffd6d6e97a96b1c8884cb505b7ba2f2`：Standards 发现 P2 三项（内部 CIMD 日志、已允许 Origin 实际 POST 被拒绝、长元数据列表超过读取预算），Spec 发现 Origin 同一项；UI finish 发现两处 P2 焦点接续问题。对应修复：固定依赖诊断脱敏补丁及原始指纹校验；标准入口明确传入已校验 Origin 策略，旧入口保留限制；20条分页/512KiB预算及长元数据回归；错误挂载后聚焦、确认/保留/成功结果接续。上述修复均有针对性回归；UI finish 两项代码增量评分 resolved，disposition 为 ship（限两项修复），最终7项浏览器已通过。

最终代码范围的目标分支与 merge-base 均为 `e235846dc3be0aaef5fb308bc89a82a58e2a6d6e`，待审 HEAD 为 `285ca13451d55100c26f7a89edf717768386fdff`。Standards 独立复核：原三项全部关闭，未解决规范违反 0、Fowler 判断项 0；Spec 独立复核：Origin 项关闭，未解决需求问题 0、无新增偏离。两轴均保留“需确认的变更”分级及真实客户端/生产待验收边界，见 [固定提交评审记录](https://github.com/PancrasDuan/lifespace/pull/194#pullrequestreview-5904492877)。

独立界面文档核对确认是既有 AuthLayout 的普通扩展，保留绿白色、原字体、双栏及680px折叠；scope逐选、明确同意/拒绝和撤销焦点接续仍保留，客户端信息展示按用户后续要求移除。未创建新视觉系统文件；PRODUCT.md中“拟新增账单/自由账户/不含转账”为已有历史漂移，本任务未修。合成UI预览为 http://127.0.0.1:5194/oauth/authorize 与 /oauth/grants，独立Orca终端保持运行，不连接生产数据。

## WorkBuddy 客户端验收跟进

基线为 PR #194 的合并提交 `aee5a083f05f753f0a6d85e484846f78e0d7d7a8`；后续修复在原工作区的 `codex/193-workbuddy-oauth` 分支。用户本机 WorkBuddy 初次报两个 Cloudflare IP 的10秒连接超时，随后列出三个工具但停在“需要认证”，点击“连接”完全无反应；用户确认同机浏览器可打开网站。

只读检查中，诊断环境到两个 IP 和 Node fetch 均能取得200；AS metadata 未公布 `registration_endpoint`，`/oauth/register` 为404，`/oauth/authorize` 为200 HTML。WorkBuddy 官方动态 OAuth 流程需要 DCR，因此已确认生产配置存在注册兼容缺口；未取得客户端日志，不能据此断言按钮无反应的唯一原因，也不能将诊断环境的成功当作用户网络已恢复。

修复显式启用既有官方库的 DCR 开关，并重新生成绑定类型。隔离 workerd 测试读取实际生产构建的开关，按 metadata 的入口通过 HTTP 注册客户端，随后完成同意、S256 code 兑换、MCP 工具列表、REST 拒绝、refresh 和数据库撤销拒绝。旧构建在缺少 `registration_endpoint` 的断言处失败；修复后该流程通过。身份服务使用合成边界，授权及账单使用一次性 PostgreSQL/PostgREST，未创建真实用户或生产授权。

本地验证：相关OAuth/旧通道接口100项通过；隔离数据库及workerd共5项通过、0跳过；类型生成、类型检查和构建通过；完整安全检查7项、便携安全4项通过；生产配置门禁与 Wrangler dry run 通过。密钥扫描、固定SHA双轴评审及CI结果补充在后续PR。新增范围仅为客户端注册配置及其验证/运维文档，无界面修改。

当前生产仍为已发布的 PR #194。后续配置尚待PR交付；真实 WorkBuddy 的连接按钮、浏览器启动、登录、回跳、刷新和撤销均待用户复验。回退此增量可将DCR开关恢复为关闭并重新发布，保留已有客户端/授权记录及存储；已签发凭据仍按原授权及撤销规则验证。
