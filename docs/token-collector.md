# Token 采集器协议（#213 / #223 / #205）

2026-11-16，用户在 #223 明确决定信任 Tokscale 的结果、由采集器负责校验与上报。当前职责见 [ADR0020](adr/0020-token-recorded-usage-authority.md)；[ADR0018](adr/0018-token-source-coverage-and-local-queue.md) 的逐日志覆盖证明及告警冻结仅为 0.1.0–0.1.2 历史。阶段03起点为 `04566322ea0a200c2886ea93fd242e2b0be1bb66`；生产上线和真实设备验收分别见 [统一集成](token-integration.md)与[设备接入](token-device-onboarding.md)，不以阶段准备代替真实验收。

Node **>=24.22.1 <25**，固定 Tokscale 4.23.0。安装、命令与恢复见[包说明](../tools/token-collector/README.md)。统计和上传 schema 复用 `src/shared/`；本次只调整 Agent 来源与看板选项，不新增网页设计、云资源、来源完整性协议或数据库迁移。0.1.6 起可采集 Codex、Grok Build（`grok`）、Hermes Agent（`hermes`）、Claude Code（`claude`）、WorkBuddy（`workbuddy`）和 Cursor（`cursor`）；默认全部，只有显式 `--agents` 或 `sources set` 才收窄。

## 统计边界与诊断

Tokscale 独占来源解析、继承／fork／归档去重、模型与 token／价格统计。采集器执行固定 CLI，接受成功退出且通过版本、时区、JSON 结构、合法数值及日期／模型／总量一致性校验的已记录用量，不另读原始日志做 JSON、UTF-8、换行、压缩、时间戳、文件／祖先目录 stamp 或 prefix 完整性审计。正常追加、新建会话与 missing-usage 告警不阻断有效结果；支持的来源形态与 scanner 配置由固定 Tokscale 决定。

一次调用传入配置的完整 Agent 列表，并按 graph 的 `(date, client)` 分组生成快照；`identity.agent` 即 `client`。同一天同名模型在不同 Agent 下合法，只有同一 `(date, client)` 内重复模型才拒绝；任一未授权 `client` 或任一分项对账失败都拒绝整份结果并保留旧快照。默认 `agents` 为全部六个来源；0.1.5 及更早写入的状态不含 `agentsMode`，不能直接运行，`status` 只读显示 `reinitRequired`，其余命令返回 `REINIT_REQUIRED`，须先 `init --replace` 重建。重新 `init` 不继承旧来源列表，未传 `--agents` 即全部六个。`sources set --agents` 是显式收窄入口，`sources add --agents` 在显式列表上追加；普通 `upgrade` 与 `sync` 不改变已有模式。Claude、WorkBuddy 与 Cursor 不设置额外根，统一依赖显式 `--home`；Cursor 只读已有 Tokscale API 缓存，不自动登录或同步。

stderr 只转为固定本地诊断：`TOKSCALE_PRICING_WARNING`、`TOKSCALE_MISSING_USAGE`、`TOKSCALE_CURSOR_CACHE_UNAVAILABLE` 或 `TOKSCALE_DIAGNOSTIC`。不回显原始内容、路径、ID 或日志片段，不把所有 warning 当过程失败。失败退出／超时、JSON／结构／数值异常、版本／时区冲突或联合总量不一致则不替换旧汇总，不分配新请求。有效重算可以增加、减少或移除旧模型；未知／null／缺失不补零。新 graph 中没有旧日期时保留该日期旧值，用 `retainedDates` 和 `GRAPH_DAY_ABSENT` 说明，不制造零或清空。

## 本地持久化与恢复

`state.sqlite` 的 meta 保存配置、授权请求／凭据和最新脱敏诊断；rollups 按日期／Agent 保存唯一最新内容、generation、version/hash；queue 保留不可变上传 JSON、对应主键／代际／版本/hash、重试次数／下次时间及固定错误码。旧 `sources` 表保留 schema 和既有行兼容升级，但不再读写或维护来源证明。所有状态仍在应用私有目录，权限检查包括 SQLite journal 与 Tokscale 缓存；原始硬件标识只在内存用于派生 deviceId，hostname 不参与身份。

有效扫描在同一事务分配版本并保存最新统计／待传请求及诊断。hash 与**最近分配内容**比较，内容与 `statisticsVersion` 都相同才不产生新版本；A→B→A 有其他内容在途时仍分配新版本。ack 仅删除 persisted=true 且严格匹配 device/date/agent/generation/version/hash 的任务。旧／不完整回执无权清队列；重试沿用逐字相同 body，普通网络或凭据错误不丢未确认请求。扫描失败时旧队列仍可按正常严格回执规则发送，不生成替代统计。

offline 未授权扫描可保存最新内容（generation=0，不上传）；正常获准领取新代际后从版本1重传最新值。领取请求和轮询时间先持久化，响应及代际队列重建在同一事务；只有明确新代际才取代旧队列。窗口外、停用或本地凭据遗失须重新经浏览器批准，不能凭设备身份恢复权限。

`run.sqlite` 的独立 `BEGIN IMMEDIATE` 覆盖整个运行，由 OS 释放锁，不用 wall-clock lease 或删除 PID 文件。请求10秒、响应最多64KiB、拒绝重定向；失败按5秒指数退避到最多1小时，每轮至多100任务。心跳独立、无新增也发送，不参与内容版本。普通扫描不变不写新版本／队列，不表示扫描诊断时间戳完全不写。

## 价格与运行时

[固定上游 pricing refresh](https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/refresh.rs)只下载公开目录，失败保留旧缓存。Tokscale 使用应用独立 TOKSCALE_CONFIG_DIR 和干净环境；首次／每日及手动可刷新价格，graph 始终 offline。priceVersion 是 catalog data 逻辑内容摘要、排除更新时间，不是历史价格序列。estimated 保持 unverified，unknown 不补零。0.1.3 保持已测稳定 Node24.22.1 基线，不以删除来源审计为由扩展运行时。

0.1.4 仅为上游 f64 费用聚合对账设置 `max(1e-12 USD, 1e-12 × max(总额, 分项和))` 的绝对／相对误差预算，覆盖事件按不同顺序分组累加的残差；不以模型数估计事件数，不舍入或重算上游模型金额。零与正数仍不相等，明显超差／非有限数／负数／溢出仍失败。Token 整数、模型金额的最短往返十进制展开、共享契约的精确字符串合计、规范化和 SHA 全部继续精确比较。0.1.5 的统计版本为 `tokscale-multi-agent-1`；0.1.6 升为 `tokscale-multi-agent-2`，但不改变 SQLite schema、上传 schema 或已有 `(date, agent)` 主键。

Grok 在 4.23.0 可能返回 `cost=0`、`costProvenance=unknown`（底层 `updates.jsonl` 可有 `costUsdTicks`）；不读原始日志补价，按未知费用保留。Hermes 跨日会话的未覆盖部分留在开始日，日趋势可用但不宣称逐次调用精确。Hermes 的 `codex_app_server` 可能与 Codex 重复计量；同时授权时文档提示重叠风险，采集器不做静默去重。Hermes 费用 provenance 可能为 unknown，正数未知费用映射为 `unclassified/partial` 是保守行为，不猜成 API 估算。

Claude 读取 `<home>/.claude/projects/**/*.jsonl`，`--home` 优先于 `CLAUDE_CONFIG_DIR`，采集器不设置后者。WorkBuddy 读取 `<home>/.workbuddy/workbuddy.db`；空 home 或仅有 `sessions` 表返回空结果、退出码 0。Cursor 不读本地会话，只读 `<home>/.config/tokscale/cursor-cache/usage*.json`；缓存缺失或损坏同样返回空 graph、退出码 0，并产生含路径的上游告警，采集器只保留 `TOKSCALE_CURSOR_CACHE_UNAVAILABLE`。操作者须在采集器之外准备 Cursor 缓存（`tokscale cursor login` + `cursor sync`，需联网）；采集器不代为登录、同步或扩大凭据边界。Cursor 缓存缺失时保留旧汇总，不制造零快照；真实有效缓存与数据未在本次验证。

## 验证与交付

`npm run test:api` 覆盖警告不拦、有效降值／模型移除、缺席日保留、失败／无效输出不改旧统计或待传任务、敏感 stderr 不泄露，以及既有身份／锁／回执／重试。旧 inventory／压缩前缀测试随已授权职责调整删除，不以改宽坏帧断言伪装原策略继续通过。

`npm run test:collector-package` 在仓库外实际 pack/install，只从安装包运行；默认验证同版本重装保留 SQLite／身份／待传任务及旧 sources 行。设置 `TOKEN_PACKAGE_PREVIOUS_ARCHIVE` 为映射中已保留的旧归档时，才实际验证旧→新升级路径；CI 未设置该变量，因此 CI 的默认包门禁不证明 0.1.5→0.1.6 升级路径。本次已在本地用记录中的 0.1.5 归档（`c029b833…`）跑通该路径：0.1.5 状态无来源模式，升级后 `status` 报 `reinitRequired`、`sync`／`sources` 返回 `REINIT_REQUIRED`；显式重建为全部六个来源后，旧 rollup 行保留并按新来源生成合成 rollup。重建若触发新的 generation，`activate` 会清空并重建本地待传队列，并把这些 rollup 的 generation 更新为新值，因此“保留”指 rollup 与历史内容，不是旧代际或未确认上传任务。该结果只覆盖本机 Linux 合成来源，不代替 CI 或真实设备验收。`test:collector-evidence` 继续只读白名单对账；一次性OS任务、隔离PG/PostgREST/TLS和完整12CI门禁继续保留，合成或本地网关不冒充托管／真实来源／用户验收。

独立0.1.6包及源码映射见 `docs/evidence/token-onboarding/package.json`；0.1.0–0.1.5原包和旧分发目录保持。正式state仍由总控单写，先审新包再升级指定设备。实际设备／新扫描、获准HTTP／页面及四方对账、双设备、长期任务和桌面手机人工分别留证，不从旧队列上传成功推定新扫描成功；实际运行证据保存在受控私有文件，不公开真实用量、设备状态、回执hash或托管数据。#223／#205是否完成以总控的完整验收记录为准。
