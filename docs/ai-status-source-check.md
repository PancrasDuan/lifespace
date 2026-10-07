# AI 状态来源与验收

核验时间：2026-10-07 11:05（Asia/Shanghai）。规格与任务见 GitHub Issues #15、#16、#17。

| 提供方 | 当前官方公开来源 | 真实核验结果 |
| --- | --- | --- |
| OpenAI | https://status.openai.com/proxy/status.openai.com | HTTP 200；与官网使用同一份数据，包含产品分组、当前事件及其受影响组件 |
| xAI | https://status.x.ai/feed.xml | HTTP 200；官网 Subscribe → RSS 公布的入口，包含事件状态、受影响服务和更新记录 |

OpenAI 按官方 structure 将组件映射到产品，摘要展示 ChatGPT，事件详情展示 ChatGPT / Agent；每个事件使用自己的 affected_components，不用全局异常组件替代事件归属。

xAI 按官方 RSS 的事件状态识别未解决事件；同一事件的多个服务条目按事件标识合并。没有未解决事件时显示正常，并说明“官方事件订阅未报告未解决异常”。这是官方已发布事件的汇总，不是主动探测服务可用性，也不提供独立的组件快照。

公开响应已保存为测试样例。验收同时要求：真实来源 HTTP 200、页面与官网对照、当前事件及产品归属一致；仅测试样例通过或获取失败回退正常工作，不足以判定功能可交付。

## 复现核验

先启动本地预览，再运行：

```bash
node scripts/check-ai-status-live.mjs
```

可传入其他已授权的预览地址。脚本只读取公开 AI 状态，比较官方当前事件、归属、说明与本地结果；任一家无法取得有效数据时失败，报告保存到 Git 忽略的 `.cache/ai-status-live-check.json`。

本次核验：两家均未报告未解决异常，与官网一致。解决前捕获的 OpenAI 回放样例验证 ChatGPT / Agent 产品与组件归属。状态会变化，重新验收须重新执行核验。上游失败仍显示未知，保留旧结果时注明原成功时间。
