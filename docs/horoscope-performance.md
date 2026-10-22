# 星座运势读取性能核验

核查日期：2026-10-22，北京时间。环境为 `http://127.0.0.1:8788/` 的 Wrangler remote 预览；不等同于生产域名的性能。以下原始性能样本来自“先鉴权再读 KV”的版本；当前代码已按用户确认改为“当日缓存公开、回源需登录”，新版本实测另见验收记录。

## 实测

真实已登录请求的分段日志如下，单位为毫秒：

| 阶段 | 首次读取样本 A | 首次读取样本 B |
|---|---:|---:|
| Supabase 在线鉴权 | 197 | 431 |
| KV 读取 | 112 | 99 |
| Worker → ALAPI 请求与内容校验 | 4630 | 9466 |
| KV 写入 | 220 | 246 |
| Worker 内总耗时 | 5159 | 10242 |
| Wrangler 请求总耗时 | 5375 | 10746 |
| 缓存命中 | 否 | 否 |

ALAPI 阶段占 Worker 内耗时约 89.7% 与 92.4%，是这两次慢请求的主要来源；不是 KV 读写耗时主导。该阶段包含连接、上游响应、传输及本站校验，当前不能进一步拆成上游计算与网络耗时。

对照：本机直接请求 ALAPI 一次约 129 毫秒，HTTP 与业务均成功，日期为当天。该结果只代表本机访问路径，不能用于推断 Cloudflare 到 ALAPI 同样快。

一个匿名请求在 Worker 内立即拒绝（计时为 0 毫秒，返回 401），经远程预览返回本机仍花约 1187 毫秒。说明预览转发链路有额外开销，但不能将这个独立样本与首次读取样本直接相加。

真实 KV 曾回读到三个今日星座键，过期时间均为 `2026-10-22T16:00:00Z`，即北京时间 10 月 23 日零点；表明此前点击已实际写入。较早日志中存在 533、578、1152 毫秒的成功请求，因为没有当时的命中标志，不能将它们直接认定为缓存命中。

## 监测方式

`GET /api/horoscope` 增加 `Server-Timing` 响应头，并输出 `event=horoscope_timing` 的结构化日志，区分 `auth`、`kv_read`、`alapi`、`alapi_headers`、`alapi_body`、`kv_write`、`coalesce` 与 `total`。缓存命中时不产生 ALAPI 与 KV 写入阶段。`alapi_headers` 从调用 fetch 到收到响应头，包含连接、网络、上游排队与处理；`alapi_body` 为响应头返回后至正文读取完毕。两个子阶段包含在 `alapi` 内，不重复相加。

每个请求单独保存计时状态；日志只含状态码、命中标志与毫秒数，不记录账户、会话、请求头、Token、上游正文或完整缓存内容。未增加自动重试或预取。

回归：接口测试 195 条通过（运势 41 条）、浏览器 144 条、七项安全检查、生产构建、类型检查、密钥扫描和差异格式检查通过。新增延迟响应头与延迟正文分别归属对应阶段的回归。计时功能已在真实远程预览生效；本次改动尚未发布至生产。

## 缓存命中复测

在用户常用 Chrome 的真实已登录页面点击白羊座、巨蟹座，取得两次 `cacheHit=true` 的日志：

| 阶段 | 白羊座 | 巨蟹座 |
|---|---:|---:|
| 在线鉴权 | 481 ms | 318 ms |
| KV 读取 | 187 ms | 112 ms |
| Worker 总耗时 | 668 ms | 430 ms |
| Wrangler 请求总耗时 | 2568 ms | 1386 ms |

两次均没有 ALAPI 或 KV 写入阶段。Wrangler 总耗时比 Worker 总耗时分别多 1900 ms 和 956 ms，这部分在本次计时范围之外，不能归因于 ALAPI。不能直接把差值当成生产域名的固定开销。

## 网络隔离采样

北京时间 23:17，启动短时 Wrangler remote 诊断预览，只请求固定 ALAPI 地址与白羊座。随机凭据保护入口，不读取用户会话、不提供业务数据、不读写 KV、不改变正式接口的鉴权。两次远程请求与一次本机对照均 HTTP 200、ALAPI code 200；未做自动重试。匿名诊断请求返回 401。采样后停止该预览并删除临时凭据文件。

原始脱敏结果：[horoscope-network-probe.json](evidence/horoscope-network-probe.json)。

| 指标 | 远程 A | 远程 B |
|---|---:|---:|
| Worker fetch 至响应头 | 2705 ms | 5096 ms |
| 响应头后正文读取 | 0 ms | 0 ms |
| 正文大小 | 8703 bytes | 8703 bytes |
| Worker 网络请求总耗时 | 2705 ms | 5096 ms |
| 本机经 Wrangler 收到完整诊断结果 | 3219 ms | 5536 ms |

Worker 的时间只在 I/O 后推进，正文的 0 ms 是该计时粒度下未观察到额外等待，不能解读为物理传输零耗时，也不适合用此计时证明同步解析耗时为零。

本机对照的 curl 累计时间：DNS 4.8 ms、TCP 连接完成 5.2 ms、TLS 完成 3237.9 ms、首字节 3624.0 ms、完整响应 3655.8 ms。因此，该次约 3232.7 ms 落在 TCP 连接完成至 TLS 完成之间。未设置常见代理环境变量，但没有完整核查系统代理、curl 用户配置和透明网络路径；这是本机连接路径证据，不能用来拆分 Worker 的 DNS/TCP/TLS。

结论：远程慢请求主要等待响应头；本机也能出现连接阶段明显变慢。与 ALAPI 控制台毫秒级处理记录一起看，支持“连接或首包路径波动”的判断。尚不能确定是 Cloudflare 出口、ALAPI 入口、TLS、网络丢包、上游排队或其中组合；独立探针的请求不是此前两次业务请求，不能逐笔关联控制台日志。旧 502 仍缺错误码和当时分段证据，不作归因。

## 鉴权是否必要

星座与日期是公共内容，ALAPI 请求也仅传星座和服务端 Token；没有因个人信息保密而必须登录的要求。当前已采用用户确认的边界：有效当日 KV 缓存匿名可读，未命中先在线检查 Supabase 用户和邮箱白名单，再加入在途合并或请求 ALAPI；其他业务接口保持既有准入规则。

当前实现先验证唯一合法星座参数和 KV 内容。有效缓存直接返回；仅在缓存未命中时校验登录和白名单，校验成功后才进入实例并发合并、节流和 ALAPI。公开读取不包括错误、过期内容或尚未落盘的在途结果。HTTP 响应仍为 `no-store`。

## 新版本远程验收

2026-10-22 深夜，在真实 Wrangler remote 预览执行：

| 请求 | 状态与响应 | Worker 分段 | 客户端耗时 |
|---|---|---|---:|
| 匿名读取白羊座已有 KV | 200，`dataDate=2026-10-22`、`cacheHit=true` | `kv_read=105 ms`、`total=105 ms`；没有 Auth、ALAPI、KV 写入 | 678 ms |
| 匿名读取未缓存天蝎座 | 401，`AUTH_REQUIRED` | `kv_read=136 ms`、`auth=0 ms`、`total=136 ms`；没有 ALAPI、KV 写入 | 594 ms |

这是预览路径的单次样本，不是性能保证。日期跨到 2026-10-23 后，前一天缓存不再可读，需要获准用户首次点击填充新日期缓存。更新后的 [请求流程图](design/horoscope/request-flow.svg) 反映当前代码。

2026-10-23 零点后，在正常 Chrome 已登录点击白羊座：返回 503，页面显示“今日运势暂未更新”；`kv_read=135 ms`、`auth=255 ms`、`alapi_headers=3503 ms`、`alapi_body=1307 ms`、`alapi=4810 ms`、`total=5200 ms`，没有 KV 写入阶段。该样本正文等待明显，说明不能把上一次探针的正文 0 ms 推广为所有请求均为零。随后匿名读取白羊座返回 401，`kv_read=129 ms`、`auth=0 ms`、`total=129 ms`，没有 ALAPI。

接口回归覆盖匿名命中、失效凭据命中、匿名/非白名单未命中、损坏/过期/异星座缓存、KV 故障、匿名不能加入在途回源、其他业务 API 的原有准入，以及 ALAPI 分段计时。今日上游内容更新后的真实成功展示、用户点击确认与生产发布核验仍待完成。

## 官方依据

- [Workers performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)：I/O 与计时粒度。
- [Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/)：默认执行位置、Smart Placement 与定向提示的限制；此次通过官方 HTML 核查，并与本地 Wrangler schema 对照。
- [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)：跨地区最终一致性及未命中缓存。
- [ExecutionContext](https://developers.cloudflare.com/workers/runtime-apis/context/)：响应后的 `waitUntil`。
- [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)：有界正文、密钥隔离和请求状态边界。
