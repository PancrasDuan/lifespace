# 首页焦点与点击区域优化（#188）

任务：[Issue #188](https://github.com/PancrasDuan/lifespace/issues/188)。交付分级：低风险局部界面优化，可直接回退，不改变业务规则、数据、鉴权或部署配置。

## 设计依据与范围

以 `20c236e6d85902556b628b9fc178399d8122c01f` 的正式首页为视觉基线，保留薄荷白／深绿、标题、导航、卡片内容和顺序。仅改善首页及其详情／设置框的键盘焦点与图标按钮点击区域；用 `.home-app` 将规则限定在首页，避免全局 CSS 影响新闻、人生冒险和财务。首页没有新增或替换原型；其他模块的已确认原型不在本次修改范围。

实施前范围与分级已记录在 Issue。实施期间 main 合入 #187，本分支同步到 `0566db3014b315b43048f7176b88baccb072bfda`；上游未改首页文件，本 PR 的比较基线采用该 SHA。

## 问题与结果

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| 焦点色 | `#8bdbc0`，对白色约 1.62:1 | 使用既有 `--accent: #486d52`，对白色约 5.86:1 |
| 卡片焦点 | 外置 4px，被卡片 `overflow:hidden` 裁掉两侧 | 内置 3px，保留可见轮廓 |
| 刷新按钮 | 20×20px | 桌面至少 24×24px |
| 粗指针图标按钮 | 设置 34px、搜索 36px、刷新 20px | 设置、搜索、刷新、详情框头部按钮至少 44×44px |

采用 `min-width`／`min-height`，保留内容增长空间。触摸屏卡片底栏随点击区域增加高度；桌面底栏因刷新按钮增加 4px。搜索、详情打开／关闭、刷新请求及焦点返回沿用现有交互。

## 前后截图

截图均为 Agent 的浏览器实渲染，数据使用 `tests/browser/authenticated-test.ts` 同类测试身份和不可用数据源响应，非真实个人数据；时钟固定为 `2026-11-14T04:30:00Z`，时区 Asia/Shanghai，减少动态效果。桌面 1440×844（全页），手机 390×844（触摸仿真、视口截图）。

| 状态 | 修改前 | 修改后 |
| --- | --- | --- |
| 桌面首页 | [before](before/home-1440.png) | [after](after/home-1440.png) |
| 手机首页 | [before](before/home-390.png) | [after](after/home-390.png) |
| 桌面卡片焦点 | [before](before/card-focus-1440.png) | [after](after/card-focus-1440.png) |
| 手机卡片焦点 | [before](before/card-focus-390.png) | [after](after/card-focus-390.png) |
| 桌面刷新焦点 | [before](before/refresh-focus-1440.png) | [after](after/refresh-focus-1440.png) |
| 手机刷新焦点 | [before](before/refresh-focus-390.png) | [after](after/refresh-focus-390.png) |
| 桌面设置框 | [before](before/settings-1440.png) | [after](after/settings-1440.png) |
| 手机设置框 | [before](before/settings-390.png) | [after](after/settings-390.png) |

[修改前尺寸／焦点](before/measurements.json)与[修改后尺寸／焦点](after/measurements.json)记录实际计算样式及控件尺寸。基线在浏览器模块响应中移除本次精确差异得到，并检查首页作用域类不存在；工作树不切换版本。手机截图使用匹配 Playwright 的 Chromium 153，关闭超出视口捕获，避免该捕获方式把粗指针媒体查询重置为细指针；最终记录确认 `coarse: true`。

## 指南与验证

使用用户指定的 `modern-web-guidance:modern-web-guidance`（skill-version `2026_11_09-5bcc021b`），检索 `improve keyboard navigation`，完整读取 `accessibility` 指南。落实其中 “Pair custom focus outlines with `outline-offset`”、至少 24px 点击区域及 “Bump targets up on coarse pointers” 的要求。未增加依赖或替换既有原生 dialog。

- 类型检查、生产构建、`git diff --check`、Gitleaks 历史与当前文件扫描通过；构建生成的 `dist/lifespace/.dev.vars` 已按现有钩子删除。构建仍提示现有大 JS 分块，不在本次局部优化范围。
- 相关浏览器回归 **87 passed、0 skipped**：home、calendar、weather、horoscope、service-status-settings、ai-status、city-picker、navigation、news-settings、shared-shell-scope；独立测试端口 5189，系统 Chromium 156。
- Agent 另用匹配 Chromium 153 在 1440、720、390、320px 检查：无横向溢出；键盘打开设置和时间详情、Tab／Shift+Tab 不进入背景控件、Escape 关闭并返回触发按钮；搜索框与卡片焦点轮廓；按钮实际尺寸；触摸打开／关闭设置及点击刷新区域边缘后收到天气请求。
- 自验最初把原生 dialog 焦点进入浏览器界面也判为失败；按指南允许浏览器界面聚焦的说明修正检查，未改产品行为，最终四种视口均通过。
- 同步后曾将构建与交互检查并行执行，该次搜索焦点检查失败，未计为通过；构建结束后串行重跑，四种视口全部通过（见 [结果](check/measurements.json)）。局部焦点截图先将整张卡片滚入视口，避免截掉手机刷新轮廓底部。
- Agent 查看桌面／手机前后截图，核对首页标题、导航、卡片顺序及内容；查看其他三个页面，并以导航和 shared-shell-scope 回归验证范围边界。Impeccable detector 对修改的两个界面文件返回 `[]`。
- 独立需求评审发现通用 `outline-offset:4px` 覆盖服务详情折叠标题的内侧偏移，导致轮廓被裁剪；已删除通用偏移，仅设置轮廓颜色和样式，保留组件既有偏移。修复后重新构建及四视口交互检查通过，实际服务详情的 [桌面](summary/service-focus-1440.png)／[手机](summary/service-focus-390.png) 轮廓完整，[Enter／Space 展开收起与 `-3px` 偏移检查](summary/measurements.json)通过。
- 修复后的 29 项相关回归三次收到 SIGTERM（exit 143）中断，均未出现产品断言失败，但不能计作完整通过；一次立即重启还遇到本任务残留端口占用。中断原因未确定，不继续重复相同运行。最终完整回归以 PR 的必需 CI 为门禁，结果在 PR 中单独记录；上述 87 项是修复前的实际结果。

以上为自动验证及 Agent 自验。未执行实体手机或辅助阅读器人工验收，不将结果称为完整 WCAG 认证；用户尚未亲自验收。独立双轴评审、远端 CI、最终 PR 和生产部署结果在 Issue／PR 中记录，未完成部署验收前保持 Issue 开放。

回退方式：通过新 PR 撤回 `Home.tsx` 的 `.home-app` 和对应 CSS 规则。
