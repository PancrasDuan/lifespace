# Token 首阶段统计契约

> 本文保留阶段范围与当时验证；累计实现、已收敛结论及独立验收门禁见 [统一集成验收](token-integration.md)。

对应 [#206](https://github.com/PancrasDuan/lifespace/issues/206)，父任务 [#205](https://github.com/PancrasDuan/lifespace/issues/205)，规划 #79／#82／#83／#85。仅实现本地契约与适配，不代表上传链路或整个 MVP 完成。领域依据见 [ADR 0019](adr/0019-token-local-rollup-contract.md)。

## 入口与运行边界

| 入口 | 用途 |
| --- | --- |
| `src/shared/token-usage-contract.ts` | Zod 运行时 schema、派生 TypeScript 类型、规范化与 Web Crypto SHA-256；可用于 Node、浏览器和 Worker |
| `tools/token-collector/tokscale-adapter.ts` | 固定 graph 形状校验、联合分项对账、投影为主汇总；可以独立测试 |
| `tools/token-collector/tokscale-cli.ts` | Node-only 子进程；固定本项目依赖，不从 PATH/npx 自动拉取最新版 |
| `build-plugins/token-collector-boundary.ts` | Vite 全环境阻止 collector 或 `@tokscale` 进入浏览器/Worker bundle |

`collectTokscaleUsage({ homeDir, configDir, agents?, since?, until? }, context)` 要求绝对目录，日期为有效公历日且起止有序；`agents` 缺省为 `['codex']`，只接受 `codex`／`grok`／`hermes`／`claude`／`workbuddy`／`cursor` 的非空去重列表。它强制 `TZ=Asia/Shanghai`、独立 `TOKSCALE_CONFIG_DIR`、显式 `--home`、`--client <授权列表>` 和 `--offline`；只对授权 Agent 设置 `CODEX_HOME`／`GROK_HOME`／`HERMES_HOME`。`claude`／`workbuddy`／`cursor` 不设置额外根：Claude 的 `--home` 优先于 `CLAUDE_CONFIG_DIR`，WorkBuddy 读取 `<home>/.workbuddy/workbuddy.db`，Cursor 只读 `<home>/.config/tokscale/cursor-cache/usage*.json`。采集器不执行 Cursor 登录或同步，也不读取本地 `~/.cursor` 会话。调用前检查显式 home 下 `.config/tokscale/settings.json`，缺失时在 Linux/macOS 都检查旧布局 `Library/Application Support/tokscale/settings.json`。拒绝无效配置或非北京 `scanner.bucketTimezone`，因为有效 pin 优先于 TZ，不擅改已有设置。子进程不继承服务凭据，不调用登录、提交或自动同步命令，超时 60 秒，stdout 上限 32 MiB。错误不返回原始 stdout/stderr/路径；stderr只返回`TOKSCALE_PRICING_WARNING`／`TOKSCALE_MISSING_USAGE`／`TOKSCALE_CURSOR_CACHE_UNAVAILABLE`／`TOKSCALE_DIAGNOSTIC`固定类别。按[ADR0020](adr/0020-token-recorded-usage-authority.md)，这些告警不阻断成功且通过联合校验的已记录统计；不另证原始日志完整性。真正CLI失败／超时或输出无效仍拒绝替换，同步成功另需严格回执。

安装的工具为精确 devDependency `@tokscale/cli@4.23.0`，平台包及 integrity 固定在 `package-lock.json`。2026-11-15 重新查询 npm 官方 `latest` 确认此版本，未直接沿用旧研究。已实跑 Linux x64，Node **24.22.1**；仓库已有 `.node-version` 不由本任务改动。macOS 的真实执行留待后续设备验收。

## 三部分契约

`TokenUsageSnapshot = { identity, content, metadata }`，所有上传契约对象均拒绝额外字段，不允许混入正文、路径、会话/线程/响应标识或原始系统 ID。适配器允许上游报表有其他字段，但只投影统计白名单。模型标识来自上游，不是从会话或文件名派生；不得用它承载本地路径。

| 部分 | 字段与含义 |
| --- | --- |
| identity | `deviceId` 应用专用 opaque ID；`date` 北京公历日；`agent` 工具来源，取 Tokscale `client`（`codex`／`grok`／`hermes`／`claude`／`workbuddy`／`cursor`） |
| content | `metrics` 主汇总；`cost` 费用；`models: { coverage, items }` 模型分类 |
| metadata | `schemaVersion: 1`、`statisticsVersion`、`tool: { name, version }`、`priceVersion`、`scannedAt`；可选 `hostname`、`snapshotVersion` |

`deviceId` 的实际派生算法/登记不在本阶段实现；验证字符串形状不证明它是正确派生值。有序快照版本是可选正整数字符串，避免 JS 安全整数上限；当前采集器会分配、持久化并由服务端严格回执确认版本。`priceVersion: null` 表示没有可取得的可靠价格快照版本，不能拿工具版本充当价格版本。schema v1 之外的格式应升级契约后再验证。

每份主汇总与携带的全部模型子项是一个替换单元；未来删去旧模型或数值下调必须整体替换。适配器按 graph 的 `(date, client)` 分组，每组生成一个快照，`identity.agent` 直接取 `client`；同一天同名模型出现在不同 Agent 下是合法且互不替代的。模型子项稳定键是 JSON 编码的 canonical `modelId`，未知为 `null`；上游 `unknown` 映射为未知桶，不按名称猜测真实模型。同一 `(date, client)` 内同一模型键不允许重复，模型重归属不改变主汇总 identity。`providerId` 是上游提供方标签，缺失/空/unknown 映射 null；上游按 client+模型聚合，可能把多个 provider 拼为同一标签，故不把它伪装成可独立筛分的维度，也不将它加入子项键。

## Token 与缺失

| 字段 | 本项目含义 | 4.23.0 graph 映射 |
| --- | --- | --- |
| input | 包含缓存读取/写入的输入总数 | `tokens.input + cacheRead + cacheWrite` |
| output | 包含推理的输出总数 | `tokens.output + reasoning` |
| total | 输入加输出，只加一次 | 五个互斥 graph 桶之和 |
| cacheRead | 输入的缓存读取分量 | `tokens.cacheRead` |
| cacheWrite | 输入的缓存写入分量 | Codex 无此测量，省略；Grok/Hermes/Claude/WorkBuddy/Cursor 保留 graph 桶，包括 0，以保证模型子项与主汇总对账 |
| reasoning | 输出中的推理分量 | `tokens.reasoning` |

计数为非负安全整数，超出范围拒绝。已知的 total 必须等于 input+output，包含分量不能大于所属总数。缓存读取率由合计 `cacheRead / input` 计算，不平均各设备/模型的百分比；分母零、缺失或未知时无可用比例。本阶段不增加展示层。

字段省略表示未报告，`null` 表示已明确未知，`0` 表示已知零，三者具有不同摘要。模型覆盖 `complete` 表示分类完整（包括显式未知模型桶），逐分量与主汇总对账；不表示来源历史完整或模型身份全已知。`partial` 不承诺能由子项重建总量；`missing` 要求空 items。不能把主汇总与分类相加。

CLI 已将原始日志压成五个数值桶，部分缺失源字段会在上游变为默认零，无法仅靠 graph 还原每个原始字段是否存在。本项目接受经验证的 Tokscale 计数口径，不把它声称为逐事件字段可用性证明。合成样本验证正常已完成回合与缺少模型上下文；继承、fork、压缩、归档副本及不同真实客户端版本仍需后续设备样本验证。

## 费用与精度

`cost = { currency, actual?, apiEstimate?, unclassified?, coverage }`。币种沿用上游默认 **USD**，不换汇。金额是非负规范十进制字符串：不用指数、前导零、多余小数尾零或负零。上游 f64 先取 JS 最短往返表示再展开指数，**不重算价格，也不擅自四舍五入**；例如实际样本 `0.00014199999999999998` 原样保留。显示层以后可格式化金额，不能回写摘要内容。合计用十进制整数缩放，避免再次引入浮点误差。

| 上游 costProvenance.kind | 映射 |
| --- | --- |
| providerReported | `actual` 已知金额，complete，包括真实零 |
| estimated | `apiEstimate` 已知金额，unverified，包括有来源的零；provenance 不证明逐桶完整计价 |
| mixed | `unclassified` 已知小计，partial；上游未给实际/估算拆分，不猜测 |
| unknown，cost=0 | `apiEstimate: null`，unknown；不能将零当成免费 |
| provenance 缺失，cost=0 | 不报告金额，unknown，与显式未知区分 |
| provenance 未知/缺失，cost>0 | `unclassified` 小计，partial，不能改称实际或 API 估算 |

coverage `complete` 要求至少一个已知类别且无显式未知金额；`unknown` 不允许已知金额；`partial` 保留已知小计但存在未计价/未拆分部分；`unverified` 表示有金额但接口不能证明计价覆盖完整。实际费用、API 估算和未分类费用可并存，但分别命名，不合并称为实际账单。主费用由模型费用分类合计，并保留未计价状态；不直接将日总 cost 当成完整已知费用。

原始 graph 日期与模型费用用 f64 误差容限对账，内容存储与摘要**不使用容差**。本地 graph 使用 Lenient 计价：正值 `PartialEstimate` 也可标 estimated，缺省 `costIsComplete` 不是完整计价证明，因此本适配器不将估算升级为 complete。官方 `pricing explain` 虽有逐桶诊断，但不支持 `--home` 且缺日期/关联键，不能安全可靠补到某日某模型；本阶段不绕过该限制读取真实 HOME。价格来源 `estimateSource` 是 catalog/custom/unknown/mixed 的诊断信息，不是可复现的历史价格版本，当前不进入摘要；价格未命中、离线无缓存与过期价格等仍须依据上游诊断处理。本测试缓存包含**虚构价格**，不构成当前真实 API 标价。

## 规范化与 SHA-256

`canonicalTokenUsageContent(content)` 先严格校验，只处理统计白名单；模型 items 按上述模型键 JSON 的 UTF-16 字典序排序，对象键递归按同一序排序，数组无额外重排，数字使用 JSON 序列化，UTF-8 字节无 BOM/空白。省略的字段不输出，null 保留，数值负零自然归为零。字符串不做大小写、Unicode 或别名归一，避免合并不同来源模型。

`tokenUsageContentHash(content)` 对规范字符串使用 SHA-256，返回 64 字符小写 hex；`tokenUsageSnapshotHash(snapshot)` 校验 envelope 后仅取 content。因此 identity、schema/统计/价格/工具/快照版本、hostname 和扫描时间均不参与；同内容跨身份可具有同摘要，服务端不得设全局唯一约束。schema v1 只接受版本 1，但版本字段本身不出现在摘要字节中。

供未来数据库实现交叉核验的固定向量：

```json
{"cost":{"apiEstimate":null,"coverage":"unknown","currency":"USD"},"metrics":{"cacheRead":20,"input":100,"output":30,"reasoning":10,"total":130},"models":{"coverage":"missing","items":[]}}
```

SHA-256：`d79d902b2a4f9729093d471e38a8dfac7c4fc755f0569502e454eecb84d5d526`。这是一套受限 JSON 契约的规范化规则，未声称完整实现任意输入的 RFC 8785。服务端未来应使用相同向量及模型顺序样本验证，不能只做 jsonb 文本转 SHA。

## 实跑证据与复现

合成日志生成器 `tests/fixtures/token-usage/synthetic.ts` 不含正文、路径、真实设备标识或凭据；测试在 mkdtemp 中创建 source home 与独立 config，完成后只删除本测试目录。固定报表 `tests/fixtures/token-usage/tokscale-4.23.0-graph.json` 是本次实际 `graph` 输出（含运行时间，不进入统计摘要），没有用全局模型占比分摊日用量。多 Agent 同名模型与组内重复用例在内存中基于该合成图构造，不写入仓库真实来源。

已在隔离目录实际执行的命令形状：

```sh
tokscale --version
TZ=Asia/Shanghai TOKSCALE_CONFIG_DIR=<synthetic-config> CODEX_HOME=<synthetic-home>/.codex \
  tokscale graph --offline --home <synthetic-home> --client codex \
  --since 2026-11-14 --until 2026-11-15 --no-spinner
```

多 Agent 调用使用同一形状，只把 `--client` 换成显式授权列表，并为 `codex`／`grok`／`hermes` 设置对应根；Claude、WorkBuddy 与 Cursor 只依赖 `--home`：

```sh
TZ=Asia/Shanghai TOKSCALE_CONFIG_DIR=<synthetic-config> \
  CODEX_HOME=<synthetic-home>/.codex GROK_HOME=<synthetic-home>/.grok HERMES_HOME=<synthetic-home>/.hermes \
  tokscale graph --offline --home <synthetic-home> --client codex,grok,hermes,claude,workbuddy,cursor --no-spinner
```

Claude 合成会话实测 `<home>/.claude/projects/**/*.jsonl` 解析为 input 150（含 cacheRead 20、cacheWrite 30）、output 40、total 190；`--home` 优先于 `CLAUDE_CONFIG_DIR` 的结论来自这一手工探针，自动化测试只证明采集器不转发外部 `CLAUDE_CONFIG_DIR`，不单独重演上游优先级。WorkBuddy 合成 SQLite 的 `sessions` + `session_usage` 实测为 input 42、output 0、费用 unknown。Cursor 在缓存缺失、损坏、空数组、空对象或无 `usage` 字段时均返回空 graph、退出码 0，并在 stderr 输出含缓存绝对路径的固定告警；采集器将其归类为 `TOKSCALE_CURSOR_CACHE_UNAVAILABLE`，不透传原文或路径。仓库测试覆盖缺失和损坏两种形态；空数组、空对象与无 `usage` 字段只做了手工探针，未固化为自动化用例。本机没有 Cursor 账号，有效缓存形状和真实数据未验证；`cursor sync --offline` 明确失败，必须在线，因此采集器不代为登录或同步。采集器不调用任何登录或同步命令，但“无网络访问”由调用边界和 `--offline` 保证，没有以网络拦截测试单独证明。

本机 4.23.0 的 Grok 真实探针可能返回 `cost: 0` 且 `costProvenance.kind=unknown`，即使底层会话有 `costUsdTicks`；本项目不读原始日志补价，按未知费用保存。Hermes 可能同样为 unknown；正数未知费用保守映射为 `unclassified/partial`，不猜成实际或 API 估算。Hermes 按日拆分依赖会话日志与 `logs/agent.log`，跨日未覆盖部分留在开始日，日趋势可用但不宣称逐次调用精确。Hermes 可能启动 `codex app-server` 而 Codex 也写 `~/.codex`；若同时授权两者，可能对同一调用重复计量，文档只提示重叠风险，不做静默去重。

`graph` 原生输出 JSON，无需 `--json`，也没有 `daily` 子命令。实际调用使用锁定依赖的绝对 bin 入口，见 Node 封装。

| 合成事件时间 | 北京日期 | 模型 | input/cacheRead/output/reasoning（来源包含数） | total |
| --- | --- | --- | --- | --- |
| 2026-11-14T15:59:59Z | 11-14 | gpt-5.5 | 100/20/30/10 | 130 |
| 2026-11-14T16:00:00Z | 11-15 | gpt-5.5 | 200/50/60/20 | 260 |
| 2026-11-15T02:00:00Z | 11-15 | synthetic-unpriced-206 | 300/70/90/30 | 390 |
| 2026-11-15T03:01:00Z | 11-15 | 未知 | 40/5/10/2 | 50 |

合计 830；11-14 为 130，11-15 为 700，不将缓存/推理再次加到来源总量。未完成的 token_usage_record 回合可能处于上游 pending 状态；生成器显式 task_started/task_complete，使测试不依赖隐含结算推断。

执行 `npm exec vitest run tests/api/token-usage-contract.test.ts tests/api/token-usage-cli.test.ts` 复现纯契约、真实 CLI、隔离价格缓存、重复扫描与 Vite 入口边界检查。另按仓库运行 API 回归、typecheck、build 和密钥扫描；最终 SHA 与评审/CI 状态记录在关联 PR。

## 后续门禁

本阶段没有读取真实私有日志、双设备端到端、系统定时安装、SQLite 恢复、设备授权、Supabase RPC、数据库端摘要核验或正式页面；这些不能以合成测试代替。离线扫描来源被删除/部分不可读时的覆盖证明与替换策略必须在持久化阶段解决，空扫描不生成“零快照”删除历史。正式页面继续以 #203 最终文案精简原型为基线，禁止恢复旧版 3D、导出或常驻详情。
