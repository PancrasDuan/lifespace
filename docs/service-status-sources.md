# 服务状态来源

本期覆盖 OpenAI、xAI、Resend、GitHub、Cloudflare、Supabase 与 Notion，均读取官方公开信息，无需新增账户凭据。刷新与失败处理沿用现有服务状态卡片。

| 提供方 | 读取来源 | 汇总口径 |
|---|---|---|
| OpenAI | `https://status.openai.com/proxy/status.openai.com` | 官网产品分组与当前事件 |
| xAI | `https://status.x.ai/feed.xml` | 官方未解决事件 |
| Resend | `https://resend-status.com/api/v2/summary.json` | SMTP、General API、Single Email；其他组件只在详情展示 |
| GitHub | `https://www.githubstatus.com/api/v2/summary.json` | 官方全平台组件与当前事件 |
| Cloudflare | `https://www.cloudflarestatus.com/api/v2/summary.json` | 官方全平台组件、地区与当前事件 |
| Supabase | `https://status.supabase.com/proxy/status.supabase.com` | 官网完整产品、区域、独立组件与当前事件 |
| Notion | `https://www.notion-status.com/api/v2/summary.json` | 官方全平台组件与当前事件 |

Cloudflare 的地区异常可能不影响本站，Supabase 全平台状态也不代表某个项目健康；详情保留范围说明。

## 来源核验

2026-10-12 已验证七家真实取数。Cloudflare 返回 8 个分组、473 个子服务；Supabase 返回 16 个产品项、189 个子服务；数量是当日快照，不作为固定接口约束。

Supabase 通用 `/api/v2/summary.json` 当日只返回一个区域，不能用于声称覆盖官网全部产品。本站使用与官网同源的完整快照，并校验结构项和组件元数据；结构变化或无法解析时显示未知。官网快照接口可能变化，不承诺其稳定性。

官方公开样本保存在 `tests/fixtures/ai-status/`，接口回归覆盖来源失败隔离、字段变化、组件归属和未知状态。二级详情为每家提供方设置独立边框，子服务默认收起，大分组可分别展开，异常事件保留在外层；浏览器回归覆盖键盘、电脑和手机。
