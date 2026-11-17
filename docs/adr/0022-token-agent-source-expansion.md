# 新增 Claude Code、WorkBuddy 与 Cursor 来源，Cursor 只读已有缓存

2026-11-18，Issue #235 在已有 Codex、Grok Build、Hermes Agent 三个来源上增加 Claude Code（`claude`）、WorkBuddy（`workbuddy`）和 Cursor（`cursor`），其余 client 不接入。该变更扩大采集来源和公开 `agents` 配置范围，属于需确认的变更；本 ADR 记录来源边界和 Cursor 取舍，实施与验收证据仍写回 Issue。

固定 Tokscale 4.23.0 继续独占来源解析、去重和统计，采集器只负责固定调用、联合校验和上报。新增三个 client 进入同一个 `(date, client)` 联合 graph：Claude 读取显式 `--home` 下 `.claude/projects/**/*.jsonl`；WorkBuddy 读取该 home 下 `.workbuddy/workbuddy.db`；Cursor 只读该 home 下 `.config/tokscale/cursor-cache/usage*.json`。采集器不为它们设置额外根目录。Claude 的 `--home` 优先于 `CLAUDE_CONFIG_DIR`，因此不设置后者，避免扫描到操作者未指定的位置。适配器保留 Claude、WorkBuddy、Cursor 的真实 `cacheWrite` 桶；只有 Codex 继续省略该桶。

Cursor 不提供本地会话，数据来自 Tokscale 自己的 Cursor API 缓存，缓存需要 `tokscale cursor login` 与 `cursor sync`（OAuth、联网）。本决定选择“只读操作者已准备的缓存”：采集器不执行登录或同步，不读取本地 `~/.cursor`，也不扩大 Tokscale 凭据和缓存路径的边界。缓存缺失、损坏、空数组、空对象或结构不符时，4.23.0 均返回空 graph 和退出码 0，并输出包含缓存绝对路径的告警；采集器将其归类为 `TOKSCALE_CURSOR_CACHE_UNAVAILABLE`，保留旧汇总，不制造零快照，也不透传路径。操作者须在采集器之外完成登录和同步。

放弃的选项：在 `sync` 中自动执行 `cursor login`/`cursor sync` 会引入静默联网、OAuth 状态和额外凭据处理，且 `cursor sync` 明确拒绝 `--home`，无法保证只作用于显式来源；直接读取 Cursor 本地会话不符合固定 Tokscale 的职责边界；不接入 Cursor 则不能满足本次来源范围。代价是 Cursor 在缓存未准备时没有数据，且真实有效缓存尚未在本机验证。

默认来源仍只有 `codex`，旧状态库缺少 `agents` 时按 `['codex']` 读取；新来源必须通过 `init --agents` 或 `sources add --agents` 显式授权。`init --replace`、普通 `upgrade` 和 `sync` 不扩大来源，沿用 #233 的决定。`agentsSchema` 上限从 3 调整为 6，但 agent 命名正则、数据库 `(date, agent)` 主键、上传 RPC、鉴权和账户隔离不变，无迁移。统计口径版本升为 `tokscale-multi-agent-2`，使新增来源与旧口径可追溯；旧快照仍保留，只有实际授权并成功扫描后才产生新内容。

验证边界：Claude 合成会话和 WorkBuddy 合成 SQLite 已通过固定 4.23.0 实跑；Cursor 只验证了缓存缺失/损坏的 graph 行为和诊断脱敏，没有 Cursor 账号，因此有效缓存结构、真实数据、页面四方对账和真实设备验收仍未完成。合成检查不能替代这些验收。
