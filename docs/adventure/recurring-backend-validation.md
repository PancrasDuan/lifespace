# #199 周期后端实施与隔离验证

工作区 `/home/lighthouse/orca/workspaces/lifespace/199-recurring-backend`，分支 `codex/199-recurring-backend`，唯一起始契约 `503eac4d20740976017b75dbf50eba7ae55d6e34`，共同 main 祖先 `7730a2f17ebe5fa6e191637c02429c24692ab84b`。业务依据为 `3a45dab` 的最终规格、R01–R54，以及本分支冻结契约、ADR0013/0014。分级为需确认变更，已获本地开发、验证和功能分支提交授权；没有执行生产 SQL、main 合并、部署或关闭 Issue。最终待审 SHA 由协调者收到的 Orca 评审请求固定，本文与实现一起提交。

## 实现与范围

- 新增 `adventure_recurring_tasks` 稳定父规则表，子身份复用任务，完成与撤销复用事件和奖励。保留 owner 复合 FK、RLS、service_role 专用 RPC、空 search_path 和 security invoker；子行及其发生时快照不可改写。
- 六个写命令和五个分页/详情读取严格遵循共享 schema；Worker 注入 owner，有界 JSON 请求/响应，不新增产品 UI 或修改组件/hooks。旧一次性列表、目标关系卡及一次性详情仍仅包含 once。
- 周/月/季/年边界从原始锚点常数次计算。当前期满足贡献差量写入，跨期旧贡献冻结，操作事件的 `recurringCounter` 保留计数审计；进度只读聚合，不新增逐期表。
- 每个有效子任务固定 +1 XP/+1行动；当天合法撤销只失效事件，子保留 completed 身份。父迁移不改旧子，原目标终态、父结束和跨日均锁定撤销。目标终态前检查所有未结束父，包括未来和满额项。
- 目标 progress 只算一次性，taskCount 加未结束父，目标 N 按事件的历史归属计算；统一日期列表/今日进度纳入有效子和逾期待办。旧一次性回归里仅更新一处 R44 改变的总数断言，未更改其任务列表/目标进度预期。
- `adventureClientVersion=recurring-1` 已按协调者确认切换；严格四字段 compatibility 与 `adventureReceiptModel=goal-categories-1` 保留。正式兼容测试移除了原来模拟未来写门禁的 mock，直接检验已激活门禁。

## 本机工具与隔离

Node 为 `/home/lighthouse/.nvm/versions/node/v24.22.1/bin/node`。每个 Node/npm/npx 命令均显式前置该目录 PATH。

本机原 PATH 没有 PostgreSQL/PostgREST。将已有工具复制到本工作区忽略目录 `.cache/recurring-tools`，补齐 initdb、pg_ctl、postgres、psql、pg_dump、pg_restore 包装入口；不修改系统或其他工作区。PostgreSQL 17.11 Debian 包 SHA-256 与本机 APT 元数据一致，并重新解包逐字节比较了 postgres/psql：

- `postgresql-17_17.11-0+deb13u1_amd64.deb`：`d2ce1ddffafa783f9acda4c92c86fc21e8288bff3782d739294f14fa797d7886`。
- `postgresql-client-17_17.11-0+deb13u1_amd64.deb`：`9d8558f8dd57c8e92e218a20698383575d53742ca3f9e7c2b7fe5f246d5216ae`。
- PostgREST 13.0.7，本机二进制 SHA-256：`036738687f9814a9db5f3d78afa6e614bcf20c66add04455e34ea494784db7b3`。

`tests/support/run-recurring-database.mjs` 每次在 `/tmp/lifespace-199-*` 新建 PG cluster，用随机 127.0.0.1 端口和独立 fresh/upgrade 数据库，结束关闭 PostgREST/PG 并删除本次目录；不读取 `.dev.vars`，清除继承的 PG/Supabase/Adventure 环境变量。Worker 的认证身份与 HTTPS→loopback 地址桥沿用已有测试 support，业务 RPC 均由真实 PostgREST/service_role 在真实 PostgreSQL 执行。认证桥不作为线上认证本身的验收。

工具可以通过 `POSTGRES_BIN` 和 `POSTGREST_BIN` 指向其他本机安装，但数据目录/端口仍由 runner 生成。缺工具、非零退出、空结果、失败或跳过均不能算通过。

## 可重跑验证与证据

```sh
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH node tests/support/run-recurring-database.mjs
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH npm run test:api -- --reporter=json --outputFile=.cache/recurring-api-report.json
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH npm run build
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH npm run test:security:portable
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH npm run check:secrets
```

真实 DB runner 覆盖：新库单事务安装与非空四表升级的函数/结构/索引/权限等价；旧行、快照、XP、revision、回执/hash 逐行对账；安装及升级注入失败全回滚；重复升级明确拒绝且无副作用。旧五表脚本只在第三个临时数据库生成真实退役命令回执，先迁到四表，再导入该账户事实验证本次升级，绝不作为新库或生产初始化路径。大额历史奖励 7 点及 focusGoal 退役封套都经正式 Worker 只读 lookup 恢复，旧写和 legacy-retry 仍拒绝。

11 组 SQL 验证覆盖锚点/年月末/长跳期、4/3/编辑/撤销差量、生命周期、父迁移和目标计奖、owner/RLS/授权/不可变快照、成功回执优先、实际并发上限和同 requestId 重放、历史冻结及审计和、真实账户锁等待的日界拒绝、XP/revision/日期溢出及写入故障回滚、全库子/事件身份与 XP/计数对账。

最初 10 组 SQL 与 24 项 HTTP 已退出 0、无跳过；随后增加历史奖励/退役回执、父分页、scope/search、4/5 口径及全库对账。最终统计如下：

| 检查 | 结果 |
| --- | --- |
| 最终真实 PG/RPC 与 Worker HTTP | 退出0：11组SQL、13文件98项HTTP通过，0失败/0跳过；包含周期及完整现有四表一次性回归 |
| 完整 API 测试 | 383 通过、0失败、218数据库相关跳过；这些跳过不计入真库通过 |
| 写版本/旧恢复受影响测试 | 4文件32项通过，无跳过 |
| 类型与构建 | `npm run build` 退出0（含 typecheck），Worker与客户端构建完成；产物仅在忽略目录 |
| 安全回归 | 单独复测退出0：4项通过、0失败/跳过，主安全报告7项全部通过；首次并行运行1项超时已复测闭环，两个故意失败的嵌套负例保持预期非零，未放宽检查 |
| 密钥扫描 | 退出0，208个可达历史提交与当前 Git 文件范围无命中；首次工具下载超时后复用 #198 已验证缓存，沙箱内 spawnSync git EPERM 后在沙箱外完成 |
| 差异检查 | `git diff --cached --check` 退出0 |

HTTP 明细写入忽略目录 `.cache/recurring-http-report.json`，纯 API 明细为 `.cache/recurring-api-report.json`。runner 检查实际 passed/failed/pending 数量，失败输出对应断言，不允许空跑成功。扩展一次性回归时补入原 runner 的合成回执损坏 fixture 和 reschedule failpoint，均只在临时库；为避免大量独立 HTTP suite 争用本机，固定两个 Vitest worker，不更改单测超时。

## 日界与真实锁等待

生产 `adventure_planning_command` 在拿到账户 FOR UPDATE 锁并查询旧成功回执后调用 `clock_timestamp()`，按 Asia/Shanghai 校验 command.today，再校验 revision。成功旧回执不受今天、版本或当前生命周期影响；新跨日写返回 PLANNING_DATE_CHANGED 且无成功回执/子/XP/revision 变化。

唯一测试时钟在 `tests/database/adventure-recurring.mjs` 的 `verifyRecurring` 内安装：从已安装的生产 command 用 `pg_get_functiondef` 复制为 `adventure_test_recurring_command`，只在该临时副本里将 clock_timestamp 替为读取临时库时钟表的函数。生产函数与迁移文件没有时钟参数、GUC 开关或测试 RPC；fresh 安装后明确断言 `adventure_test_%` 函数数量为 0。

日界用例使用两个独立 PG connection：一方锁定账户，另一方提交旧日期命令；第三方通过 pg_stat_activity 确认等待方 wait_event_type='Lock'，推进临时数据库测试时钟跨午夜，再释放真实账户锁。等待方收到 PLANNING_DATE_CHANGED，账户版本、事实及回执均未变化；另验证成功旧请求跨测试日期优先重放。这里是真实 PG 阻塞/锁顺序和可控服务端时间组合，不是等待现实北京时间午夜；不把它称为真实墙钟跨日验收。

## SQL 与发布门禁（只准备，不执行）

增量文件为 `db/adventure/migrations/20261115082114_recurring_tasks.sql`。用官方 Supabase CLI 3.1.0 的 `migration new recurring_tasks --workdir .cache/recurring-supabase` 生成文件名后移入仓库既有 db/adventure 结构。

新库仅使用生成的整份安装文件：

```sh
PATH=/home/lighthouse/.nvm/versions/node/v24.22.1/bin:$PATH node scripts/build-adventure-recurring-install.mjs .cache/adventure-recurring-install.sql
```

生成器把当前四表 schema、一次性列表和周期增量组合在唯一 BEGIN/COMMIT 中，剥除源脚本外层事务；不能逐段发送。增量本身也是一个完整事务，拿四表 ACCESS EXCLUSIVE 锁后一起执行结构、全部函数、权限和后置断言；错误全部回滚，重复执行以 RECURRING_ALREADY_INSTALLED 无副作用拒绝。

最终候选增量 SQL 为 **123835 字节**，SHA-256 为 `25eccb6b746ed08b2069c415869b579dd07395760229c32a206a8a9d0f5aaf17`；新库整份安装为 **220976 字节**，SHA-256 为 `99b7386d03d863c5246e73206fb39384da50580b36886d9b0c73af968c2cb60e`。隔离验收使用 node-postgres 单次传完整 SQL，已经验证完整安装及升级不会被截断。生产传输通道及上限尚未选定/核实，不推定 Supabase connector 可以传同样大小。应优先使用 psql/可完整传文件的单连接事务通道；不切断函数或事务，不采用先结构后函数分段。

1. 获具体发布授权后，先确认最终 SQL 摘要/体积、实际通道限额、维护窗口和兼容策略；门禁未满足不执行。
2. 停止新写/旧 Worker 流量，保存可完整恢复的备份：schema、全部数据、函数/触发器、RLS、索引/约束、角色及授权、扩展与迁移历史，记录 PG/扩展版本。用 pg_dump 自定义格式及必要 globals/权限配置，在隔离库完成 pg_restore 和逐表/函数/权限/奖励/回执对账；仅 JSON 数据导出不算完整备份。
3. 在停流窗口内单次执行整份增量事务，核验新表/复合关系、全部 RPC 签名、invoker/search_path/RLS/授权、旧数据/回执/hash/XP/revision、无旧主线/historical_lock 引用；保存阶段证据。提交前失败回滚；提交后尚无新写时可按已演练方案恢复全库。
4. 数据库门禁通过后部署对应 recurring-1 Worker 与 #200 前端同一集成提交，保持恢复探针和旧回执头不变；核验构建 SHA 与客户端、只读回执、目标阻塞、父子与奖励，再恢复流量。不得在新结构配旧函数/旧 Worker 的中间态恢复流量。
5. 有新周期写后不能简单回滚旧 Worker 或删表；须停流、备份新增事实，采用前向修复或经核实不丢事实的整体恢复。每阶段单独保存证据、回退点和决定；生产只读验收后才考虑关闭 Issue。

独立规范/需求双轴评审由 #56 协调者针对最终 SHA 执行，worker 自检不等于独立通过。#200/#201 的真实前端整合、原型/外围截图、浏览器 pending/日界交互、用户验收、PR/CI、生产备份演练/迁移/部署均不在本文声称已完成的范围。
