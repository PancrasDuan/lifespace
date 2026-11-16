# 准入白名单迁移到独立 Cloudflare KV

2026-11-16，#227 的工程决定；交付分级为需确认的变更，合并与生产发布须用户针对最终 PR 明确授权。本文补充 [ADR 0001](0001-supabase-auth.md) 中白名单的存储方式，不改变在线会话校验、注册 Hook 或 Agent 准入规则。

## 决定

白名单从 Worker runtime secret `AUTH_ALLOWED_EMAILS` 迁移到独立 Cloudflare KV namespace，Wrangler 绑定名 `AUTH_KV`，键名固定为 `AUTH_ALLOWED_EMAILS`。值保持现有逗号分隔邮箱格式，读取后逐项 trim、转小写并按完整邮箱匹配。

网页业务访问、`Before User Created` 注册 Hook 与 Agent 鉴权统一调用同一个异步读取函数。每次鉴权读取当前 KV 值，不增加进程内白名单缓存，也不保留旧 secret 回退路径。binding 缺失、键缺失、读取异常、空值或任一邮箱格式错误均 fail closed，返回 503；名单外返回 403。日志、追踪、错误与公开响应不得包含白名单内容、完整邮箱或 KV 原始值。

## 最终一致性与迁移顺序

Cloudflare KV 为最终一致存储：写入或移除通常在当前边缘位置立即可见，但其他位置可能继续读到旧值，最长约 60 秒或更久；读取过旧值的位置可能更晚更新。既有“移除后立即拒绝”的描述改为“KV 传播后拒绝”。不收回已返回数据，不取消在途请求。需要更强一致性的即时停用不能只依赖 KV。

生产迁移必须先由获准运维人员将现有白名单写入 `AUTH_KV/AUTH_ALLOWED_EMAILS`，确认键可读且格式合法，再部署只读取 KV 的代码。顺序颠倒会使新代码在键写入前对全部业务请求返回 503。真实名单不得进入 Issue、PR、日志或聊天；运维步骤只引用配置位置和受控写入方式。

仓库在用户提供真实 namespace ID 前保留显式占位绑定；`npm run deploy` 的配置检查会拒绝占位 ID、与其他 KV namespace 重复的 ID，以及仍要求 `AUTH_ALLOWED_EMAILS` secret 的配置，且不会自动创建生产资源。

## 回退

回退时恢复上一版 Worker，并保留 KV namespace 与键；不删除 KV，不重新引入旧 secret 作为默认回退。若 KV 值有误，修正后等待传播并重新核验。迁移和发布证据记录在 #227 与对应 PR。
