# 全站页面体验优化（#188 第二阶段）

用户明确要求“所有页面都要进行优化，在本分支上进行改进”。继续使用 `codex/188-modern-web-optimization`；第一阶段首页交付与证据保留在上级目录。本轮基线为已上线的 `main@d3ee7b339dbed6a55e48b92af24da8479d351407`，开始实施时分支 HEAD 为 `2ced9f1c3db73a292b7d19b5d7581451eb6635aa`，两者树相同。

任务：[Issue #188](https://github.com/PancrasDuan/lifespace/issues/188)。实施前已在 Issue 记录范围和**低风险前端体验优化**分级：沿用现有视觉和行为，改动可经新 PR 撤回；不改业务规则、鉴权流程、数据、公开接口或部署配置。固定 SHA 的双轴评审、最终 CI 和生产验收另在 PR／Issue 记录。

## 逐页结果

所有四个业务页面均改为按路由 `import()`；业务页与认证页面均增加独立浏览器标题及首个键盘链接“跳到主要内容”。加载中显示当前页标题、状态和导航；加载失败可重新加载，也可通过导航进入其他页。目标标题使用 `tabIndex={-1}`，接住跳转焦点且不新增 Tab 停靠点。

| 页面／状态 | 本轮优化 | 检查 |
| --- | --- | --- |
| 首页、设置 | 触摸搜索／城市输入至少 16px，服务设置按钮至少 44px 高；共享焦点沿用既有深绿，保留第一阶段卡片／summary 内侧偏移 | 搜索字号、账户菜单触摸尺寸；home／服务状态相关回归 |
| 新闻、来源设置 | 榜单滚动区域有内侧焦点；触摸刷新图标至少 44×44px，工具栏／排序按钮至少 44px 高 | 刷新、来源设置、列表焦点；来源／排序回归 |
| 人生冒险：今日聚焦 | 触摸周历切换至少 44×44px，允许标题换行，搜索至少 16px | 周切换、回到今天、创建任务；原型布局回归 |
| 人生冒险：目标 | 触摸操作按钮和“显示终态”标签至少 44px 高 | 关系卡打开关闭；目标栏操作／布局回归 |
| 人生冒险：成长记录 | 按需加载、独立页面标题、跳过导航与共享账户操作触摸尺寸；保留既有成长页布局 | 桌面／手机渲染与溢出检查 |
| 冒险任务／目标弹窗 | 触摸关闭至少 44×44px；表单至少 16px，文本输入／选择框至少 48px 高；toast 关闭至少 44×44px | 任务输入、关闭；真实计算样式发现并修正旧 `font:inherit` 的优先级覆盖 |
| 财务：账户、流水及弹窗 | 触摸主要／次要按钮、账户筛选、日期筛选至少 44px 高，日期按钮至少 44px 宽；关闭至少 44×44px；表单至少 16px、48px 高 | 新账户／流水、日期筛选、关闭；余额／时间分段键盘回归 |
| 登录、注册、找回／重置密码 | 各状态有独立标题、键盘跳转到当前表单标题、深绿色焦点；触摸密码显示至少 44×44px，辅助按钮和账户头像至少 44px；输入右侧留出空间 | 登录／注册／找回／重置不可用状态截图；完整 auth／启动／退出回归 |

## 设计依据与前后对照

沿用正式页面的薄荷白／深绿风格及组件结构。人生冒险以 [目标原型决策](../../../adventure/goal-prototype-decision.md)、[目标 C 基准及截图摘要](../../../adventure/goal-prototype-baseline.md)和既有今日聚焦 A 实现为依据；财务沿用 [流水原型 A](../../../../src/ledger/prototype/README.md)及[账户原型](../../../../src/ledger/accounts-prototype/README.md)。没有把原型演示页头、示例数据或外围背景当作重新设计授权。目标栏／关系卡及共享页头布局保持原有层级；触摸区增长会使手机部分工具栏、表单和弹窗增高。

截图为 Chromium 实际渲染，视口 1440×844／390×844；手机启用 `isMobile` 和 `hasTouch`。使用仓库测试身份、虚构数据与不可用数据源响应，不包含真实账户。`page.clock` 初始时间为 `2026-11-14T04:30:00Z`、时区 Asia/Shanghai，后续会推进，时间字段可能相差数秒。视口截图通过 CDP 且关闭 `captureBeyondViewport`，避免截图过程重置粗指针。截图用于区域和样式对照，不宣称逐像素相同；固定背景的可见位置也会随页面／弹窗滚动状态变化。

| 状态 | 桌面前／后 | 手机前／后 |
| --- | --- | --- |
| 首页 | [前](before/home-1440.png)／[后](after/home-1440.png) | [前](before/home-390.png)／[后](after/home-390.png) |
| 新闻 | [前](before/news-1440.png)／[后](after/news-1440.png) | [前](before/news-390.png)／[后](after/news-390.png) |
| 今日聚焦 | [前](before/today-1440.png)／[后](after/today-1440.png) | [前](before/today-390.png)／[后](after/today-390.png) |
| 目标控制台 | [前](before/goals-1440.png)／[后](after/goals-1440.png) | [前](before/goals-390.png)／[后](after/goals-390.png) |
| 成长记录 | [前](before/growth-1440.png)／[后](after/growth-1440.png) | [前](before/growth-390.png)／[后](after/growth-390.png) |
| 财务 | [前](before/finance-1440.png)／[后](after/finance-1440.png) | [前](before/finance-390.png)／[后](after/finance-390.png) |
| 创建任务 | [前](before/task-form-1440.png)／[后](after/task-form-1440.png) | [前](before/task-form-390.png)／[后](after/task-form-390.png) |
| 新建账户 | [前](before/account-form-1440.png)／[后](after/account-form-1440.png) | [前](before/account-form-390.png)／[后](after/account-form-390.png) |
| 新建流水 | [前](before/entry-form-1440.png)／[后](after/entry-form-1440.png) | [前](before/entry-form-390.png)／[后](after/entry-form-390.png) |
| 登录 | [前](before/login-1440.png)／[后](after/login-1440.png) | [前](before/login-390.png)／[后](after/login-390.png) |
| 注册 | [前](before/register-1440.png)／[后](after/register-1440.png) | [前](before/register-390.png)／[后](after/register-390.png) |
| 找回密码 | [前](before/forgot-1440.png)／[后](after/forgot-1440.png) | [前](before/forgot-390.png)／[后](after/forgot-390.png) |
| 重置链接不可用 | [前](before/reset-1440.png)／[后](after/reset-1440.png) | [前](before/reset-390.png)／[后](after/reset-390.png) |

[改前尺寸](before/measurements.json)／[改后尺寸](after/measurements.json)记录标题、溢出及实际控件尺寸／样式。Agent 查看了相关前后区域，核对页面结构、目标操作及手机表单。无横向溢出。重置截图只覆盖无有效链接状态，有效重置表单行为由 auth 回归覆盖。

## 加载请求量

本地静态服务分别加载改前／改后的生产构建，每页独立浏览器 context，冷加载至页面可见和网络空闲，统计实际请求到的 JS 文件字节之和。使用相同模拟身份／数据；gzip 列是对文件逐一压缩后的估算和，不是浏览器线上传输量。新构建最大 JS chunk 341.15kB，构建不再提示超 500kB 分块。

| 首次访问 | 改前 JS bytes | 改后 JS bytes | 减少 | 改后 gzip bytes 估算 |
| --- | ---: | ---: | ---: | ---: |
| 登录 | 1,316,057 | 590,112 | 55.2% | 169,893 |
| 首页 | 1,316,057 | 1,110,675 | 15.6% | 345,314 |
| 新闻 | 1,316,057 | 669,956 | 49.1% | 198,036 |
| 人生冒险 | 1,316,057 | 837,601 | 36.4% | 241,254 |
| 财务 | 1,316,057 | 825,091 | 37.3% | 238,073 |

原始逐文件数据：[改前](network-before.json)／[改后](network-after.json)。这里只验证减少了未访问页面的代码加载；没有 DevTools trace、线上 RUM、网络耗时或 Core Web Vitals 测量，不据此宣称 LCP／INP／CLS 改善。共享基础样式继续由入口加载，避免懒加载改变其他页基础样式。

## 验证记录

- `npm run build`（含 typecheck）在最终手机 CSS 修复后退出 0；`git diff --check` 通过。密钥历史／当前文件扫描及提交钩子按仓库流程执行，最终结果见 PR。一次沙箱内当前文件扫描因 `git` 子进程 EPERM 中断，沙箱外相同扫描已完整通过，不将中断计为成功。
- 相关浏览器回归 **128 passed、0 skipped，退出 0**，独立 `PLAYWRIGHT_PORT=5190`：page-loading、navigation、news、news-settings、news-order、auth、auth-startup、auth-logout、adventure-today-parity、adventure-goal-actions-layout、ledger-balance-visibility、ledger-time-keyboard、home、ai-status。128 项在最后两项手机专用 CSS 修复前完成；修复后完成构建、最终截图和下述真实触摸专项。最终完整 CI 结果另记 PR。
- 固定 SHA 的需求评审发现认证页面缺少 skip link；已补齐 AuthLayout、认证各状态及 ResetPasswordForm 的标题目标，并把固定定位账户菜单的 DOM 放在主内容后，使首个 Tab 到达跳转入口，不改菜单行为。`auth.test.ts`补充桌面／手机认证四状态键盘与标题检查，并在有效重置会话用例核对首次 Tab 和目标焦点。认证修复后重新构建、捕获最终截图、测量网络量。认证／启动／退出／页面加载回归 **38 passed、0 skipped，退出 0**；[认证焦点记录](auth-skip/results.json)及[手机跳转入口](auth-skip/login-390.png)／[桌面重置跳转入口](auth-skip/reset-1440.png)另行保存。
- 独立共享区域回归 `shared-shell-scope.spec.ts`：**2 passed、0 skipped，退出 0**，1440／390px 三页签上方区域一致；无额外基线参数时只比较当前页签之间，不声称自动证明与旧原型逐像素一致。
- 新增 `tests/browser/page-loading.spec.ts` 四项验证按需加载、延迟状态、失败恢复、其他页导航可用，以及桌面／手机四页 skip link 的实际键盘焦点和标题。既有导航回归覆盖直接访问与历史前进后退。
- [手机专项](mobile-results.json)：320、390、720px 各六个业务状态，均通过。实际触摸刷新／设置、周历切换、创建任务输入关闭、关系卡、财务今天筛选／新流水输入关闭；核对相关 44px 尺寸、16px 字号、新闻列表内侧焦点及无溢出。检查曾发现任务名称字号被旧规则覆盖和“今天”按钮仅 30px 宽，均修复后重新完整通过。
- [加载与失败恢复](loading/results.json)：桌面／手机各两种状态全部恢复；[桌面加载](loading/pending-1440.png)、[手机加载](loading/pending-390.png)、[桌面错误](loading/error-1440.png)、[手机错误](loading/error-390.png)。本地预览为当前工作区独立端口 5188，构建完成后串行截图，避免构建引起刷新。
- [Impeccable detector](design-detector.json)仅报告新闻现有 bounce easing advisory，未新增该规则，且原有 reduced-motion 覆盖保留。检测结果不代替视觉检查。

以上为自动验证及 Agent 自验。没有实体手机、读屏器或用户人工验收，不宣称完整 WCAG 认证。重试加载不会恢复未保存表单；这是失败恢复操作的既有浏览器刷新语义。没有修改表单提交和业务计算。

## Modern Web Guidance

使用指定插件，版本 `2026_11_09-5bcc021b`，针对键盘导航、表单、触摸适配与按需加载检索并完整读取相应指南：

- `accessibility`：独立标题和跳转到可编程聚焦的页标题；依据 “Provide unique page titles” 与 `tabindex="-1"` 的 skip link 规则，保留组件内侧焦点。
- `forms`：触摸表单覆盖既有小字号，依据 “font-size: max(1rem, 1em)” 防止手机输入自动缩放。
- `form-factor-adaptation`：实际测量触摸区域，依据 “at least 44×44 on touch screens”，在保持图标的同时扩大必要控件。
- `performance`：用标准 `import()` 拆分页面，依据 “DO use dynamic imports”，加入相应加载和失败反馈，避免空白页面。

回退：通过新 PR 撤回本轮前端改动，无数据回滚步骤；不得直接推送 main。发布版本与线上资源／只读权限／密钥隔离核验完成后再关闭 Issue。
