# Token 采集器协议（阶段 03）

> 本文保留阶段范围与当时验证；累计实现、已收敛结论及独立验收门禁见 [统一集成验收](token-integration.md)。

对应 #213 / #205，依赖 #209 / PR #212，起点与阶段 PR base 均为 `codex/209-token-backend` 的 `04566322ea0a200c2886ea93fd242e2b0be1bb66`；启动时 fetch 的 main 是 `6c218846e8920dd99cae4ef6685d9d2ad19e5944`。新增代码在 `tools/token-collector/`，使用同目录独立 manifest/lockfile/构建，正式统计与上传 schema 继续复用 `src/shared/`。本地持久化/授权/系统任务属需确认分级；本地实现、隔离验证、提交、评审和阶段 PR 已授权，阶段 PR 保留未合并；生产、真实凭据、npm 发布及真实 timer 未执行。

安装、命令与恢复操作见 [包说明](../tools/token-collector/README.md)，决策见 [ADR 0018](adr/0018-token-source-coverage-and-local-queue.md)。不新增 Web/Worker 页面，不改变浏览器/API 的既有鉴权和后端协议。

## 本地数据与恢复

`state.sqlite` 的 meta 保存配置、授权请求/凭据及有界最新诊断；rollups 每日期/Agent 保存唯一最新内容、generation、version/hash；queue 保留每份不可变上传 JSON、对应主键/代际/版本/hash、重试次数/下次时间及固定错误码；sources 只保存来源路径、完整逻辑内容 SHA-256、长度、涉及日期。所有数据仅在应用私有目录，权限校验含 SQLite journal 与 Tokscale 缓存，不输出原始路径、请求、stderr 或系统 ID。原始硬件标识只用于内存派生，hostname 不参与。

扫描完成后在一个事务中分配版本、写最新统计/待传请求、保存来源证明与扫描诊断。hash 与**最近分配内容**比较，相同不产生新版本；存在其他内容在途时 A→B→A 分配新版本。ack 只删除严格匹配 device/date/agent/generation/version/hash 且 persisted=true 的那份任务；旧回执或不完整回执无权清任务。重试沿用逐字相同 body。中途失败回滚，HTTP 回执丢失后重启仍可重复原请求取得 duplicate 回执。

offline 未授权扫描可保存最新内容（generation=0，仅本地，不发请求）；成功领取新代际后从版本 1 排队最新值。领取请求与下次轮询先持久化，成功响应与代际队列重建在同一事务。窗口内重复领取恢复同一令牌；窗口外、本地状态丢失、令牌停用或需重绑时再次浏览器批准。被明确新代际取代的旧队列才会移除，普通网络/冲突/凭据失败都保留。设备身份不能恢复权限，复制状态库不受支持。

`run.sqlite` 的独立 `BEGIN IMMEDIATE` 覆盖一次整个运行；不使用 wall-clock lease 或删除 PID 文件。活进程一直互斥，SIGKILL 后事务锁释放，state 中未提交写入回滚。每次请求 10 秒，响应最多 64 KiB；拒绝重定向。请求失败后持久化 5 秒指数退避（最多 1 小时），本次停下队列；下次执行继续。心跳独立、无新增也发送、无主版本。状态只在本机保存失败诊断，不伪造远程连续失败次数。

## 覆盖和价格证据

固定上游 [scanner](https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/scanner.rs) 默认 Codex roots、`.jsonl*`（排除 sidecar/checkpoint）和 zstd 形式与本地清单一致。扫描前后两份清单核对源字节、文件inode/ctime/mtime及全部扫描目录/祖先目录状态；即使移出后恢复相同内容，也不沿用发生过变化的目录证明。追加须保持已保存完整前缀；移动/归档可由另一完整内容副本或包含旧完整前缀的来源证明。日期覆盖还包括上游用于归属恢复回合的 `task_started.started_at` Unix秒，不仅是外层 timestamp；证明有独立coverageVersion，缺失旧版未知范围时保守保护全部日期。只检查来源时间与格式，不解释 counters、fork 或费用；实际统计/去重全部来自固定 CLI。

文件删除、截断、改写不会更新旧证明，受影响日期保持最新可信结果；新增日志再大也不放行该日期，未受影响日期继续。损坏/未完成行没有可靠日期范围，故全部已知日期暂缓；读失败/未知上游 stderr 同样保护。恢复原来源后再重扫。完全缺失的 graph 日不制造零快照，保留历史并记 GRAPH_DAY_ABSENT。规则/价格修正时来源仍完整可正常减少数值、移除模型，不因总量下降一律冻结。

官方 [pricing refresh 实现](https://github.com/junhoyeo/tokscale/blob/5569a0397b52c6c445e346814747a772fc3c0a11/crates/tokscale-core/src/pricing/refresh.rs) 仅下载公开 LiteLLM/OpenRouter/models.dev catalogs，失败来源保留旧缓存。采集器传独立 TOKSCALE_CONFIG_DIR 和干净环境，首次/每天及手动调用；实际 graph 始终 offline，不向上游提交本地内容或令牌。priceVersion 是取得的 catalog data 逻辑内容摘要（排除更新时间），没有缓存则 null，不能当作历史价格时间序列或工具版本。来自固定版本的唯一已知“partial/unpriced/stale pricing”警告保留为价格诊断，其他 stderr 作为来源完整性未证实。unknown 不补零，estimated 保持 unverified。

## 验证和最终门禁

`npm run test:api` 包含文件 SQLite/Tokscale/模板测试；`POSTGRES_BIN=... POSTGREST_BIN=... npm run test:token-database` 必须建立独立 PG/PostgREST，实跑 Worker 授权与独立设备头直传，不能用环境跳过代替该门禁。TLS 网关使用本次临时生成的受信任测试证书，在 TCP connector 将标准 HTTPS loopback 地址路由到随机端口；API 请求真实经过 TLS/HTTP/PostgREST/SQL，未 mock fetch，也未放松生产 URL 校验。测试网关只模拟托管 apikey→PostgREST role 和 Auth user，不能替代托管 Supabase 网关或真实网页登录。

`npm run test:collector-package` 在 `/tmp` 的独立目录实际 npm pack/install、只从安装包运行 CLI、真实扫描并保留队列、实际本地升级同包验证 SQLite 不变；不依赖 repo devDependencies/绝对路径。包白名单只含 CLI JS、两份 shared schema、manifest 和说明。该门禁随 token_database 纳入 validate，不上传构建/测试 artifacts。额外 `npm run test:collector-pricing` 在线探针实跑公开目录初始化/再次更新与真实CLI计价，区分外部源暂时失败及未知/部分刷新。

最终仍需真实 macOS ioreg/launchd、Linux 用户 systemd 实际启用、用户真实来源/客户端版本、双设备独立对账、正式确认页/看板原型对照、托管 gateway 和生产发布验收。这里仅实际运行合成数据与临时目录，timer 使用模板及替身；没有安装或启用本机真实任务。代码回退重装已验证旧包并保留私有状态；若未来 schema 升级不兼容需显式迁移/备份，本版本不自动删除数据。
