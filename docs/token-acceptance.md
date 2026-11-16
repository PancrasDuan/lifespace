# Token 阶段06验收执行单（#221 / #205）

阶段07真实生产设备接入使用[当前接入向导与对账说明](token-device-onboarding.md)；本文件继续保留阶段06的执行历史与验收范围。

**当前发布依据已更新：**用户2026-11-16授权“新的页面和数据可以直接部署到线上”，总控指定现有生产作为目标，并将纯新增Token迁移的备份门禁收敛为受影响对象/权限/迁移历史及现网版本基线。当前统一PR220、完整事务迁移、生产smoke/精确清理与回退按[生产发布执行单](token-production-release.md)执行；下文隔离环境/完整全库备份/无生产授权文字保留为先前准备阶段的历史，不再作为当前上线批准或密码前置。真实来源/长期timer/付费升级仍无新增授权。

本阶段从 `codex/219-token-integration@124e5f166da5bf961224d345be34e0fc1201fc42` 叠加，阶段 PR 目标仍为该分支；累计 main/merge-base 为 `3d4ecfad5518c405302a7827fa09dd9c6aff55eb`。总控负责最终统一集成，所有阶段 PR 保持未合并，#205 保持开放。

本阶段属于需确认变更的验收工作。已授权范围为代码/CI/文档准备、隔离合成验证和只读云发现；用户设备实际来源、用户长期任务、新云资源/费用、云写入、公开发布及生产动作分别需要明确目标和对应授权。已有“全部完成后统一合并”指示继续有效，不重复索取逐阶段合并批准。

## 证据边界

| 层级 | 本次入口 | 完成所需证据 | 当前状态 |
| --- | --- | --- | --- |
| Agent 本地检查 | 构建、类型、密钥、环境拒绝保护 | 最终 SHA 与实际输出 | 以阶段报告为准 |
| CI 合成操作系统 | `test:collector-scheduler` | Linux systemd user 和 macOS launchd 各自真实执行、回执和卸载 | 1154214的CI43792028331两平台通过；最后提交结果见PR |
| 原型/隔离 UI | 保留的 5193/5217/5220 | Agent 对照与用户桌面/手机操作分别记录 | 继承阶段05 Agent 检查；用户人工待验 |
| 托管 HTTPS/Auth | 指定隔离 Supabase + 独立 Worker | 真登录、设备码、独立设备头、持久回执、停用拒绝 | 无已批准隔离目标，待验 |
| 用户真实双设备 | 指定 macOS、Linux | 同一包、实际来源、固定范围四方对账 | 尚未指定目标，待验 |
| 用户长期任务 | 上述设备 | 明确同意后安装、观察周期、卸载 | 未授权/未执行 |
| 生产 | 最终累计 PR/部署 | 备份恢复、迁移、最终发布 SHA、线上验收 | 未执行 |

阶段05的 API465通过/241条件跳过、浏览器421通过/132条件跳过、真实数据库22通过及三轴结论只覆盖其原 SHA；新增 CI 以本阶段实际 run 为准。保留 `4606e40` 的日期焦点 CI 失败和 `124e5f1` 确定性红绿修复历史，不放宽原断言，不将 skip 或材料准备称为真实验收通过。

## 一次性 CI 操作系统门禁

`tests/support/token-collector-scheduler.mjs` 在任何文件创建/任务安装前要求 `GITHUB_ACTIONS=true`、`RUNNER_ENVIRONMENT=github-hosted`、`TOKEN_SCHEDULER_CI=disposable`。开发机、自托管 runner 和缺少明确 opt-in 均拒绝；不得在本机伪造这些环境变量。

Linux 使用独立 `collector_linux` 托管 job。先在一次性 runner 启动其真实 `user@UID.service`，检查 `/run/user/UID/bus` 和 user manager；没有总线则失败。macOS 在 `collector_macos` job 查询真实 `gui/UID` domain；不存在则失败，不自动改用其他 domain 或字符串比较。两者都是 `validate` 必需依赖，失败/取消/跳过均不能放行。

脚本在仓库外临时目录安装归档，安装和状态路径含空格、`%`、`$`；使用合成 Codex JSONL、独立0700/0600 SQLite 和数字 loopback 接收端。安装器来自安装包：先用已安装 CLI 生成计划，仅一致替换固定 label 为本轮 UUID 名称，然后调用包内原 `applySchedule`；不改变 ExecStart/ProgramArguments 或用户默认配置。

Linux 只给本轮唯一 timer 添加测试 drop-in，将首次等待压缩至1秒，不修改产品的小时级计划；首次上传必须由真实 timer 触发。macOS 使用原 RunAtLoad 首次执行。第二轮分别显式启动原 oneshot/kickstart，来源未新增时必须仅增加心跳，保持快照版本/hash、不再上传，并检查任务退出码及落盘回执。接收端验证白名单、实际内容指纹、12 Token、unknown 费用、`apikey` 和独立设备头，不接收 Bearer；它是受控合成端，不是托管 Supabase。

finally 对本轮名称卸载、停止可能仍运行的 oneshot、删除本轮文件/drop-in、reload 并验证不再加载；失败仍给出阶段/退出码/有限状态诊断。只保留 stdout 中的脱敏 JSON 证据，不上传状态、请求、原始日志或密钥。任何缺能力、超时或清理失败均使 job 红灯；实际执行前不得把本表标通过。

首轮候选 `0e95a9d` 的 CI43791577487 两个OS job均失败，保留为真实红灯：user bus/GUI domain和任务安装已可用，但新接收端将费用未报告的`actual`误断言为`null`。本地真实Tokscale最小合成扫描稳定复现后，测试改为严格核对`{currency:'USD',apiEstimate:null,coverage:'unknown'}`，产品契约未变。另修复Linux先删除/reload unit再stop造成误报的问题：先停本轮timer/service再卸载，缺席仅接受live manager确认not-found+inactive，主执行失败和清理失败分别保留。最终实际执行结果以最后SHA的CI为准，不能拿这次局部红绿当完整OS已通过。

## 只读发现（2026-11-16）

通过已有 Supabase 连接器发现唯一 `lifespace` 项目 `zvdcjzjfhkjasikchceo`，ACTIVE_HEALTHY、ap-southeast-1、PostgreSQL17.6.1.166，开发 branches 为0。只读迁移历史没有两项 Token 迁移；`BEGIN READ ONLY` 系统目录检查确认 `token_private` 不存在、public Token 函数数为0。未查业务行、用户、令牌或密钥。

追加只读组织/报价发现：该项目所属组织当前为Free，连接器`get_cost`分别返回新project为$0/月、新branch为$0.01344/小时。报价不是创建/写入授权，也不证明账户空余项目配额或branch可用；官方[计划表](https://supabase.com/pricing)明确Free不含Branching，Pro基础订阅$25/月，不能只报24小时branch计算费而隐去计划升级成本。未调用confirm_cost、create_project、create_branch或升级计划。

`pg_settings` 和 `pg_db_role_setting` 的 `pgrst.db_schemas` 均未返回设置。因此 **托管实际 exposed schemas 未知**，不能推断 public-only；后续必须取得 Dashboard / Management API 的 Data API 配置证据并排除 `token_private`。本次连接器没有提供该配置读取能力，也未为取配置读取密钥。

Cloudflare 连接器只读列出 `lifespace`、`token-monitor-hub` 两个现有 Worker；已绑定域名只有 `lifespace.onepeace.cc.cd` → lifespace/production。账号 workers.dev 子域为 `dpqkindle`，lifespace 的 workers.dev 和 preview URL 均关闭。`token-monitor-hub` 是现有应用，不能借用为测试目标；当前没有可认定获准写入/发布的隔离 Worker。GitHub 非生产自动预览仍关闭。

## 可审阅的隔离托管安排（尚未执行）

优先由用户指定已有独立测试project和HTTPS目标；如果没有，建议另行授权在当前组织新建空的Free project `lifespace-token-acceptance-221`（拟ap-southeast-1，先核实免费配额，报价$0/月且不允许自动付费升级），并新建独立 Worker `lifespace-token-acceptance-221`；拟用 `https://lifespace-token-acceptance-221.dpqkindle.workers.dev`，需核实名称及启用范围。先做合成托管链路，用户再决定是否上传真实设备汇总；拟验证窗口24小时，结束保存私有证据后按明确许可清理本轮资源。收费branch仅为用户另行选择并接受计划/用量成本后的替代方案。均不把当前生产项目当测试库、不合并branch回生产、不更改生产域名或现有服务。

1. **目标和预算门禁。** 总控取得确切组织/branch/project、Worker/HTTPS origin、可用时限、费用上限和测试用户。新project从空库开始；branch默认不带数据但继承部分服务配置，不能盲信其隔离了生产OAuth/SMTP/Webhooks。逐项核对，只开必要测试能力。独立 Worker 的 URL、Supabase URL、publishable/server secret、Auth callback/redirect/allowlist 和 hook 必须属于同一隔离环境；KV 等绑定也不能借用生产状态。生产 secrets 不复制到客户端或报告。
2. **备份/恢复门禁。** 在任何获准迁移前，使用目标专用安全连接配置（如私有 PGSERVICEFILE/PGPASSFILE，不把密码放 shell 参数）导出完整数据库 custom dump及所需角色定义；覆盖 schema、函数、数据、ACL/RLS、约束/索引和迁移历史，核对 Supabase 管理对象的可导出范围。角色口令另安全管理，Auth/Storage/服务配置和对象文件另列覆盖缺口。在另一个明确隔离恢复库 `pg_restore --exit-on-error` 实际恢复并核对定义/权限/合成事实，记录 SHA256；仅下载数据JSON或成功生成dump不算可恢复备份。当前只继承阶段05本地 harness 的完整数据库演练，未备份/恢复托管或生产。
3. **完整迁移门禁。** 先运行 `db/token/preflight.sql`，再按下表一次传输并执行每份完整事务；连接器传输上限必须覆盖35,342字节，不能切开函数。若工具不能保证完整传输，改用获准私有连接的 `psql -X --set ON_ERROR_STOP=1 --file <整份SQL>`，不用分段补丁。SQL已有BEGIN/COMMIT，无须额外外包事务；两份顺序执行，每份之后核对对象/ACL与迁移历史，再继续。使用原版本/名字保存完整已审查SQL及历史，不制造空历史条目或“结构先成功、函数稍后补”的中间态。

| 迁移 | 字节 | SHA256 |
| --- | ---: | --- |
| `db/token/migrations/20261115152721_token_backend.sql` | 35342 | `046a571de49b2422af072eab135d4a3b8a1149ac93c30fee7fb3a93299a6fd72` |
| `db/token/migrations/20261115172408_token_registration_inspection.sql` | 1218 | `b41b478f721bc21dd485234d458646942e6669df1dcf967bf0b451323a6e4a53` |

4. **权限和发布门禁。** 两个匿名RPC只有 upload/heartbeat；管理/summary只service_role，表位于不暴露的private schema且RLS启用，函数固定search_path。发布完整累计React+Worker固定SHA到上述独立目标，所有环境绑定审查通过后再启用测试流量。当前仓库生产配置不能直接用于该目标；准备独立配置后先给总控审阅。测试账号真实走托管Auth和白名单，不使用本地preview会话。
5. **HTTPS/凭据门禁。** 目标迁移后通过环境安全注入其publishable key运行 `TOKEN_GATEWAY_URL=<隔离HTTPS源> node scripts/token-gateway-preflight.mjs`；OPTIONS及无效凭据拒绝必须通过，但它不能证明有效设备头链路。再实际 start→登录确认→claim→sync，检查 `apikey`、`X-LifeSpace-Device-Token` 直达HTTPS RPC、不将apikey放Bearer、不重定向；独立头丢失/错误必须拒绝，持久回执严格匹配代际/版本/hash；没有新内容也有心跳。网页注销/非白名单、跨设备令牌、停用旧令牌均实际拒绝，历史保留。报告只写状态码、固定错误码和范围内汇总，不输出真实请求头/令牌。
6. **回退/收尾门禁。** 先停用本轮测试设备和入口；停止本轮任务、撤回独立Worker路由/发布，保留必要诊断和私有状态。需阻止仍可直传的令牌时必须停用/撤销两匿名RPC执行权，单撤网页不够。测试branch按授权导出必要证据后删除或暂停并核对计费停止；不删除其他资源。生产未来回退优先旧Worker/React+保留Token表，整库恢复会覆盖同期其他业务写入，须另行止写与授权。

费用依据2026-11-16官方[Branching billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching)：Micro计算起价$0.01344/小时，24小时约$0.32256仅计算费，另有磁盘/出口等用量；branch不受Spend Cap保护。此估算不构成收费许可，实际账号计划、配额、Cloudflare请求/绑定和Auth邮件费用先核实，不自动升级计划或启用PITR/付费备份。相关规则见[branch隔离及配置](https://supabase.com/docs/guides/deployment/branching)、[备份边界](https://supabase.com/docs/guides/platform/backups)、[Data API权限](https://supabase.com/docs/guides/api/securing-your-api)。

## 两台用户设备：同一归档执行单（待指定实际目标）

每台分别记录设备别名、OS/架构、Node24版本、Codex/Tokscale版本、验收操作者与时间，私有绝对路径只留本机。两台都用最终同一归档 `@lifespace/token-collector@0.1.0`，SHA256 `557c6b47f52b0acd556c2a7cff91bbd39712f7f5a446b53988a351a4cad54712`；本阶段不改变采集器发行源码，阶段05归档位于其 `test-results/token219/`。安装不是完整离线镜像，npm需要下载固定runtime依赖；不全局安装。

以下变量是操作者在**已指定设备**本机填写的绝对路径或已批准测试origin，不是自动执行脚本。不得直接用生产origin或隐式扫描当前Agent主机：

```sh
umask 077
archive='/absolute/lifespace-token-collector-0.1.0.tgz'
install='/absolute/private/collector install'
state='/absolute/private/collector state'
source_home='/absolute/explicitly-approved-source-home'
server='https://approved-isolated-worker.example'
# macOS: shasum -a 256 "$archive"；Linux: sha256sum "$archive"
npm install --prefix "$install" --ignore-scripts --no-audit --no-fund --save-exact "$archive"
collector="$install/node_modules/.bin/lifespace-usage"
"$collector" --help
```

1. **备份。** 若已有状态，先核对该设备现有timer/活跃sync；仅在获准后停自己的timer并等sync退出，将整个私有state目录 `cp -pR` 到新建的0700加密/离线备份位置，保持0600文件，备份含凭据不能上传。不要复制到另一台设备，也不要仅复制最新汇总。无旧状态记录“无旧状态”，不凭空造恢复结论；恢复演练只在原设备、停任务且保留现状备份后进行，目标generation发生变化则重新浏览器批准，旧备份不是续权手段。
2. **明确来源/注册。** `"$collector" init --state-dir "$state" --source-home "$source_home" --server "$server"`。该命令只建立私有配置、读取系统标识用于内存派生并登记，不扫描来源内容；操作者核对短码、平台和hostname后，在真实网页 `/token/devices/confirm` 明确批准，再 `"$collector" authorize --wait --state-dir "$state"`。真实来源扫描必须由设备操作者确认后才继续。
3. **只读本地扫描。** `"$collector" sync --offline --state-dir "$state"`，再 `status`。来源只读，应用私有目录会写SQLite和Tokscale缓存。记录scanFailed/retainedDates/diagnostics/pending；按[ADR0020](adr/0020-token-recorded-usage-authority.md)接受Tokscale有效已记录用量，warning只留脱敏类别；真正失败或输出无效不进入“通过”，旧日期缺席保留而不补零。不得上传JSONL正文、源路径、完整状态库或原始系统ID。
4. **固定范围。** 先在两设备冻结验收范围：同一个已完成的北京日期 `D`（00:00:00–次日00:00:00 Asia/Shanghai）、Agent=`codex`、模型M（同一modelKey；unknown为null）、分别设备A/B及合计A+B。不得拿“当前本周”与固定D比较。暂停在D追加日志，记录价格/统计版本；实际Tokscale以应用同一私有config和同一D调用，原始graph只留本机。对比本地最新snapshot、直传回执、托管summary与页面四方的input/output/total/cacheRead/cacheWrite/reasoning、费用分类和模型coverage，`null`/unknown/缺失与0分开；cacheRead是input子集，不额外相加。
5. **托管直传与重扫。** `"$collector" sync --state-dir "$state"`，待pending=0且heartbeat=persisted；页面同D/Agent/M/设备筛选核对。本机只读SQLite可查询rollups.snapshot中的metrics/cost/models及version/hash，排除meta/credential/sources；只提交上述白名单统计。连续 `sync`、`sync --rescan` 后同范围总量不重复、未知费用不补零，记录版本/hash及页面值。
6. **离线恢复。** 在指定测试设备断开到测试服务的网络，运行一次正常sync模拟请求失败（不篡改真实日志、不删除队列）；记录固定网络错误与原待传版本/hash，网络恢复后按status退避等待再sync，严格匹配回执后清队列，页面不重复。仅 `--offline` 证明离线扫描，不能代替实际网络失败/回执重试。没有新增内容时仍更新心跳，不产生新主版本。
7. **停用/重绑。** 网页明确停用本测试设备，sync必须拒绝凭据且历史可查；同一state执行 `init --replace --server "$server"`，保留原source-home，核对网页“替换”确认后authorize/sync。记录新代际、旧凭据拒绝和历史保留，不记录凭据值。需要试日志继承/fork/归档时，由操作者提供其真实客户端已生成样本并记录客户端版本及预期；无样本就保留待验，不拿合成样本冒充。
8. **用户任务另行同意。** 先 `timer install --hours 1 --state-dir "$state"` 查看计划，检查是否存在同名 `com.lifespace.token-collector` 系统任务；已有任务须先做配置备份并明确如何恢复，不覆盖别的状态目录。操作者确认该设备和运行周期后才加 `--apply`。Linux查看`systemctl --user status com.lifespace.token-collector.timer`；macOS查看`launchctl print gui/$(id -u)/com.lifespace.token-collector`。一次手动触发与完整观察周期分别记录，不默认enable linger或创建永久计划。结束 `timer uninstall --state-dir "$state" --apply`，确认OS不再加载和不再运行；Linux若oneshot仍运行，仅停止本任务的service。最后移除独立install前先核对绝对路径；保留state/备份，撤销上传凭据需要网页停用，卸载不会自动撤权。

每个步骤的记录格式：`设备别名 | 包SHA | 代码SHA | 环境/目标别名 | D/Agent/M/设备范围 | 实际动作 | 预期 | 实际白名单指标/错误码 | PASS/FAIL/未执行 | 证据位置`。用户真实双设备、托管、长期timer三项分别签认，不互相代替。

## 桌面和手机最小人工验收

保留的原型入口为 `http://127.0.0.1:5193/prototype-token-usage-v2/`；正式合成隔离预览先访问 `http://127.0.0.1:5220/__token219/session` 再进 `/token`。5217是阶段04保留预览，不随意重启、重置数据或改collector；5220也只做页面检查，不执行其sync/停用/重绑。该session入口仅本地harness，不能用于托管Auth验收。前置图和原型依据继续见 [统一集成](token-integration.md)，不重开视觉设计。

桌面先选固定日期/Agent/设备/模型，对照总量、趋势、Token/费用、模型选择恢复；再看本周/本月、日统计展开、年度平面日历悬停/键盘/Escape、同步状态。手机在390/320px或实际设备轻触日历、弹层内阅读和关闭、日期筛选、导航与日明细，核对无横向溢出、遮挡或失焦。截图只留汇总，隐藏账户/设备隐私。

真实手机无法直接访问本机127.0.0.1；先由用户在其桌面浏览器验收上述隔离入口。实际手机待已授权独立HTTPS测试origin，用相同筛选完成触屏和真实登录确认；浏览器窄视口检查只记Agent检查。用户人工结果逐条登记，通过前保持待验，不因“页面可打开”自动签收。
