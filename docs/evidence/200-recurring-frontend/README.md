# #200 正式前端验证

工作区 `/home/lighthouse/orca/workspaces/lifespace/200-recurring-frontend`，分支 `codex/200-recurring-frontend`，共同契约基线 `503eac4d20740976017b75dbf50eba7ae55d6e34`，main／merge-base `7730a2f17ebe5fa6e191637c02429c24692ab84b`。本票是需确认变更，已授权开发、提交和本地验证；未合并 main、操作生产数据库、部署或关闭 Issue。待审 SHA 由协调消息固定；本记录不是独立评审结论。

唯一视觉依据为 [d2a0fa4 approved-v1](https://github.com/PancrasDuan/lifespace/blob/d2a0fa4ccb0b52edc44595fd2fc2dff27364df97/docs/evidence/56-recurring-approved-v1/README.md)，原型代码 `6db3bdcbda54b12241bd5d2dd8d3247557f1e9c4`。已逐项验证原基准 SHA256SUMS，并实际查看全部26状态。业务依据为 `3a45dab02e59cf1ac486b86a313463acbcbfe2e4` 的最终规格、R01–R54及本分支冻结契约。

## 实现边界

- 产品只新增正式周期区、创建类型选择、父子详情／生效关联／分页和编辑／结束／删除；目标任务数读 `taskCount`，一次性进度仍读 `progress`，不混用关系卡分页 total。
- 五个冻结只读 API 全部经真实账户 `planningApi` 调用；六命令沿用 `usePlanning` 的 owner pending、账户互斥、规范封套、稳定 requestId、成功回执和查询恢复。日期／期数／完成期／XP／上限和操作能力均取服务端。
- 缺少 `planningPage.recurring` 不开放周期功能；`adventureClientVersion` 切换由 #199 唯一负责。本票没有修改共享 schema、请求 API、Worker、DB、SQL、只读恢复探针或回执头。
- 周期未知结果保留原封套并先只读 lookup；一次性本页面安全重试维持原方式，并防止未知后续失败清掉 pending。明确日期409回读并提供主动刷新，不自动补交；成功后的回读失败只重新查询。
- 父详情、子详情、列表按同 version/today 读取，旧响应不能覆盖新筛选。父子使用真实 ID；快照不被当前父名称／归属覆盖。子详情返回同父，撤销回父重读、清除生效关联，最后一项为空态。
- PlanningToast 沿用自动／手动关闭和同一外观，原生 dialog 中的提示进入同一顶层。已有目标背面一次性关联列表及入口保留。

## 截图与对照

截图来自正式 `/adventure`、真实生产组件和冻结 HTTP 契约 fixture；没有在产品引入 bridge、mock hook、示例数组或固定日期。测试 fixture 的2026-11-15只用于确定性对照，不是产品时钟。截图不证明 #199 后端／数据库已联通。

| 状态 | 桌面1440×1000 | 手机390×844 |
| --- | --- | --- |
| 今日周期／一次性行动 | [today](today-desktop-1440.png) | [today](today-mobile-390.png) |
| 父详情／生效关联 | [parent](parent-desktop-1440.png) | [parent](parent-mobile-390.png) |
| 子快照／返回父 | [child](child-desktop-1440.png) | [child](child-mobile-390.png) |
| 创建类型选择 | [create](create-desktop-1440.png) | [create](create-mobile-390.png) |
| 编辑／固定字段 | [edit](edit-desktop-1440.png) | [edit](edit-mobile-390.png) |
| 结束确认 | [end](end-desktop-1440.png) | [end](end-mobile-390.png) |
| 未开始的开始日入口 | [unstarted](unstarted-date-desktop-1440.png) | [unstarted](unstarted-date-mobile-390.png) |
| 未开始详情／删除 | [detail](unstarted-detail-desktop-1440.png)／[delete](delete-desktop-1440.png) | 同一能力 |
| 结束日入口 | [ended](ended-date-desktop-1440.png) | [ended](ended-date-mobile-390.png) |
| 结束详情／原完成日 | [detail](ended-detail-desktop-1440.png)／[completed](completed-date-desktop-1440.png) | 同一日期规则 |
| 目标任务数／一次性进度 | [goals](goals-desktop-1440.png) | [goals](goals-mobile-390.png) |
| 直接记录／复用toast | [toast](record-toast-desktop-1440.png) | 共用组件 |
| 撤销后过滤 | [filtered](revoked-filtered-desktop-1440.png) | 共用列表 |
| 实际4/3与旧快照 | [lowered](lowered-requirement-desktop-1440.png) | 共用能力 |
| 日期409及主动刷新 | [crossday](crossday-desktop-1440.png) | 共用恢复 |

人工 Agent 对照核查布局层级、560px弹窗／手机边距、24px／18px内容留白、父规则与期数、次数和进度条、按钮、关联往返及只读字段。页头、导航、新建区、经验概览、周历、一次性任务行、右侧成长区域没有重设计。`perimeter-comparison.json` 保存桌面外围像素比较：周历平均通道差约0.0013／255，其他所选区域不超过0.5／255；细微背景差来自整页高度变化，不能视为逐像素完全一致。

需要协调者核对的契约／演示差异：

1. 原型将子任务借用一次性行，展示了“计划”日期；真实子契约没有 plannedOn，正式子行只显示实际完成日期，保留原任务行样式与详情入口。周期成长来源也不会显示“原安排 null”或调用一次性安排链。
2. 原型空白底部的120px演示工具留白／演示工具栏不进入产品；因此长页总高度有差异。目标新建及一次性关系卡使用真实能力，不继承演示禁用。
3. 真实分页每页10项，三个分页流独立；需要分组时显示“本页 N”，总量和今日进度保持服务端全范围值，避免用当前页假冒汇总。
4. 跨天明确失败后会回读真实新 today；当前所选旧日期保留，不能为了截图维持过期生命周期。主动刷新不自动重发；日期栏和按钮因此与演示的假跨天状态存在必要差异。
5. 4/3场景用四个生效子事实与旧要求5的快照验证，保留真实数值；原型截图中的示例数量不能替代服务端事实。

## 验证与限制

验证命令都显式使用用户 Node24.22.1。当前类型检查、构建、6文件46项定向API回归及密钥扫描通过；portable安全回归4项通过（包含两个预期失败的嵌套负例），主安全检查7项通过。最终浏览器共66项覆盖通过：新增周期／成长12项（最终完整批次退出0，50.1秒）；一次性／关系卡／保存恢复21项（20项首批通过，1项产物冲突后独立重跑退出0）；旧回执／账户隔离27项（12＋15短批次分别退出0）；页头及日期页外围6项（退出0）。没有数据库测试被记作通过，也没有更改现有测试预期。

新增12项包含26状态桌面／手机捕获、直接记录／重复点击、toast手动关闭、成功后只重读、父子返回／撤销／最后空态、实际4/3及旧快照、跨天409、原封套只读恢复、未激活不开放周期、新建两种类型／真实目标ID／正整数、原生dialog键盘、父／子／行动独立分页及共用搜索、开始日移动／生命周期确认，以及成长null安排。原生dialog允许Tab进入浏览器chrome；键盘断言检查不进入背景页面，没有为满足测试另写焦点陷阱。

初次浏览器检查暴露了新弹窗受正式页CSS影响、测试preview缺字段和初始焦点的问题，已修复。一次64项混跑外层退出143，另一次并行批次共用了测试产物目录产生ENOENT；都不计通过，后续改用独立输出目录和短批次。未为迎合结果更改现有测试预期。

本地常驻预览为 http://127.0.0.1:5228/adventure ，Orca terminal `term_71e27d9d-787c-4e40-971a-92c8bc73b39c`；仅验证HTTP200及本工作区归属，没有真实账户的周期后端联通数据。浏览器fixture验证、Agent视觉自验、独立评审、用户验收和真实DB／生产验收分别报告；独立评审、用户验收和真实DB／生产验收目前未完成，不作已完成声明。最终集成／必需CI由 #201 组织。

## 使用的检查指南

Modern Web Guidance `dialog`：采用原生showModal及安全取消焦点，遵循“DON'T add role=\"dialog\", aria-modal, a focus trap”，并添加dialog/backdrop滚动阻断；不改变现有一次性弹窗。

Modern Web Guidance `accessibility`：表单有可访问名称，原生按钮、可见焦点、只读锁与关联入口，toast在dialog同层，遵循“Don't add live-region updates to inert DOM”。React检查采用独立读取并行、完整读取key、取消迟到响应及ref保存挂载状态；Impeccable只检查批准视觉和既有范围，detect返回空发现。
