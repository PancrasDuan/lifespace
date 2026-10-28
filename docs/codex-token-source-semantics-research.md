# Codex 用量事件的来源语义与历史去重调研

调研日期：2026-10-28。本文只讨论公开源码和文档，不包含用户日志。Codex 日志格式及其实现可能随版本变化；下文引用固定源码版本，不把某一版本的观察当作永久格式契约。用户会话、账户账单和服务器端配额是不同的数据覆盖范围。

## 核心发现

1. 对累计的 `token_count` 快照逐行求和会重复计数。`last_token_usage` 也不能无条件作为逐次请求用量：当前 Codex 在重新估算上下文时可以用估计值替换它。[Codex 会话实现](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/session/mod.rs#L5363)
2. 当前源码的 `token_usage_record` 区分当前响应 `usage`、当前 turn 累计和 thread 累计，并携带响应等标识；这些字段不能混在一起相加。仍需验证各历史版本、压缩请求及父子线程的覆盖。[Codex SessionState](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/state/session.rs#L233)
3. 父历史可能在子代理线程中被继承或重放；官方投影实现识别 `subagent_history_start_ordinal` 之前的继承段。第三方 ccusage 使用继承快照作为基线并兼容旧格式，但它的算法是实现选择，不是所有版本的保证。[Codex 投影代码](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/thread-store/src/local/thread_history_materialization.rs#L229)、[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)
4. 历史可恢复程度取决于保留下来的文件和版本。无用量记录、无模型或已删除的日志不能视为零，也不能证明账户范围内完整。[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)

## 字段与统计口径

| 记录或字段 | 可核查的来源语义 | 对采集与聚合的含义 |
| --- | --- | --- |
| `token_count.info.total_token_usage` | OpenAI Symphony 的 Codex 接入说明将其作为线程累计快照；Codex 在恢复时可从已有 rollout 恢复 token info。 | 保留快照值及其位置；相同累计值重发不是新的用量。只有确认连续基线、父历史、重置和来源语义后，才能用快照差值归集新增量。[Symphony 说明](https://github.com/openai/symphony/blob/main/elixir/docs/token_accounting.md)、[Codex 恢复代码](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/session/mod.rs#L1731) |
| `token_count.info.last_token_usage` | Symphony 描述正常追加用量时的最近增量；Codex 当前 `recompute_token_usage` 可另将该字段设为估算的上下文长度。 | 保留原值及语义上下文；不得每出现一次就计入，也不能在未验证的版本与特殊事件上假定它总是 API 响应增量。[Symphony 说明](https://github.com/openai/symphony/blob/main/elixir/docs/token_accounting.md)、[Codex 重估代码](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/session/mod.rs#L5363) |
| `token_usage_record.usage`、`turn_token_usage`、`thread_token_usage` | 当前 `record_token_usage` 把传入 `usage` 分别加入 turn 和 thread 累计，再写入同一 record；带有 `response_id`、turn/thread/session 等关联信息。 | 原始响应值与累计值区分存储，保留可关联但不暴露原始标识的稳定标识；响应级方案是否覆盖历史、重放、多个来源和压缩，需按版本核验。不能同时叠加快照与对应响应。[源码](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/state/session.rs#L233) |
| 缓存输入、推理输出 | Codex TUI 的非缓存输入用输入减缓存；显示推理为输出的附加说明。 | 可报告缓存命中率 `cached_input_tokens / input_tokens`，分母为零显示不可用；缓存和推理不要作为独立附加项再次相加。注意不同 provider 的桶语义不一定相同。[Codex TUI](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/tui/src/token_usage.rs) |
| `total_tokens` 与界面总量 | Codex TUI 的 `blended_total` 是非缓存输入加输出；它与原始字段 `total_tokens` 是不同口径。 | 展示时说明总量定义，不把 TUI 的显示总量直接当原始含缓存总数。保留原始字段以便重算。[Codex TUI](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/tui/src/token_usage.rs) |
| `cache_write_input_tokens` | 当前 Codex 源码的用量结构包含此字段；旧版本不一定提供。 | 保存实际存在的值，缺失与零区分；不能从缺失推断没有缓存写入。[Codex 会话实现](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/session/mod.rs#L5379) |

## 模型、回放、压缩与文件副本

**模型归属。** ccusage 将新计入用量关联到当时活动的 `turn_context`，也说明旧日志可能没有模型，某些别名不揭示后端实际模型。数据源在同一文档中描述了早期历史的跳过与 fallback 两种情况，因此具体旧版本行为以对应实现及测试为准。建议保存来源模型与关联依据，无法确定时显示未知；不要凭当前模型改写历史。[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)

**fork 和子代理。** 当前官方代码在 thread history 投影时识别继承段并不将其作为子线程新增投影；这证明继承边界存在，但不单独证明所有版本的 Token 计账算法。ccusage 的当前方案以继承前缀末尾快照作基线，较旧回放使用时间兼容规则。历史起点丢失、父线程不在本机或不同格式混合时，需要明确标记不确定性，不得静默全计或全丢。[Codex 投影代码](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/thread-store/src/local/thread_history_materialization.rs#L229)、[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)

**压缩。** ccusage 说明：远程压缩可能有独立的响应记录；它用 `compacted` 与 `token_usage_record` 的响应标识匹配，只有当中间快照未计入时才补计，并对复制的 response ID 去重。这是一个可研究的处理策略，不是证明每个 Codex 版本都写入相同事件或能够完全还原的证据。官方 SessionState 同时显示响应记录和累计字段的构造；具体覆盖要用版本样本验证。[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)、[Codex SessionState](https://github.com/openai/codex/blob/7c11b8074dbdbab2a3afedf30df7c55f0c6907d8/codex-rs/core/src/state/session.rs#L233)

**活动与归档。** ccusage 支持活动和归档目录、普通 JSONL 和 zstd 副本；其规则为同目录优先普通文本，同一 Codex home 的相同相对路径优先活动文件。这可作为去重参考，但不能仅凭文件名证明跨设备副本相同。设备重装、文件移动、截断、重复上传和伪名化后的身份稳定性仍需具体设计。[ccusage 数据源说明](https://github.com/ccusage/ccusage/blob/b8ad727170fc0dabe35cbf7b940f0a3f9fba475b/docs/guide/codex/index.md)

## 给后续规格的建议与待验证问题

- 采集允许名单内的原始统计事件、时间、原始计数、事件类型、来源格式版本、模型及完成关联所需的稳定伪名标识；不上传对话、代码、完整本地路径、工具参数、输出或凭据。为了防止可关联标识泄露，可研究带密钥的伪名映射，密钥生命周期与跨设备去重能力需要另行权衡。
- 先将文件发现和传输幂等与业务用量去重分开：重复上传不产生重复源事件；同一真实响应在不同事件、不同线程或副本中再次出现，也不因此重复计量。文件路径或行号单独不足以证明语义身份。
- 规则应记录版本和覆盖/异常状态，能从保留的允许名单事件重算。字段缺失、不支持的版本、无基线、累计回退、损坏行和未完成记录需可见；不要以零或模型猜测填补。
- 在不含真实内容的合成或脱敏 fixture 中验证正常连续快照、重复快照、同响应多种记录、模型切换、子代理继承、缺失父历史、压缩补计、活动／归档及压缩副本、跨天与重传。使用 ccusage 只作按相同来源和时区的交叉核对，不把第三方结果或账户配额当作绝对真值。
- 当前证据不足以定论：所有版本的 `token_usage_record` 覆盖率；`last_token_usage` 重估与快照写入的所有组合；同一响应跨机器的身份；模型缺失时的正确归属；是否能完整回填清理过的历史。具体实现需实际版本样本和测试佐证。

该文是调查，不锁定最终解析算法；读取覆盖与上游版本变化可能导致结论需要更新。
