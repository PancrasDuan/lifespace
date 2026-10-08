# LifeSpace

个人每日首页：Google 搜索、本地与海外时间、Open-Meteo 当天天气、Supabase 今日待办、本地黄历、DNSHE 域名信息及 AI 服务状态。采用已确认的浅色布局，卡片与详情均为只读。

线上地址：[LifeSpace](https://lifespace.onepeace.cc.cd/)。

## 本地运行

使用 Node.js 22.12、24 或 26 及更新版本。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5174/`。城市与海外时区设置保存在当前浏览器；默认上海天气、纽约和伦敦时间。任务来源尚未配置时显示明确提示，其他卡片正常使用。

## 接入任务来源

项目已配置 `personal_os` 的 Supabase URL。运行以下命令，在终端隐藏输入已有服务端 secret key；也兼容 legacy service_role。

```bash
npm run setup:supabase
```

密钥保存于本地 `.dev.vars`，由 Git 忽略；重新启动开发服务器使配置生效。模板见 [.dev.vars.example](.dev.vars.example)。

今日待办筛选设备本地当天 `planned_at`、`status=todo`、`is_deleted=false`，按计划时间排序。首页最多显示三条，详情展示全部。时间字段使用 Unix 秒，接口仅执行读取。

## 接入 DNSHE

在本项目终端运行配置向导：

```bash
npm run setup:dnshe
```

向导打开 [DNSHE 控制台](https://my.dnshe.com/index.php?m=domain_hub)，按免费域名管理 → API 管理获取 API Key 和 API Secret。两项输入均隐藏，只写入本地 `.dev.vars` 的 `DNSHE_API_KEY`、`DNSHE_API_SECRET`，权限为 `600`；保留现有其他配置。配置完成后重新启动开发服务器。模板见 [.dev.vars.example](.dev.vars.example)，凭据仅用于 Worker，不进入网页或 Git。

首页展示 DNSHE 账户内全部域名的数量、名称、状态和剩余天数，点击查看全部域名及到期日期，[DNSHE 登录页](https://my.dnshe.com/clientarea.php) 在新标签页打开。永久有效、到期日期未知、未接入和空列表分别显示。来源日期不含时区，剩余天数仅按本地当天与来源到期日期计算。域名状态采用 DNSHE 返回值。

首页免登录，域名展示字段允许公开。数量是账户内注册域名去重后的数量；`lifespace.onepeace.cc.cd` 等自行创建的 DNS 记录不计作独立注册域名。凭据仅留在服务端，公开响应不包含账户标识、DNS 记录或其他上游字段。接口仅查询，不执行续期或修改解析。上线前需在 Worker 配置同名 secrets，并完成真实只读联调。

接口依据 [DNSHE 官方 API V2.0 文档](https://api005.dnshe.com/knowledgebase/13/DNSHE-Free-Domain-API-User-Guide-V2.0.html)，使用请求头认证，按页读取全部域名，仅返回域名、状态、到期日期和永久标记。

DNSHE 成功结果在边缘缓存 5 分钟；手动刷新可能复用缓存，更新时间保留来源读取时间。缓存未命中时，读取限流目标为每个 Cloudflare 节点每 60 秒一次，超限返回 `429`。缓存故障仍受限流保护，缺少限流配置时停止读取。查询参数不能绕过缓存或指定上游地址。读取采用 12 秒网络超时与分页起点预算检查，最多 10 页、每页 100 条；最终页同步处理可能跨过预算。已检测到的超时、超页或任一页失败时返回错误，不缓存部分列表。

## 验证与发布

```bash
npm run types
npm run build
npm run test:api
npm run test:security
npm run setup:browser
npm run test:browser
```

使用 Workers Builds 连接现有 `lifespace` Worker 与 `PancrasDuan/lifespace` 仓库：

| 设置 | 值 |
|---|---|
| 生产分支 | `main` |
| 根目录 | `/` |
| 构建命令 | `npm run build:ci` |
| 部署命令 | `npm run deploy` |
| Node.js | `.node-version` 固定为 `24.18.0` |

推送到 `main` 后，Cloudflare 安装锁文件中的依赖，执行接口测试、安全检查和构建，再发布 `dist/lifespace/wrangler.json` 指定的 Worker 与 `dist/client` 静态资源。非生产分支预览关闭。日常开发通过功能分支和 PR，main 合并门禁与交付流程见 [开发与交付](docs/agents/git-workflow.md)。

部署身份由 Workers Builds 的部署 token 提供；`SUPABASE_SECRET_KEY`、`DNSHE_API_KEY`、`DNSHE_API_SECRET` 保存于 Worker 的运行时 secrets，不加入 Git 或构建环境变量。发布会保留已配置的运行时 secrets。

发布后核对 DNSHE、任务、天气、登录入口与公开资源的密钥隔离。Worker 兼容日期采用 `2026-10-01`。

## 项目结构

| 目录 | 用途 |
|---|---|
| `src/home/` | 首页、信息卡片与设置 |
| `src/app/`、`src/news/` | 共享导航、新闻页与请求队列 |
| `src/shared/` | 前后端数据契约 |
| `worker/` | Hono 接口与数据来源接入 |
| `tests/api/`、`tests/browser/` | HTTP 与浏览器验收测试 |
| `scripts/` | 本地配置工具 |
| `docs/` | 本期需求与项目约定 |

运行缓存、日志和测试报告统一放在 Git 忽略的 `.cache/`。停止开发服务后，可运行 `npm run clean` 清理缓存和构建产物，依赖及本地密钥配置保留。

## 接口

- `GET /api/tasks/today?timeZone=<IANA 时区>`：今日待办。
- `GET /api/domains`：DNSHE 账户内全部域名的展示信息。
- `GET /api/ai-status`：OpenAI 与 xAI 的整体状态及按提供方归属的当前异常。
- `GET /api/weather/locations?q=<城市关键词>`：城市搜索。
- `GET /api/weather?latitude=<纬度>&longitude=<经度>`：城市当地当天天气。
- 天气来源：[Open-Meteo](https://open-meteo.com/)；日期与黄历使用 `tyme4ts` 本地生成。

## AI 服务状态

首页一张卡片汇总 OpenAI 与 xAI 的官方状态；多个当前异常按提供方分组，点击查看各家状态、官网子状态、异常说明、受影响服务、检查时间和官方链接；说明文字仅位于详情主标题下，首页卡片不展示该说明。打开或返回主页时刷新，支持手动刷新；页面保持打开时每小时刷新，恢复可见时更新。

获取失败显示未知，保留的旧结果标注原成功时间。官方未提供说明时显示“原因待公布”。公开来源无需账户凭据。OpenAI 展示官网五组状态；xAI 以官方 RSS 未解决事件判定整体和子模块：有事件则整体异常，涉及模块异常，其余可用；无事件则可用，获取或解析失败则未知。xAI 显示“按官方事件判定”，不声称组件快照。

xAI 模块目录独立维护于 `src/shared/xai-modules.json`，2026-10-07 从官网核对三组 14 项；事件官方链接中的模块 ID 用于关联，目录外活跃模块加入其他模块。官网新增但未发生事件的模块需更新目录。执行 `node scripts/check-ai-status-live.mjs --require-substatuses` 核对真实取数、OpenAI 五组和 xAI 事件判定模块；来源说明见 [AI 状态来源验收](docs/ai-status-source-check.md)，原站规则研究见 [xAI 子状态研究](docs/xai-substatus-research.md)。

## 新闻页

侧边导航进入 `/news`，默认展示百度热搜、财联社热门、腾讯新闻综合早报、今日头条和知乎。[来源设置 #9](https://github.com/PancrasDuan/lifespace/issues/9) 默认隐藏，页面与侧栏设置入口可打开全部 28 源的独立开关；即时生效，关闭来源会停止其排队与后续刷新。新增 AIHOT 热点榜默认关闭，开启后展示 Top 10，使用官网来源图标。AIHOT 由 Worker 读取官方热点 API，标题优先打开事件详情，缺失时打开 AIHOT 阅读页；已有选择不迁移。标题打开来源链接，支持单卡与全部刷新；浏览器最多三个并发，无轮询、焦点刷新或自动重试。

来源选择独立保存在当前浏览器的 `lifespace.news-sources.v1`，不修改首页城市、时区设置。明确保存的空选择保持为空；缺失或损坏配置恢复默认五源，已移除的来源 ID 忽略。存储拒绝保存时当前页面仍应用选择，并显示“未保存”；设置可用键盘操作，关闭后恢复入口焦点与阅读位置。

- `GET /api/news/sources`：28 个受控来源的名称、默认启用标记和固定顺序。
- `GET /api/news/source?id=<source_id>`：Worker 只读访问 NewsNow 或 AIHOT 官方热点 API，返回规范化榜单及获取、上游报告时间；网页仅访问同源接口。AIHOT 未提供榜单更新时间，显示“上游未报告时间”。
- 成功快照内部保留最多 24 小时，前 5 分钟新鲜命中保留原获取时间。超过新鲜期重新读取，失败时若有未满 24 小时的有效快照，返回带警告的“上次成功结果”；不覆盖快照、不续期，保留原时间。没有可用快照时返回稳定错误。缓存是节点本地的，可能被提前清理。
- `NEWS_READ_LIMITER` 在 `wrangler.jsonc` 配置每节点每分钟 30 次上游尝试；新鲜缓存与元数据免计数。保护不可用时停止读取，公开接口保持 `no-store`。

当前交付范围见 [默认五源新闻页 #7](https://github.com/PancrasDuan/lifespace/issues/7) 与 [Worker 失败回退 #8](https://github.com/PancrasDuan/lifespace/issues/8)，AIHOT 接入见 [热点榜 #21](https://github.com/PancrasDuan/lifespace/issues/21)，完整规格见 [新闻页规格 #6](https://github.com/PancrasDuan/lifespace/issues/6)。

本期范围与验收标准见 [本期需求](docs/requirements.md)。
