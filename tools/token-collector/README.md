# LifeSpace 本地采集器

Node **>=24.22.1 <25**，macOS/Linux；`@tokscale/cli@4.23.0` 与 `zod@4.6.7` 是精确 runtime dependencies，随包安装。使用 `npm install --prefix /absolute/installation /absolute/lifespace-token-collector-0.1.4.tgz` 安装本阶段构建的包，通过 `/absolute/installation/node_modules/.bin/lifespace-usage` 执行。无需单独安装 Tokscale；不要使用 `--omit=optional`，其平台二进制由 optional dependency 提供。本阶段不发布 npm，不全局安装。

0.1.3 起按用户在 #223 确认的职责接受 Tokscale 的有效已记录用量，移除采集器自己的逐日志来源审计和告警冻结。0.1.4 修复上游费用按不同顺序累加产生的 f64 残差被误判为费用不一致：仅费用聚合校验使用 `max(1e-12 USD, 1e-12 × max(总额, 分项和))` 误差预算，分别为万亿分之一美元和万亿分之一相对误差；模型数不能代表上游事件累加次数。零与正数、明显超差、负数、NaN、Infinity 和累加溢出仍拒绝。Token 整数对账、上游模型金额的十进制展开、精确金额字符串合计与规范化 SHA 均不使用容差，不四舍五入或重新计价。

固定稳定 Node24.22.1 基线继续在打开状态前检查，不扩展运行时支持范围。0.1.0–0.1.3 归档和旧分发目录保留；旧压缩前缀证明的实现／测试属于已取代策略，新包不再包含这些代码。升级不改变 SQLite schema，身份、旧汇总、未确认请求和旧 sources 表保留。

```sh
lifespace-usage init --server https://your-lifespace.example
lifespace-usage authorize --wait
lifespace-usage sync
lifespace-usage status
lifespace-usage sync --rescan
lifespace-usage sync --offline
lifespace-usage prices refresh
lifespace-usage timer install --hours 3
lifespace-usage timer install --hours 3 --apply
lifespace-usage timer status
lifespace-usage timer uninstall --apply
lifespace-usage upgrade --archive /absolute/next-release.tgz --prefix /absolute/installation
```

`init` 输出网址和短码后退出；在网页批准后执行 `authorize`。重复执行 `authorize` 继续已经落盘的领取请求；`--wait` 遵守 5 秒轮询、slow_down 后 10 秒等待及 10 分钟到期。丢失 start 响应、拒绝、到期、停用或本地凭据遗失时，用 `init --replace` 重新登记并在浏览器明确批准重绑；不能用 deviceId 恢复权限。正式网页确认页已上线；只有正常获准网页登录批准才能领取，测试API不代替真实批准。

默认来源为本机 home，可通过首次 `init --source-home /absolute/home` 指定另一份包含 `.codex` 的 home；同一状态库不能改变来源或服务器，以免混合两份历史。来源格式、活动／归档／备份／压缩及 headless roots 由固定 Tokscale 和该 home 的 scanner 配置负责，采集器不另扫原始日志。只在已指定的真实来源范围执行。`--test-loopback` 仅供隔离测试的数字 loopback HTTP，不接受 localhost、任意 HTTP 或重定向。

默认状态目录为 Linux `~/.local/share/lifespace-token`、macOS `~/Library/Application Support/LifeSpace/token`；所有命令可传相同 `--state-dir /absolute/private/directory`。目录 0700，SQLite/凭据/缓存文件 0600；发现已有不安全权限、硬链接、符号链接会拒绝操作。不要把状态目录放入公共同步盘或手工删除队列。状态输出只给日期、数量与固定诊断码，不输出凭据、来源路径或正文。

`sync` 首次全量，后续复用 Tokscale 文件解析缓存。`--rescan` 清除应用私有的上游解析缓存，重新统计，保留价格缓存、身份和未确认请求。普通运行每天最多尝试一次官方价格更新，`prices refresh` 可主动更新；`--offline` 禁止价格下载及上传。离线没有价格仍保存 token 与 unknown 费用，不伪造零价格。API 等价估算始终为 unverified，不能当成实际订阅账单。

Tokscale 成功退出且版本、时区、JSON 结构、数值及日期／模型／总量对账均有效时，接受它的已记录统计；更正可增可减或移除模型。missing-usage、价格告警及未知 stderr 仅记为 `TOKSCALE_MISSING_USAGE`、`TOKSCALE_PRICING_WARNING`、`TOKSCALE_DIAGNOSTIC` 等本地固定类别，不输出原文、不阻断有效结果。Tokscale 失败／超时或结果无效时不替换旧汇总或分配新请求。新 graph 缺席的旧日期保留，并在 CLI/status 的 `retainedDates` 与 `GRAPH_DAY_ABSENT` 中说明；不制造 0 或清空。未记录消费不能从正文、消息数量或价格推算恢复，也不把未知补零。

SQLite 持有进程运行锁，无超时抢锁；已有活进程返回 `COLLECTOR_BUSY`，崩溃由 OS/SQLite 自动释放。上传失败持久保存原始快照，5 秒起、最多 1 小时退避；同主键的新版本等旧任务确认后才发送，其他主键可继续。每次最多处理 100 项，首次失败停止此轮队列，再发独立心跳。`status` 的 pending/errors 给出积压与固定分类。`TOKEN_CREDENTIAL_INVALID`/`CREDENTIAL_REJECTED` 需要重新批准授权，`TOKEN_VERSION_CONFLICT`/`TOKEN_STALE_VERSION` 保留任务，先检查是否复制过状态库；必要时重新浏览器批准新代际，不能删 SQLite 后凭旧 ID 续权。

定时默认 1 小时，支持 1/3/6/8/12/24。`timer install/uninstall` 默认只打印计划，`--apply` 才写用户级 systemd/launchd 并调用管理命令；实际执行路径包含 Node 和已安装 CLI 的绝对路径，凭据不在单元/env/参数里。Linux 需要可用的 user systemd，注销后持续运行取决于主机用户管理策略。`timer status` 展示本机记录与模板，OS 实际启用情况仍以 `systemctl --user status com.lifespace.token-collector.timer` / `launchctl print gui/$(id -u)/com.lifespace.token-collector` 核对。升级后用新 CLI 的同一 `--state-dir` 重装 timer。

升级只接受本地明确指定的发行 `.tgz` 与安装 prefix，默认展示命令，加 `--apply` 执行本地 npm 安装（不运行 lifecycle scripts、不操作状态数据库）。不在同步时拉取 latest。发行维护者固定上游版本后跑统计输出、持久化、实际链路和包安装门禁，再发布下一份采集器；用户安装新包之前可备份私有状态目录。代码回退可重装原包并恢复 timer；不删除 SQLite、设备身份或未确认任务。

已有0.1.3安装可用同一CLI的 `upgrade --archive /absolute/lifespace-token-collector-0.1.4.tgz --prefix /absolute/installation --apply`，保持原 `--state-dir`，无需为软件升级重新批准正常有效凭据。升级后先手动同步并核对 `scanFailed=false`、实际回执与最终价格／hash／版本，再安装或恢复已获准的timer。旧队列可能在新扫描失败时仍成功上传，因此 `uploaded>0`／`pending=0` 不单独证明最新扫描成功。

Linux 合成来源、实际 SQLite/Tokscale、隔离 TLS/Worker/PostgREST/PostgreSQL 与仓库外安装由本阶段测试覆盖；macOS ioreg/launchd、用户真实来源、真实双设备和托管 Supabase HTTPS 网关仍需要最终集成验收。
