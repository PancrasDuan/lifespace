# AI 状态来源核验

核验日期：2026-10-07。需求与任务见 GitHub Issues #15、#16、#17。

| 提供方 | 官方公开来源 | 本地核验 |
| --- | --- | --- |
| OpenAI | https://status.openai.com/api/v2/summary.json | HTTP 200，包含整体状态、组件和事件；已保存公开响应作为测试样例 |
| xAI | https://data.x.ai/status/summary.json 与 https://data.x.ai/status/incidents.json | 状态页公开代码引用这两个地址；本地服务端直接访问返回 HTTP 403 |

xAI 数据结构依据官方状态页公开脚本：

- [状态来源及组件结构](https://status.x.ai/_next/static/chunks/2tjiokuxddsh_.js)：summary 包含 status 与 components；组件状态为 available、info、disruption、outage、no_data。
- [事件结构及活动事件判断](https://status.x.ai/_next/static/chunks/0g69z6yc2n2lr.js)：incidents 包含事件数组；事件包含 name、status、impact、更新时间、incident_updates 和组件名称/slug；resolved 为已解决。

这些脚本地址是核验时快照，日后可能变化。测试中的 xAI 数据按已核实结构构造，不声称是实际接口响应。实际运行始终使用固定官方 JSON 地址，解析或访问失败时显示未知；浏览器能打开官方页面不等于服务端能取得数据。

上线验收须从实际 Worker 环境核实两家获取情况，尤其是 xAI；获取失败应如实显示并提供官方跳转，不把失败解释为服务故障。
