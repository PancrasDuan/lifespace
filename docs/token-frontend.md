# Token 正式前端（阶段 04）

> 本文保留阶段范围与当时验证；累计实现、已收敛结论及独立验收门禁见 [统一集成验收](token-integration.md)。

对应 #217 / #205；前置与阶段 PR base 为 `codex/213-token-collector` 的 `51fe85803606a640c57a6d2a004343ff74b9a69f`。本阶段从新 session / Orca 子工作区 `217-token-frontend` 开发；父工作区 `codex-token-usage-dashboard`。启动时 fetch main 为 `3d4ecfad5518c405302a7827fa09dd9c6aff55eb`，累计 merge-base 仍为 `f04aee12ed25d720f2c93e3a6d572b9653076c16`。阶段 PR 保持未合并；最新 main 集成及 ADR 重编号由后续全新阶段处理。

完整界面、设备批准/停用与兼容查询字段属需确认变更，用户已有授权覆盖本地实现、隔离验证、评审、提交和阶段 PR；没有生产迁移、合并、部署、真实设备凭据或真实 timer。

## 路由与数据

`/token` 和 `/token/devices/confirm` 复用现有 App/AuthGate/PageContent/AppLayout/navigation；所有 Token CSS 限于 `.token-page`。浏览器请求复用 `authorizedFetch/authorizedMutation` 与 verified identity 撤销信号；没有第二套路由框架或公开 demo。短设备码保存在同源确认 URL 与最多10分钟的本标签页上下文；邮箱验证 callback 只允许回到固定确认路由，邮件回跳携带校验后的 deviceCode，不接受任意返回 URL。正常邮箱密码登录留在原路径；任何 claimSecret/uploadToken 均只在终端。

摘要、上一周期和年度日历分别调用 summary；devices 与 usage 均跟随 nextCursor 直到 null，重复 cursor 作为协议错误。模型堆叠按分页读取的真实逐日模型子项合计；主摘要仍由服务端提供。筛选后的旧请求取消且返回前检查撤销信号；渲染同时检查查询键，禁止旧范围数据暂时冒充当前范围。Agent 筛选初始包含 Codex、Grok Build（存储标识 `grok`）、Hermes Agent（`hermes`）、Claude Code（`claude`）、WorkBuddy（`workbuddy`）和 Cursor（`cursor`），显示名只用于界面，不改变上传或查询使用的 client 标识；无数据时不伪造 0。

模型下拉从不带维度筛选的当前周期目录与当前摘要获得，选中的模型保留；年度日历单独完整年范围并继承维度筛选。日期使用现有 Temporal polyfill 的 PlainDate 与北京时间 Instant 投影；本周周一至今天、本月月初至今天，对比上周/上月相同已过天数并钳制短月。

费用使用服务端精确十进制字符串，显示四舍五入使用 BigInt，不回写摘要。小于 0.01 的非零金额显示 `<$0.01`；实际/API 估算/未分类和未知/部分/未核实分别命名。费用图仅显示单币种 API 估算，多币种提示返回 Token，不换汇。输入包含缓存，缓存率取汇总 cacheRead/input，模型子项不再加到主量。

## 设备与兼容字段

新迁移由 Supabase CLI `migration new token_registration_inspection` 生成文件名，仅替换 inspect 函数，新增可选 `superseded` 布尔：已领取申请的代际不再是当前启用代际时为真。原 status、权限和凭据协议保留，Worker 与 React 复用同一 inspection schema。ACL 显式保持仅 service_role 可执行；不新增浏览器直连私有表或管理 RPC 权限。只有本地隔离库执行此迁移。

重绑必须重新 inspect，并明确勾选旧凭据失效/历史保留；409 清掉确认，不自动批准新状态。停用先显示内联确认，成功后重新读取设备状态，汇总历史保留。网络结果未知时保留可恢复操作，不显示假成功。

## 视觉依据与验证范围

最终原型 `prototype-token-usage-v2` / copy-refinement 为权威；表面契约见 `.impeccable/surfaces/src-token-tokendashboard-tsx.md`。基准 desktop/mobile PNG 原样保存，test fixture 来自同一份 data.js，正式代码不引用。正式页移除演示标记，接真实账户菜单，增加必要的设备码入口和停用操作；真实费用 coverage 未核实有相应标签。各区布局、边距、数值层级及响应式以原型 CSS 为准。

Modern Web Guidance 本 session search/retrieve：interest-triggered-tooltips、css-layout、responsive-design、search-hidden-content、accordion、capture-location-agnostic-data、forms。日历按能力使用 hint/auto/manual fixed fallback，hover/focus/tap 都可查看，浮层不抢焦点、不重复播报完整日期名；beforematch 同步标题内 button 的 aria-expanded。现有系统字体、精确固定字号、筛选即更新和小型紧凑控件遵从用户已批准原型。未使用 legacy-scan。

验证包括 mock 的同样本视觉/错误/竞态和真实本地 PostgreSQL/PostgREST/TLS/Worker/SQLite/Tokscale/React DOM；两类证据分别报告。测试网关只模拟 Auth user 和 apikey 角色映射，浏览器 API 代理实际调用 Worker 和数据库，不编造响应。它不等于托管 Supabase 网关、真实 macOS/Linux 双设备或生产验收。最终 SHA、截图、独立视觉/双轴结论及 CI 以阶段报告和 PR 为准。

## #241 每日趋势局部更新

正式趋势区固定使用当前周期的日主汇总 SVG 柱图：Token（默认）或单币种 API 等价估算（费用）。无常驻趋势图例、曲线和模型堆叠切换；上一周期比较只保留在顶部指标带。主汇总决定柱高，未知/未报告和无匹配记录不制造零柱；已知零显示基线标记。鼠标悬停、触屏轻触或左右键查日，日历同步选中日期。在柱图下方展示当日日期、指标总量及按所选指标排序的前五个模型；使用分页读取的同日子统计、跨设备与 Agent 按模型合计，超过五项才合计真实剩余模型为「其他」。缺失及部分分类明确标注，不把主量差额当作模型或额外用量。费用排名使用精确十进制金额，显示沿用现有舍入/覆盖标签，提示标题可查看原始 API 估算小数；不同币种不换汇或相加。全部费用未知时仍可通过键盘查日，不绘制未知柱。明细加载/失败及单独重试不阻塞主量柱。图下提示按柱中心定位并参与布局，展开时后续内容自然下移，不遮挡任何柱与轴。

#241 同样本视觉基线为 main `836063da`，原型参考仅约束范围外界面；本地截图使用 `TOKEN_TREND_SCREENSHOTS=.cache/issue241/after` 运行 Token 浏览器回归，修改前截图保存在 `.cache/issue241/before`（合成 fixture）。PR 中记录最终固定提交、双轴评审及生产验收。
