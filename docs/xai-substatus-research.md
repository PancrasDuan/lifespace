# xAI 官网子状态来源与计算规则

核验日期：2026-10-07（北京时间）。目标：详情展示官网的服务分类和子服务状态。

## 已核实的规则

官网把**当前组件状态、历史状态和事件**分开读取，子状态不能仅由 RSS 中是否存在未解决事件推算。[官网数据加载脚本](https://status.x.ai/_next/static/chunks/2tjiokuxddsh_.js)

| 官方对象 | 字段 | 用途 |
|---|---|---|
| `summary.json` | `status.indicator`、`status.description`；`components[].id/name/status` | 当前组件名称与状态 |
| `uptime.json` | `schema_version=1`、`updated_at`、`range_start/range_end`；`components[].id/history[].day/status`；`groups[].name/components[]` | 官方分组、90 天历史和更新时间 |
| `incidents.json` | 由 `parseIncidentsDocument` 校验后转换成事件；展示层使用 `status`、`impact`、`productSlugs` | 当前与历史事件；它不替代组件快照 |

来源：[数据字段校验与三个 JSON 的加载代码](https://status.x.ai/_next/static/chunks/2tjiokuxddsh_.js)。`incidents.json` 的完整响应没有在本轮取得，因此表中事件字段指官网转换后的模型，不声称已核实其完整原始 JSON 结构。

`healthForProduct(snapshots, slug)` 直接取 `snapshots.components[slug].status`，缺失或 `no_data` 转为 `empty`。`healthForGroup` 遍历组内产品，按 `available < info < disruption < outage` 取最严重的已知状态；合并时忽略 `empty`，全部无数据才是 `empty`。因此一组“部分未知、其余正常”在官网算法中可以显示正常，不能解释为全部组件均成功获取。[子状态聚合代码](https://status.x.ai/_next/static/chunks/1rk1awa6wxlg9.js)、[严重度排序代码](https://status.x.ai/_next/static/chunks/0g69z6yc2n2lr.js)

官网标签分别为 `Operational`、`Info`、`Degraded`、`Outage`、`No data`，对应上述五种状态。[状态标签代码](https://status.x.ai/_next/static/chunks/39qmc5pr4vdk3.js)

`overviewGroups` 从 `uptime.groups` 保留官方分组顺序，将组内 ID 对应到组件；未分组产品进入 `Other`，空组不展示。组件列表排除 `openai`、`anthropic`；这两项属于 `Third-party Services`，从 `summary.components` 独立取状态。[分类与第三方处理代码](https://status.x.ai/_next/static/chunks/1rk1awa6wxlg9.js)

普通分组（用户截图中的 Grok、API）展示组状态以及组内产品状态。`Services` 在官网布局中单独展示各产品（例如 Console、Docs），没有一个额外的分组状态徽章。产品名称可去除分组前缀，如 `API (Global)` 显示 `Global`；同时处理 `Cursor IDE (...)` 前缀。[官网概览渲染与名称处理代码](https://status.x.ai/_next/static/chunks/1rk1awa6wxlg9.js)

首页“没有当前事件”横幅由 `status !== resolved` 的事件列表判定，`summary` 或事件文档未取得且没有已知事件时显示无数据。它与 Grok/API/Services 的组件徽章是两条数据链路。事件 `impact` 映射为 `critical→outage`、`major/minor→disruption`、`none→info`。[事件横幅](https://status.x.ai/_next/static/chunks/1rk1awa6wxlg9.js)、[事件判断与影响映射](https://status.x.ai/_next/static/chunks/0g69z6yc2n2lr.js)

官网没有静态的 Grok/API/Services 默认目录：快照组来自 `uptime?.groups ?? []`，产品名称来自动态组件数据；两个文档均未取得时，组件表和分组为空。`overviewGroups` 只能对已有产品补充 `Other`，不能恢复官方目录。脚本中的 `grok-main→grok-com`、`console→api-console`、`docs→api-docs` 等仅是旧网址重定向别名，不足以构建完整组件目录。[快照和别名代码](https://status.x.ai/_next/static/chunks/2tjiokuxddsh_.js)、[分组代码](https://status.x.ai/_next/static/chunks/1rk1awa6wxlg9.js)

## 当前连通性

| 官方入口 | 本轮结果 | 可支撑内容 |
|---|---|---|
| [RSS](https://status.x.ai/feed.xml) | HTTP 200 | 官方事件订阅；不能提供完整当前组件状态 |
| [summary.json](https://data.x.ai/status/summary.json) | HTTP 403 | 当前无法取得官网组件快照 |
| [uptime.json](https://data.x.ai/status/uptime.json) | HTTP 403 | 当前无法取得动态分组及历史 |
| [incidents.json](https://data.x.ai/status/incidents.json) | HTTP 403 | 当前无法取得官网完整事件文档 |
| 上述三个核心公开脚本 | HTTP 200，并重新读取确认规则 | 可核实逻辑，不能代替当前业务数据 |
| [官网首页](https://status.x.ai/) | 本地 HTTP 客户端 403；网页读取工具得到未加载组件的页面骨架 | 空页面不能判断组件正常 |

三个 JSON 均额外验证了普通公开请求头 `Origin: https://status.x.ai`、`Referer: https://status.x.ai/`、`Accept: application/json`，仍为 403。没有使用凭据、Cookie、防护绕过或非官方中转。**403 的具体成因尚未确定；本地结果也不能证明部署环境会有相同结果。**

官网客户端并行取得三个 JSON，每项超时 5 秒；首次加载后每 30 秒在页面可见时刷新，切回可见页面时也刷新。失败时保留该文档上次成功数据。[加载与刷新代码](https://status.x.ai/_next/static/chunks/2tjiokuxddsh_.js)

## 本站采用的已确认方案

本站的 xAI 状态改为事件判定，原站组件快照算法仅用于解释两种口径的区别：

- 成功读取 RSS 且无未解决事件：整体及已维护模块可用；有事件：整体异常，事件涉及模块异常，其余可用。
- 取数、解析或模块归属校验失败：整体及模块未知，不按空事件处理。
- 事件用官方链接路径中的模块 ID 关联；同 GUID 合并服务和最新说明，同模块的多个事件全部保留。
- 2026-10-07 从[官网可见页面](https://status.x.ai/)核对 Grok 六项、API 三项、Services 五项，共 14 项，独立保存在 `src/shared/xai-modules.json`。该文件是目录，不是组件状态快照。未登记活跃模块加入其他模块；官网新增但无事件的模块需维护目录。
- UI 明确“按官方事件判定”；这里的异常不等于完全不可用，可用表示没有官方未解决事件涉及该模块。

模块目录核对：Grok 为 grok.com、iOS、Android、Grok in X、Imagine、Voice；API 为 Global (api.x.ai)、US (us.api.x.ai)、EU (eu-west-1.api.x.ai)；Services 为 Console、Docs、x.ai、Single Sign-On、Admin APIs。来源为当日官网页面的模块名称及详情链接。

运行 `node scripts/check-ai-status-live.mjs --require-substatuses`，按上述口径验收 RSS、模块覆盖与状态。组件 JSON 的 403 不再阻塞本期已确认方案，也不表示该接口已恢复可访问。
