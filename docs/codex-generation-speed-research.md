# Codex 生成速度数据源调研

调研日期：2026-10-28。目标是判断能否从已有 Codex 记录获得生成速度，并比较开源项目的口径。本调研阅读公开的官方源码和项目文档，没有操作用户的 Codex 日志，也没有运行这些第三方工具；结论不保证适用于所有版本。各仓库 `main` 可能变化，正式实现前应固定版本并验证。

## 结论

- **源记录有可利用的时间，但没有证据表明一条 JSONL 指标能普遍精确代表模型解码速度。** `task_complete` 的首 token 时间和任务时长属于整个 turn；一个 turn 可以包括多次模型请求与工具调用，不能直接用输出 token 除以整个 turn 时间，再称为纯生成速度。见 [Codex 上游对逐请求时序的讨论](https://github.com/openai/codex/issues/37460)；该 issue 是社区需求和分析，不是官方对所有版本的承诺。
- **有条件的估算值得继续验证。** 一些新版本的 `item_completed` 记录包括模型输出 item 的开始、结束时间；结合官方报告的输出 token，部分开源工具尝试推算吞吐量。但 item 的生命周期与模型请求生命周期不同，是否能完整对齐、是否覆盖推理和工具调用参数、重叠及缺失如何处理，都需要针对实际版本与真值实测。
- **先保留符合隐私白名单的时间事实及关联信息，不默认展示一个被称为“实测生成速度”的数字。** 候选字段包括 `task_complete` 的 `started_at`、`completed_at`、`duration_ms`、`time_to_first_token_ms`；模型输出相关 `item_completed` 的 `started_at_ms`、`completed_at_ms`、item 类型、脱敏关联标识；以及对应原始用量计数、版本和时间戳。不得整体上传 `item`，它可能含正文、工具参数或输出。字段缺失、零时长与不支持的版本需标记，不能补零或伪造。

## 官方代码中的时间字段

| 来源 | 可知事实 | 不应据此推断 |
| --- | --- | --- |
| `event_msg/task_complete` | 含可选 `started_at`、`completed_at`、`duration_ms`、`time_to_first_token_ms`；首 token 时间针对整个 turn，而不针对 turn 内每次模型请求。[协议定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)、[逐请求时序讨论](https://github.com/openai/codex/issues/37460) | 不能从整个 turn 的结束时间和首次 token 时间减法，得到所有模型请求独占生成时间；工具和其他阶段会交错。旧版本或特定记录可能缺字段。 |
| `event_msg/item_completed` | 关联 item 的开始／完成时间。官方的 [`emit_turn_item_started` / `emit_turn_item_completed`](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/mod.rs) 分别记录 item 开始和完成时刻；若缺失开始时刻，当前代码以完成时刻回填，因此差值可能为零。[引入变更](https://github.com/openai/codex/pull/35363) | item 可以是消息、推理、工具等，item 耗时不是天然的每次模型请求耗时，也不保证覆盖全部输出 tokens。零时长不能作为有效速度分母。 |
| `codex.sse_event / response.completed` 遥测 | 官方合并的 [TTFT 遥测变更](https://github.com/openai/codex/pull/30883) 在逐请求完成遥测中附加 `ttft_ms` 和 usage；它是配置遥测后产生的额外来源，不等同于必然存在于已有 JSONL。 | TTFT 不是生成耗时；事件关联、各版本支持情况、重试和记录隐私均需验证。不能假设当前用户所有历史都有此遥测。 |

统计计数和时间窗口还需要可靠关联。特别是 `total_token_usage` 是累计值，重复快照、会话 fork、压缩及不同版本必须单独处理；`output_tokens` 可能包含 `reasoning_output_tokens`，不能把两者相加。直接对相邻 JSONL 时间戳做差会混入调度、工具和等待。

## 开源项目的几种口径

这些是可核验的实现案例，不是市场普查或使用量排名。

| 项目 | 说明与来源 | 评估边界 |
| --- | --- | --- |
| [ccusage Codex](https://github.com/ccusage/ccusage/blob/main/docs/guide/codex/index.md) | 主要以日志提供日、月及会话 Token 与费用统计，供用量汇总比较。 | 该页面不作为生成速度测量的证据；不能由日聚合推出模型生成速度。 |
| [ccgauge 1.4.9 更新说明](https://github.com/chengzuopeng/ccgauge/blob/main/CHANGELOG.md) | 提供每次调用／turn 的输出 tokens/s；说明中称计时包括首 token 等待，排除工具执行和等待；少于 50 个输出 token 的调用不计时。 | 用户看到的是包含首 token 延迟的有效输出速度；其文档描述的边界不等同于纯解码速度，具体日志重建方式与适用版本需单独核查。 |
| [codex-tps](https://github.com/adenta/codex-tps) | 从已有 session 推算有效输出 tokens/s，作者说明区间从输入或前一 usage 边界到最后模型生成 item，排除工具执行、包含首 token 等待；同时区分 reasoning 与可见输出。 | 作者声明无逐 token 完整时间轨迹，旧日志可能因时序不足而拒绝计算；结果不是纯解码基准。该项目是小众案例，不代表主流。 |
| [codex-statusbar](https://github.com/dongyue-19/codex-statusbar) | 针对 Windows Codex Desktop，以 `item_completed` 输出 item 时间窗口与官方输出 token 估算 TPS；无法计算时显示缺失。项目报告其自行对流式增量做的小样本验证。 | 项目报告的 13 个可用 turn 中，P95 相对误差为 16.7%；样本和环境有限，不能当作本机或所有版本的准确度保证。输出 token 包含推理时，时间窗口也必须匹配。此项目为具体案例，非跨平台普适保证。 |

## 后续验证建议

1. 用可公开的合成请求和受控 Codex 版本验证 JSONL 生成 item 时间、usage 和 turn 关联；覆盖短输出、长输出、推理、工具调用、并发、重试、压缩和子代理。禁止使用真实私密内容作为测试夹具。
2. 如果有合适的正式事件流，比较事件流实测窗口与从历史日志估算的窗口；明确计时起止、是否包括首 token 等待、网络和工具时间、reasoning 是否计入，以及分子分母的对应关系。
3. 分别记录版本、来源、覆盖率、无法计算的原因；采集未知字段必须先验证隐私属性，源日志中的消息和工具参数永不整体上传。
4. 如果准确的历史生成速度不可恢复，保留原始时间事实供后续研究；本期不强制计算、不以估算冒充实测。若将来引入估算，应由用户确认口径并在界面标明估算及局限。
