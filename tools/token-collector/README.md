# LifeSpace 本地采集器

Node **>=24.22.1 <25**，macOS/Linux；`@tokscale/cli@4.23.0` 与 `zod@4.6.7` 是精确 runtime dependencies，随包安装。使用 `npm install --prefix /absolute/installation /absolute/lifespace-token-collector-0.1.2.tgz` 安装本阶段构建的包，通过 `/absolute/installation/node_modules/.bin/lifespace-usage` 执行。无需单独安装 Tokscale；不要使用 `--omit=optional`，其平台二进制由 optional dependency 提供。本阶段不发布 npm，不全局安装。

0.1.2 保留 0.1.1 对 `.zst` 追加来源前缀校验提前退出时未处理异步错误的修复，仍只读取需要的前缀并等待内部流关闭。CLI 打开状态和 inventory 读取来源前要求已实测的稳定 Node24.22.1 基线。[Node24.20.0 发布说明](https://nodejs.org/en/blog/release/v24.20.0)记录初次截断修复 `0ee91ead8b / nodejs/node#64593`，但实测24.20原生解码器仍可能静默接受完整首帧后接截断帧，不能仅凭该修复认定安全；24.22.1已通过单帧、拼接后截断和实际文件覆盖回归，因此最低与仓库CI均固定到24.22.1，不宣称它是最早修复补丁。真实读取/解码失败继续保护既有统计，不改变统计契约或 SQLite schema。0.1.0 和 0.1.1 归档保留为历史材料，新接入使用独立的 0.1.2 归档及其校验值。

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

`init` 输出网址和短码后退出；在网页批准后执行 `authorize`。重复执行 `authorize` 继续已经落盘的领取请求；`--wait` 遵守 5 秒轮询、slow_down 后 10 秒等待及 10 分钟到期。丢失 start 响应、拒绝、到期、停用或本地凭据遗失时，用 `init --replace` 重新登记并在浏览器明确批准重绑；不能用 deviceId 恢复权限。正式网页确认页在下一阶段交付，本阶段验证的是实际 Worker/DB API。

默认来源为本机 home，可通过首次 `init --source-home /absolute/home` 指定另一份包含 `.codex` 的 home；同一状态库不能改变来源或服务器，以免混合两份历史。支持活动、归档、上游支持的 `.jsonl.*` 备份及 `.zst`，以及两个默认 Tokscale headless/codex 目录。自定义 extraScanPaths、来源符号链接、无有效日期的损坏行暂不放行统计替换。`--test-loopback` 仅供隔离测试的数字 loopback HTTP，不接受 localhost、任意 HTTP 或重定向。

默认状态目录为 Linux `~/.local/share/lifespace-token`、macOS `~/Library/Application Support/LifeSpace/token`；所有命令可传相同 `--state-dir /absolute/private/directory`。目录 0700，SQLite/凭据/缓存文件 0600；发现已有不安全权限、硬链接、符号链接会拒绝操作。不要把状态目录放入公共同步盘或手工删除队列。状态输出只给日期、数量与固定诊断码，不输出凭据、来源路径或正文。

`sync` 首次全量，后续复用 Tokscale 文件解析缓存；覆盖校验仍对可读文件流式摘要。`--rescan` 清除应用私有的上游解析缓存，重新扫描全部可读历史，保留价格缓存、身份和未确认请求。普通运行每天最多尝试一次官方价格更新，`prices refresh` 可主动更新；`--offline` 禁止价格下载及上传。离线没有价格仍保存 token 与 unknown 费用，不伪造零价格。API 等价估算始终为 unverified，不能当成实际订阅账单。

来源丢失/截断/非追加改写时，受影响日期保持最后可信值；新增其他完整日期继续推进。即使当前总量更大，也不会越过覆盖保护。文件原始内容恢复、或完整副本移到上游可扫描的归档目录后，再 `sync --rescan`。不完整末行应等来源程序写完，损坏来源应从自己的备份恢复；无法恢复时保留历史与诊断，不能仅凭最新汇总重建来源。没有“忽略缺失强制覆盖”开关。未知范围、损坏行或未分类上游诊断会保守保护全部已知日期。单行最多 16 MiB、单文件解压后最多 512 MiB，超限记录未确认扫描，不上传不完整替换。

SQLite 持有进程运行锁，无超时抢锁；已有活进程返回 `COLLECTOR_BUSY`，崩溃由 OS/SQLite 自动释放。上传失败持久保存原始快照，5 秒起、最多 1 小时退避；同主键的新版本等旧任务确认后才发送，其他主键可继续。每次最多处理 100 项，首次失败停止此轮队列，再发独立心跳。`status` 的 pending/errors 给出积压与固定分类。`TOKEN_CREDENTIAL_INVALID`/`CREDENTIAL_REJECTED` 需要重新批准授权，`TOKEN_VERSION_CONFLICT`/`TOKEN_STALE_VERSION` 保留任务，先检查是否复制过状态库；必要时重新浏览器批准新代际，不能删 SQLite 后凭旧 ID 续权。

定时默认 1 小时，支持 1/3/6/8/12/24。`timer install/uninstall` 默认只打印计划，`--apply` 才写用户级 systemd/launchd 并调用管理命令；实际执行路径包含 Node 和已安装 CLI 的绝对路径，凭据不在单元/env/参数里。Linux 需要可用的 user systemd，注销后持续运行取决于主机用户管理策略。`timer status` 展示本机记录与模板，OS 实际启用情况仍以 `systemctl --user status com.lifespace.token-collector.timer` / `launchctl print gui/$(id -u)/com.lifespace.token-collector` 核对。升级后用新 CLI 的同一 `--state-dir` 重装 timer。

升级只接受本地明确指定的发行 `.tgz` 与安装 prefix，默认展示命令，加 `--apply` 执行本地 npm 安装（不运行 lifecycle scripts、不操作状态数据库）。不在同步时拉取 latest。发行维护者先核对官方最新稳定 Tokscale，固定版本后跑统计、覆盖、持久化、实际链路和包安装门禁，再发布下一份采集器；用户安装新包之前可备份私有状态目录。代码回退可重装原包并恢复 timer；不删除 SQLite、设备身份或未确认任务。

Linux 合成来源、实际 SQLite/Tokscale、隔离 TLS/Worker/PostgREST/PostgreSQL 与仓库外安装由本阶段测试覆盖；macOS ioreg/launchd、用户真实来源、真实双设备和托管 Supabase HTTPS 网关仍需要最终集成验收。
