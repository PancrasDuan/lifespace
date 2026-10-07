# AI 状态来源与验收

本期规则：OpenAI 按官网组件与当前事件；xAI 按官方未解决事件定义整体与子模块状态。需求见 GitHub Issue #15，任务见 #16、#17。

| 提供方 | 实际读取来源 | 判定与展示 |
| --- | --- | --- |
| OpenAI | https://status.openai.com/proxy/status.openai.com | 官网产品分组、当前异常与每个事件自己的组件归属；展示五组状态 |
| xAI | https://status.x.ai/feed.xml | 无未解决事件则可用；有事件则整体异常，仅涉及模块异常，其余可用 |

两份真实响应用于回放测试。获取失败、超时、非法内容或无法确认事件模块归属时显示未知，不能按空事件判可用；旧结果标注原成功时间，失败后旧子状态不继续标为当前可用。

xAI 模块清单独立维护于 `src/shared/xai-modules.json`，2026-10-07 核对官网可见三组 14 项。RSS 链接中的模块 ID 用于关联，目录外活跃模块补入其他模块；无事件的新模块需维护目录。xAI 状态属于已确认的事件判定，不是官网组件快照。原站算法证据见 [xAI 子状态研究](xai-substatus-research.md)。

## 真实核验

先启动本地预览，再运行：

```bash
node scripts/check-ai-status-live.mjs --require-substatuses
```

可传入其他已授权预览地址。脚本只读取公开 AI 信息，比较 OpenAI 五组、当前事件、归属与说明，以及 xAI 活跃事件、模块覆盖、涉及模块异常与其余模块可用的规则。任一实际来源失败时核验失败；报告保存在忽略的 `.cache/ai-status-live-check.json`。

xAI 不再请求 `data.x.ai` 组件 JSON；其 403 不再是本期验收条件，也不能因此声称它已接通。只有真实取数、按已确认规则的对照以及页面验收均通过，才可交付。
