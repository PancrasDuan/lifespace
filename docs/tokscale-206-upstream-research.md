# #206 Tokscale 官方接口研究

研究日期：2026-11-15（Asia/Shanghai）。npm 完整元数据查询时间为 `2026-11-15T14:27:58Z`。范围是公开官方 registry、官方 release 和固定提交源码；没有执行 Tokscale CLI、读取真实用户日志或 HOME 下的 Codex 会话。合成日志实测、依赖安装、实现和测试由主会话负责。本次仅新增本文件；官方源码下载到获授权的 `/tmp`。

## 结论与版本固定

最小接口是 **`tokscale graph`**：天然输出 JSON，`contributions[].date` 与该项的 `clients[]` 已形成 **日期 × 来源 client（本任务的 source Agent）× model** 联合粒度。每行已有 `costProvenance`，可直接保留费用来源；无需组合日汇总与模型汇总，也无需比例分摊。[命令定义][cli-graph]、[JSON 字段][graph-fields]、[序列化映射][graph-map]

| 核实项 | 官方结果 | 主来源 |
| --- | --- | --- |
| npm 包 | `@tokscale/cli` | [npm 包元数据](https://registry.npmjs.org/@tokscale%2fcli) |
| 当前 dist-tag | 仅 `latest: 4.23.0` | [latest 元数据](https://registry.npmjs.org/@tokscale%2fcli/latest)；完整元数据的 `dist-tags` |
| npm 发布时间 | `2026-11-15T03:09:29.296Z`（北京时间 11:09:29.296） | 完整元数据的 `time["4.23.0"]` |
| npm `gitHead` | `5569a0397b52c6c445e346814747a772fc3c0a11` | [固定版本元数据](https://registry.npmjs.org/@tokscale%2fcli/4.23.0) |
| 官方最新稳定 release | `v4.23.0`；`draft=false`、`prerelease=false` | [GitHub release](https://github.com/junhoyeo/tokscale/releases/tag/v4.23.0)、[release API](https://api.github.com/repos/junhoyeo/tokscale/releases/latest) |
| release 发布时间 | `2026-11-15T03:08:44Z` | release API 的 `published_at` |
| tag 对象 | `type=commit`，SHA 与 npm `gitHead` 相同 | [tag ref API](https://api.github.com/repos/junhoyeo/tokscale/git/ref/tags/v4.23.0) |
| 提交 | `chore: bump version to 4.23.0`，提交时间 `2026-11-15T03:07:28Z` | [固定提交](https://github.com/junhoyeo/tokscale/commit/5569a0397b52c6c445e346814747a772fc3c0a11) |

上述版本截至查询时成立；registry 的 latest 和 release 的 latest 是可变入口，后续复核应重新查询，实施依赖则固定 `4.23.0`。registry 未返回该版本的 `deprecated` 标记。

官方 npm tarball 为 `https://registry.npmjs.org/@tokscale/cli/-/cli-4.23.0.tgz`；registry 声明 `dist.shasum=91c6cb9c9b5b8a3f171a63307d49b853e7e62146`，`dist.integrity=sha512-KFB/NIrjEIzK6OkYV29NfXH8HeVKLAOiErsMgzcXY87oKjHIQlK+3o4LSzA0RkFANuM9PxFNMyaHiJQBa5kmHA==`。本研究没有下载或执行该二进制包，不把元数据核实称为二进制行为验证。

本地查阅的官方源码位于 `/tmp/tokscale-206-official-5569a039/tokscale-5569a0397b52c6c445e346814747a772fc3c0a11`，来自 [GitHub 固定 SHA archive](https://codeload.github.com/junhoyeo/tokscale/tar.gz/5569a0397b52c6c445e346814747a772fc3c0a11)。下载 archive 的 SHA-256 为 `4d7ddbb29b1b0b29ac24f66a27f8ae4f3532aed53ebc28842b8f3549ba0adb39`；此值是本次下载记录，不是上游另行签发的校验值。

## 最小命令和接口选择

已安装固定版本后，最小 JSON 命令为 `tokscale graph`。实际适配可显式限制来源、日期和本地扫描目录：

```bash
TZ=Asia/Shanghai \
TOKSCALE_CONFIG_DIR=/tmp/token-206-fixture-config \
./node_modules/.bin/tokscale graph \
  --home /tmp/token-206-fixture-home \
  --client codex \
  --since 2026-11-14 --until 2026-11-15 \
  --offline --no-spinner
```

这是交给主会话的命令说明，本研究未执行。`graph` **不接受 `--json`**；省略 `--output` 时把 JSON 写到 stdout，指定 `--output` 才写文件。`--offline` 是全局选项，使用本地数据及缓存价格；本地缓存为空时，已知模型也可能只有未知费用。`--since` / `--until` 比较最终日期键，均包含端点。[CLI 选项][cli-global]、[graph 执行路径][graph-run]、[stdout 分支][graph-stdout]、[日期筛选][date-filter]、[无价格处理][pricing-apply]

| 官方接口 | 聚合及字段 | 适用判断 |
| --- | --- | --- |
| `graph` | `contributions[].date` 下的 `clients[]` 有 `client`、`modelId`、tokens、cost、provenance | 一次读取即可得到本任务所需联合粒度 |
| `models --json` / 根命令 `--json` | `entries[].client/model/provider/input/output/cacheRead/cacheWrite/reasoning/messageCount/cost`；没有日期字段 | 可查询期间总量；单独使用不能还原跨日联合明细；其显式 JSON DTO 也没有 graph 的 provenance 字段 |
| `monthly --json` | `entries[].month/models[]/input/output/cacheRead/cacheWrite/reasoning/messageCount/cost` | 没有同一行的 client × model 明细；不适合作为联合维度入口 |
| `pricing explain --json` | 每条解释有 `coverage`、`estimateStatus`、`rawModelId` 等 | 辅助诊断接口，不能直接为 graph 每行补齐费用完整性 |

依据：[models JSON DTO][models-json]、[monthly JSON DTO][monthly-json]、[pricing explain 实现][pricing-explain]、[解释 DTO][pricing-explanation]。命令枚举提供 `Models`、`Monthly`、`Hourly`、`Graph` 等；本次需要的日期明细无需假设一个 `daily` 子命令。[命令枚举][cli-commands]

## graph 的准确字段和粒度边界

以下路径均在官方 `camelCase` JSON 中：[字段定义][graph-fields]、[映射实现][graph-map]

| JSON 路径 | 含义和适配注意 |
| --- | --- |
| `meta.generatedAt` / `meta.version` / `meta.dateRange.start/end` | 生成时间、上游 crate 版本、实际贡献首末日期；没有声明该报告的时区，也没有价格目录快照信息 |
| `contributions[].date` | 已按官方扫描时区分桶的 `YYYY-MM-DD` |
| `contributions[].clients[].client` | 来源工具 ID，如 `codex`、`claude`；本任务可将其映射为 source Agent |
| `contributions[].clients[].modelId` | 上游 canonical model ID，可能是 `unknown` |
| `contributions[].clients[].providerId` | 非空时才序列化；可能是排序后的多个 provider，以 `", "` 拼接 |
| `contributions[].clients[].tokens` | `input`、`output`、`cacheRead`、`cacheWrite`、`reasoning` 五个桶 |
| `contributions[].clients[].cost` / `.messages` | 该日期、client、canonical model 聚合的费用数值和消息计数 |
| `contributions[].clients[].costProvenance` | `kind` 和可选 `estimateSource`；字段缺失时按未知来源处理 |
| `contributions[].tokenBreakdown` / `.totals.tokens/cost/messages` | 当日桶与总计；不能用它们向模型或来源分摊 |
| `contributions[].totals.costIsComplete` | DTO 能表达 `false`；普通本地 graph 没有完整性保证，见费用章节 |
| `summary.totalTokens/totalCost/costProvenance` | 全报告汇总，仍需保持 provenance 语义 |

联合键的源码证据是两层聚合：`DailyFoldV2` 先按 `message.date` 建桶，`DayAccumulator` 再以 `client + canonical_model_id` 建键，累加每个 token 桶、费用及 provenance。[日期聚合][daily-fold]、[client/model 聚合][joint-key]

两个明确边界：

- 这里的 source Agent 是 `client`。内部 `UnifiedMessage.agent`（如 Codex Subagent、Guardian）没有出现在 graph 行中；若需求改成某个工具内部的具名 agent × model，graph 无此粒度。[内部消息字段][message-fields]、[graph 字段][graph-fields]
- provider **不在聚合键内**。同日同 client 同模型的不同 provider 被合并，`providerId` 仅保留标签集合，不能拆回 provider 对应的 token 或费用。模型 ID 还经过结构归一化，例如大小写、部分版本/日期后缀和一方 provider 前缀；graph 不应用用户的展示别名。[聚合键及 provider 合并][joint-key]、[canonical model 规则][canonical-model]

## Asia/Shanghai：TZ 有条件生效，固定设置更可靠

**不能把 `TZ=Asia/Shanghai` 视为无条件覆盖开关。** 最终优先级是有效的 `scanner.bucketTimezone` 固定 IANA 区域优先；未固定、空值或无效值时退回 `chrono::Local`。Linux/Unix 的本地时区路径会参考 `TZ`，Windows 路径不以 `TZ` 作为本地区域。因此已有其他有效 pin 时，仅改 TZ 不会重分桶。[时区选择和日期键][bucket-zone]、[Unix TZ 与 Windows 区别][tz-platform]

首次普通运行会尝试固定本地区域；但指定 `--home` 时，启动自动固定函数立即返回，不写目标或真实用户设置。Linux 下目标 settings 从 `<explicit-home>/.config/tokscale/settings.json` 读取，而不是用 `TOKSCALE_CONFIG_DIR` 替代这个路径。夹具目录可预先只放：

```json
{"scanner":{"bucketTimezone":"Asia/Shanghai"}}
```

依据：[启动固定调用][startup-pin]、[--home 跳过自动固定][pin-settings]、[显式 home 的 settings 路径][home-settings-path]、[显式 home 的 settings 加载][home-settings-load]、[scanner JSON 字段][scanner-settings]。

解析后 `rebucket_date` 根据固定区域从消息时间戳重算 `date`；`timestamp <= 0` 代表无可用时间而被跳过。日期过滤与扫描使用同一份 scanner settings；`--today` 等也按固定区域计算当天。[重分桶][rebucket]、[解析尾部调用][rebucket-call]、[过滤与扫描一致][resolved-date]

对带正确时间戳的 Codex 记录，由日期换算可知 `2026-11-14T15:59:59Z` 属于北京时间 11 月 14 日，`2026-11-14T16:00:00Z` 属于 11 月 15 日。这是源码规则对应的边界预期；运行证据由主会话另存。graph 仅保留日期，不能在接收端靠移动日期字符串纠正已经用错误区域聚合的数据。

`tokscale config set timezone ...` 能初始化 pin，但拒绝变更或移除已有有效 pin；而且本次研究不执行任何配置修改。适配器应记录实际使用的区域，发现目标 profile 不符时明确报告，不声称 TZ 已覆盖。[config 限制][config-guard]

## 输入目录和缓存的隔离

`--home` 令 `use_env_roots=false`，所以扫描 Codex 时忽略宿主 `CODEX_HOME`，使用 `<explicit-home>/.codex/sessions/` 和 `<explicit-home>/.codex/archived_sessions/`；还会考虑目标 home 下的 headless 目录。不要把 `CODEX_HOME` 当作能覆盖显式 `--home` 的参数。[环境根开关][env-roots]、[Codex 扫描路径][codex-roots]、[headless 路径][headless-roots]

缓存隔离要额外指定 **`TOKSCALE_CONFIG_DIR`**。全局 resolver 优先用它，缓存位于其 `cache/` 子目录，包含源消息缓存和价格缓存；价格缓存也直接使用该 resolver。**`--home` 主要隔离扫描根和目标 scanner settings，本身不等于隔离全局缓存。** 保留真实 `HOME`；夹具 settings 不配置指向外部目录的 `extraScanPaths`。[全局配置根及缓存][config-cache]、[价格缓存][pricing-cache]、[scanner 额外路径字段][scanner-settings]

本地 graph 还可能合入 recovery overlay；上游提供 source-only Rust API 用于排除该 overlay，但 `graph` CLI 调用的是本地报告 API。独立空配置与合成 home 有助于让探针只含声明的夹具，不必改用旧 core。[graph 调用][graph-run]、[本地与 source-only API][local-vs-source]

## Token 包含关系：五桶相加，不能再加子集

官方 `TokenBreakdown.total()` 是 `input + output + cache_read + cache_write + reasoning`；`cache_write_1h` 是 `cache_write` 子集，不另加。graph JSON 不输出 `cacheWrite1h`，只能保留合并后的 `cacheWrite`，不能据此还原缓存 TTL。[TokenBreakdown 和 total][token-total]、[graph 五桶 DTO][graph-fields]

| 来源/字段 | 官方转换 | 直接后果 |
| --- | --- | --- |
| Codex 原始 `input_tokens` | `cacheRead = clamp(cached, 0, input)`；`input = input_tokens - cacheRead` | graph 的 input 已排除缓存命中；还原原始总 input 才把 cacheRead 加回 |
| Codex 原始缓存字段 | `max(cached_input_tokens, cache_read_input_tokens, 0)`，再限制不大于 input | 两个缓存字段是兼容别名，不能再求和 |
| Codex 原始 `output_tokens` | `reasoning = clamp(reasoning_output_tokens, 0, output)`；`output = output_tokens - reasoning` | reasoning 是 Codex 原始 output 的子集；graph 已拆开，五桶相加恰好只计一次 |
| Codex `cacheWrite` | 当前 parser 的 `CodexTokenUsage` 没有 cache creation/write 字段；`into_tokens()` 无条件赋 `cache_write=0`、`cache_write_1h=0` | 此来源通过当前官方接口**取不到缓存写入观测**；0 不证明真实缓存写入为零，不能按比例推算 |
| Codex 缺失 counters | `input/output/cached/reasoning` 的缺失值按 0，负数也归零 | `reasoning=0` 等不能区分“未记录该计数”和“确认没有该类 token”；graph 没有逐桶可用性位 |
| Claude Code | `input_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens` 分别写入不同桶，`reasoning=0` | 不沿用 Codex 的“从 input 扣 cache”转换；未单列 reasoning 不代表没有推理 |
| Gemini | thoughts 单列 reasoning，output 保持其输出桶 | 不对 graph 再统一扣一遍 reasoning |

依据：[Codex counters 类型与默认值][codex-counters]、[Codex additive 转换][codex-normalize]、[Claude 映射][claude-tokens]、[Gemini 映射][gemini-tokens]。例如 Codex 原始 input=100、cached=20、output=30、reasoning=10，graph 应为 80、20、20、0、10，合计 130。这是转换公式示例，不是本研究运行结果。

适配层应直接保留官方五桶及 source 的已知能力限制。不要将未知计数虚构为可观测的 0，不把 input、cache、reasoning 再叠加到原始供应商 total，也不发明任何比例分摊。

## 费用：已有 provenance；零值必须结合来源解释

官方费用数值是 `f64`；`graph` 输出 JSON 前没有向分或固定小数位量化。估算代码把 `output + reasoning` 按 output 费率计算，和 Codex 已拆开的桶一致。适配器应消费现成 `cost`，**不重新计价**。[费用字段][graph-fields]、[graph 序列化][graph-run]、[上游费用计算][compute-cost]

`costProvenance.kind` 的 wire 值是 `providerReported`、`estimated`、`unknown`、`mixed`；`estimateSource` 可以为 `catalog`、`custom`、`unknown`、`mixed`。这些已经是官方费用来源信息，不能把当前版本描述为“没有费用 status”。[provenance 枚举][provenance-types]

| 官方 provenance | 建议解释 | 不能推断的内容 |
| --- | --- | --- |
| `providerReported` | 源记录报告的费用；即使数值为 0 仍有报告来源 | 不自动等于用户账单已结算或订阅实际付款 |
| `estimated` + `catalog/custom` | 上游目录或用户定价规则计算的估算 | 不等于实际支出；正估算也可能未覆盖所有非零桶 |
| `estimated` + `unknown` | 上游知道是估算，但具体估算来源未保留 | 不冒充当前 catalog 或 custom |
| `unknown`，或缺失 provenance | 无法确定费用来源；未计价/无价格时可为 0 | 不将 0 标成免费或实际支出；未知费用可在应用契约中保留为 null |
| `mixed` | 聚合内混合来源，原样保留 | **不能拆出 actual 与 estimated 各自金额**，也不能将整项升级为 actual；无比例分摊 |

聚合器直接累加 `cost`，并合并来源；含 token 的未知项即使费用为 0 也参与 provenance，和已知来源一起可产生 mixed。无 token、无费用、无已知来源的空活动不影响来源；明确报告或估算的零仍参与。[费用来源聚合规则][provenance-fold]、[数值累加][joint-key]

**未计价模型不会仅因没有价格而删除 token 行。** Codex 使用明确模型名，完全没有模型时保留 `unknown`；原始 Codex usage 消息的初始费用是 0，后续通过公共价格应用路径赋值。没有价格服务时设 `cost=0`、来源 unknown；找不到价格行时 `PricingEstimate` 也返回 0 且 `coverage=false`。于是 `0 + unknown` 可能代表未计价、离线无缓存、陈旧/不完整价格，而非免费。[Codex 模型与默认费用][codex-message]、[无价格应用][pricing-apply]、[无匹配价格][pricing-estimate]

反过来，显式零费率且覆盖 usage 的行可以产生 `cost=0` 与 `estimated/catalog` 或 `estimated/custom`；这是有来源的零估算。单看数字 0 存在歧义，结合 provenance 后可保留这一区别。`PricingEstimate.source()` 对零估算要求非空 usage 且 coverage 成立。[估算来源判定][estimate-source]

**费用来源不等于费用完整性。** 本地 `graph` 使用 `GraphPricingRequirement::Lenient`，不会执行 Submission 分支才运行的未计价清单与 incomplete dates 处理；CLI 虽有 `totals.costIsComplete` DTO，但普通 graph 的缺省值不能证明完整计价。上游还明确支持 `PartialEstimate`，正值部分估算可能仍被标为 estimated；保留 provenance 已足够表达来源，但不能额外承诺所有桶都已计价。[本地 graph 策略][local-vs-source]、[Lenient 与 Submission 分支][graph-pricing-policy]、[价格状态赋值][pricing-apply]、[estimated 的判定][estimate-source]、[costIsComplete 序列化][graph-map]

`pricing explain --json --no-spinner` 的确有 `coverage`、`uncoveredBuckets`、`estimateStatus` 等诊断字段；然而 CLI 明确拒绝该命令的 `--home`，实现中使用默认 home 和 `use_env_roots=true`。解释 DTO 又没有 date、timestamp、session/message ID 或 tokens，不能可靠地与 graph 的某日行关联。因此不为本任务追加运行它来补状态，更不能在真实 HOME 上试探。若未来必须逐行证明覆盖，应向当前官方 CLI 提出带 home、日期和可关联键的输出扩展需求。[pricing 的 --home 拒绝][pricing-home]、[explain 扫描路径][pricing-explain]、[诊断字段][pricing-explanation]

本任务另有已确认的实施约束：将官方 double 的 shortest round-trip 十进制表示规范化为 decimal 字符串，保留其数值残差；不以固定小数位四舍五入，不重算价格。此处是本项目接收契约要求，不声称上游提供了任意精度金额。未知金额的 null 语义与有来源的零分别保留。

## 合成 Codex JSONL 的最小字段及 pending 边界

只供主会话构造夹具，研究未运行。一般 `token_count` 路径可用三类行：[Codex entry/payload][codex-entry]、[usage 字段][codex-counters]、[token_count 路径][codex-token-count]

```jsonl
{"timestamp":"2026-11-14T15:59:00Z","type":"session_meta","payload":{"id":"fixture-a","source":"cli","model_provider":"openai"}}
{"timestamp":"2026-11-14T15:59:01Z","type":"turn_context","payload":{"model":"gpt-5.2"}}
{"timestamp":"2026-11-14T15:59:59Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":10},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":10}}}}
```

`last_token_usage` 是主增量，`total_token_usage` 用于快照去重、单调检查等；不要把每条累计 total 再求和，连续夹具的累计字段应符合事件关系。没有 model 的独立会话适合验证 `unknown`，避免从前一 turn 继承已知模型。[token_count 解析][codex-token-count]、[缺模型保留][codex-message]

另一条有效路径是顶层 `type=token_usage_record`，`payload.usage` 使用同样的 counters，可加 `payload.model/thread_id/turn_id/response_id`。记录属于另一 thread 时会跳过；同 thread 的记录先 pending，以等待规范 `token_count` 确认并去重。下一 usage record、下一 turn，或者同 `turn_id` 的 `event_msg` / `task_complete`、`turn_aborted` 才会结算未确认记录；EOF 本身不会结算该 pending。[pending 创建][codex-pending]、[终止事件结算][codex-settle]、[文件末尾返回状态][codex-eof]

因此合成每个独立 response 时，主会话采用 `task_started` → `turn_context` → `token_usage_record` → 匹配 turn 的 `task_complete` 能避免末条仍 pending。不能仅因末条未出现就判定未计价模型被丢弃；官方已有终止事件结算测试，可作源码依据而非本研究测试通过声明。[官方终止结算测试][codex-settle-test]

## 最小适配决定与仍有的缺口

建议固定 `@tokscale/cli@4.23.0`，只调用 graph 入口，将 `date + client + modelId` 展平，保留五桶、上游 cost/provenance、未知与 mixed 的语义，并把使用区域写入本项目契约。使用 `--home` 加独立 `TOKSCALE_CONFIG_DIR` 管理合成输入、settings 和缓存。不消费旧 npm core：当前 CLI 包无普通 dependencies，通过同版本平台 optionalDependencies 启动原生 CLI；文中 `crates/tokscale-core` 仅是这份固定 SHA 内部实现的证据。[当前 CLI 包声明][npm-package]

仍有的上游边界是内部具名 agent 不在 graph 中、provider 已合并、原始模型名已 canonicalize、逐桶缺失信息被归零、Codex cache write 无观测、mixed 金额不可拆、来源不保证完整计价、价格目录快照与区域没有随 graph 明确输出。它们需要明确契约能力；本任务无需为这些缺口发明分摊或改用旧 core。

验证状态：已独立核实 npm registry、官方 release/tag/commit 一致性，完成上述固定 SHA 源码追踪及引用行号检查。没有运行 CLI、项目测试或用户日志；主会话报告的合成探针结果不冒充本研究的独立运行证据。

## 固定 SHA 源码索引

所有下列源码链接固定在 `5569a0397b52c6c445e346814747a772fc3c0a11`，锚点为实际文件行。

[npm-package]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/packages/cli/package.json#L1-L41
[cli-global]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L40-L107
[cli-commands]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L120-L273
[cli-graph]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L261-L273
[graph-run]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L6303-L6344
[graph-stdout]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L6391-L6395
[graph-fields]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L5256-L5345
[graph-map]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L5634-L5720
[models-json]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L2531-L2576
[monthly-json]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L3403-L3449
[daily-fold]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/aggregator.rs#L141-L174
[joint-key]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/aggregator.rs#L535-L599
[canonical-model]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L112-L136
[message-fields]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/mod.rs#L143-L165
[bucket-zone]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/bucket_tz.rs#L34-L112
[tz-platform]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/bucket_tz.rs#L205-L252
[startup-pin]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L742-L761
[pin-settings]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/tui/settings.rs#L523-L595
[home-settings-path]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/tui/settings.rs#L640-L663
[home-settings-load]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/tui/settings.rs#L766-L778
[scanner-settings]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/scanner.rs#L35-L81
[rebucket]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/mod.rs#L625-L647
[rebucket-call]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L1608-L1629
[resolved-date]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L2302-L2341
[date-filter]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L7282-L7294
[config-guard]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/commands/config.rs#L181-L211
[env-roots]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L2014-L2022
[codex-roots]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/scanner.rs#L2639-L2673
[headless-roots]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/scanner.rs#L380-L402
[config-cache]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/paths.rs#L77-L121
[pricing-cache]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/cache.rs#L6-L59
[local-vs-source]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L7126-L7160
[token-total]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L313-L349
[codex-entry]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L48-L113
[codex-counters]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L158-L207
[codex-normalize]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L275-L300
[claude-tokens]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/claudecode.rs#L1163-L1176
[gemini-tokens]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/gemini.rs#L274-L290
[compute-cost]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/lookup.rs#L2971-L3013
[provenance-types]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L525-L587
[provenance-fold]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/aggregator.rs#L392-L455
[pricing-apply]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L7403-L7443
[pricing-estimate]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/mod.rs#L805-L845
[estimate-source]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/mod.rs#L3541-L3561
[graph-pricing-policy]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/lib.rs#L6703-L6738
[pricing-home]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L903-L920
[pricing-explain]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-cli/src/main.rs#L4070-L4098
[pricing-explanation]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/mod.rs#L3564-L3593
[codex-message]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L1915-L1960
[codex-token-count]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L1558-L1591
[codex-pending]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L1123-L1177
[codex-settle]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L1180-L1220
[codex-eof]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L1895-L1912
[codex-settle-test]: https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/sessions/codex.rs#L6457-L6470
