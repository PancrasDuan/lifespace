# #201 周期任务集成验收

父规格 [#56](https://github.com/PancrasDuan/lifespace/issues/56)，集成任务 [#201](https://github.com/PancrasDuan/lifespace/issues/201)。本次是**需确认的变更**：核心生命周期、奖励、公开契约、持久化升级。授权覆盖本地集成、开发、隔离验证、提交及 PR 准备；远端推送、PR/CI 由主会话处理，未合并 main、操作生产数据库、部署或关闭票。

## 固定输入和改动

| 输入 | SHA |
| --- | --- |
| 共同契约 #198 | `503eac4d20740976017b75dbf50eba7ae55d6e34` |
| 后端 #199 | `da835b52ad7f8b3d3b29d8fcecbcf603f28c2845` |
| 前端 #200 | `132e1bf68414d197b077dacc9cd9d6739a97988c` |
| 成功 fetch 的 origin/main / merge-base | `7730a2f17ebe5fa6e191637c02429c24692ab84b` |
| 两端合并提交 | `788b1820984804c21d2498a6bd473c7fba5077bd` |

工作区 `/home/lighthouse/orca/workspaces/lifespace/201-recurring-integration`，分支 `codex/201-recurring-integration`。从固定后端起步，使用 `git merge --no-ff` 合并固定前端，两个父提交如上；无冲突、无共享契约变更、无集成期间产品逻辑或样式修改，没有合入讨论分支原型源码。后续只新增本地真库浏览器验收、恢复对账、隔离预览及证据；原 fixture 捕获增加可配置输出目录。

最终待审 SHA 由主会话的 Orca 固定评审回执标识；本报告随集成提交保存。两端前置独立复审分别见 [#198](https://github.com/PancrasDuan/lifespace/issues/198#issuecomment-6891486930)、[#199](https://github.com/PancrasDuan/lifespace/issues/199#issuecomment-6892223705)、[#200](https://github.com/PancrasDuan/lifespace/issues/200#issuecomment-6892345814)。这些结论不能代替本次组合的独立双轴评审。

## 实际链路与环境边界

浏览器业务请求由已有 `planning-database-browser.ts` 身份桥转入生产 `worker/index` 的 Hono `app.request`，再通过真实 HTTP PostgREST 13.0.7 / service_role 调用全新 PostgreSQL 17.11 的生产 RPC。浏览器没有业务成功 fixture，数据库没有复用其他 worker 的旧目录或生产数据。该路径覆盖正式前端、Worker 路由/验证/响应、实际 RPC、锁和事务；**业务 Worker 在 Node 桥内执行，不是 workerd 网络部署**。Vite/workerd 负责测试页面服务，不把它写成业务请求经 workerd；线上 Supabase Auth 没有验收。

Node 为用户级 v24.22.1，所有 Node/npm 命令显式前置对应 PATH。复用 #199 已核验的工具二进制，仅复用程序，不复用数据库。PostgREST SHA256 `036738687f9814a9db5f3d78afa6e614bcf20c66add04455e34ea494784db7b3`；postgres `6468a969338215cb3912cf9c0b894bdbbd37b9a709926db078e9a5bf8bdc3e16`；psql `3c94c29652ea7ff8803ab1ca35e48c38a39c8a94a8c8eeadbb1d87c68494506c`。来源与 Debian 包校验见后端 validation。浏览器使用本机 Chromium `156.0.8078.47`，Playwright `1.63.0`。

runner 新建 `/tmp/lifespace-recurring-*` cluster、随机 loopback 端口和 fresh/upgrade/restored 数据库；结束关闭服务并删除数据目录。继承的 PG/Supabase/Adventure 环境变量被过滤。setup 复制的 `.dev.vars` 先移入忽略的 `.cache/setup-original.dev.vars` 保留；当前 `.dev.vars` 仅含虚构测试值，不连接生产。截图、提交及报告不含凭据。

## 本地检查结果

| 检查 | 实际结果 |
| --- | --- |
| 原子新库、非空四表升级 | 通过；函数/结构/索引/权限等价，全部旧行/快照/历史7点奖励/XP/revision/回执/hash对账，安装与升级注入失败全回滚，重复升级无副作用拒绝 |
| 首次账户并发读取 | 15 个生产 RPC，20 个 owner，600 次并发读取，无混合版本/失败/跳过；读不创建账户或改 revision |
| SQL | 11 组通过，无跳过；锚点、闰日、长跳期、历史冻结/审计和、真实并发上限/重放/异摘要、owner/RLS/RPC、溢出和故障回滚 |
| 真实 Worker → HTTP RPC | 13 文件 99 项通过，0失败/0跳过，包含现有一次性全回归及旧页面恢复 |
| 真实数据库浏览器 | 9 项通过，0失败/0跳过/0 flaky，桌面1440×1000/手机390×844；约63秒 |
| 确定性 fixture 浏览器 | 18 项通过，0失败/0跳过；26状态重捕获，约65秒 |
| 既有外围/恢复浏览器 | 7文件68项通过，0失败/0跳过，约196秒；账户、pending、日期读取、一次性关系卡、布局、页头和终态竞态 |
| 普通 API | 383通过，0失败，**219数据库相关跳过**；跳过不计为真实数据库通过 |
| 类型/正式构建 | `npm run build` 退出0，含 typecheck、客户端和 Worker 构建；新增浏览器测试也经 typecheck |
| portable安全 | 4项通过，退出0；嵌套故意失败负例不作为外层失败 |
| 主安全 | 7项检查通过，退出0，包含生产构建/开发凭据路径隔离 |
| 密钥扫描 | 全可达历史及当前 Git 文件扫描退出0，无命中；提交前钩子另行运行 |
| Impeccable | 对本次前端集成范围 detector 返回 `[]`；不是全面 WCAG 或屏幕阅读器认证 |

精简机器结果和截图 SHA 见 [证据目录](../evidence/201-recurring-integration/README.md)。完整 JSON/日志/失败轨迹保留在本工作区忽略目录 `.cache/`，不上传 CI。未上传源码、推送集成分支或换通道绕过 #199 的远端外发审批拒绝。

## 初轮失败及修正

| 触发与非零结果 | 原因 | 修正和重跑 |
| --- | --- | --- |
| 首次备份 runner 退出1 | 对比 `information_schema.columns` 把源/目标数据库名也当业务结构；仅 `table_catalog` / `udt_catalog` 不同 | 明确排除这两个目标库名称字段，保留类型、空值、默认值、顺序等全量列定义；完整 schema/事实/权限对账随后通过 |
| Chrome for Testing 浏览器首轮9项失败，runner退出1 | 该二进制 crashpad 报 `--database is required`，浏览器未启动 | 最小启动诊断系统 Chromium 成功；改用已有配置项 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`，未放宽业务预期 |
| 系统浏览器初轮4通过/5失败，runner退出1 | 两项4/3用例在写入尚未提交时先读 basis、再读详情，正常得到 VERSION_CONFLICT；另外三项用错完整按钮名（成长来源包含日期/经验、下一页任务、结束目标） | 并发观察改读单份权威 workspace 的 actions，详情业务断言保留；locator按现有真实可访问名称修正，9项同一组合完整重跑全部通过 |

这些是新增验收脚本/运行环境问题，没有发现并据此修改产品逻辑，也没有调整冻结规则或旧测试业务预期。失败日志分别为 `.cache/201-database-initial.log`、`201-integration-initial.log`、`201-integration-system-chromium.log`；完整成功日志 `201-integration-recheck.log`。失败、超时、非零与跳过均保留原状态。

## R01–R54 对应证据

下表 SQL 指 `tests/database/adventure-recurring.mjs` 的命名用例；HTTP 指 `adventure-recurring-database.test.ts`；B 指新 `adventure-recurring-database.spec.ts`；F 指现有周期 fixture/review/growth 三文件。每行均在上述最终组合中实际运行；范围排除项通过表单/API严格schema和源码核对。

| 规则 | 验收依据 |
| --- | --- |
| R01–R04 | B周月季年UI创建、同日多次；SQL original anchors验证周三、月末、闰日/季/年、原锚点回归与常数长跳期 |
| R05–R08 | SQL quota/counters/history；B四事实4/3禁新增及当前期/完成期分离；只读不改计数 |
| R09–R10 | SQL/HTTP无补记预记及当天撤销能力；B历史日期禁撤销与撤销至空 |
| R11–R17 | B原生表单固定周期/开始日、4/3与上调、未来开始日调整；SQL严格正整数/日期/溢出，HTTP过去开始日拒绝 |
| R18–R21 | 无暂停/计划结束表单或命令；B结束不可恢复和父子只读/未开始删除，SQL已开始即使零子仍拒删 |
| R22–R27 | B真实目标A→B迁移、旧子冻结、新子新归属、旧目标终态锁；关联撤销逻辑失效/不回待办；HTTP/SQL权限和旧路径攻击 |
| R28–R32 | SQL实时贡献增减、同ID重放不加数、跨期/长跳历史冻结及操作审计和；B4/3与上调6回退贡献 |
| R33–R37 | B旧目标达成后旧子不能撤销，N=2系数3奖励6、目标进度只算once、XP最终9；SQL/HTTP零N固定1及完整计奖 |
| R38–R40 | Asia/Shanghai服务端日期；SQL真实账户锁等待+临时副本时钟跨午夜；B过期today真实409、刷新不补交；F所选旧日保持；无子备注字段 |
| R41–R44 | B真实父进度/满额、直接点击与重复点击、当日子身份和总进度；HTTP精确4/5全量口径；F共用toast |
| R45–R49 | B共用搜索/周历、未开始改日/删除、结束日只读、历史只完成+不展开运行中父；F完整历史/未来入口；无新增顶级导航 |
| R50–R51 | B taskCount与once progress分离、未来/满额父阻断；F目标/锁/按钮状态与26截图；外围68项回归 |
| R52–R54 | B父子往返、真实11项分页→撤销第11项→父10项、撤销最后项空态；F四个分页流11→10空页返回、同层toast及关闭 |

## 回执、日界及升级的准确范围

未知结果：真实事务先提交再仅丢弃浏览器响应，刷新后由只读 lookup 恢复原封套，原 requestId/today 不变，不再次写；同ID重放不增XP/子/计数，异摘要409。另一场景成功后仅回读503，点击重新读取不会再发命令。真实旧四表/退役 focusGoal 回执以冻结四字段探针和 `goal-categories-1` 头恢复，旧目标新写和 legacy-retry 仍拒绝。

SQL日界检查使用两个真实PG connection阻塞/等待账户锁，另一个连接确认 `wait_event_type='Lock'`；只在临时副本函数推进测试时钟后释放锁，验证新过期请求无事实/XP/revision/回执变化，旧成功回执优先。生产函数无测试参数/GUC/测试RPC入口。浏览器另将发送请求的today改成过期日期，得到生产Worker/PG真实409并不自动补交；这是过期意图与前端恢复验收，**没有等待现实北京时间午夜**。

新库整份安装与非空升级都通过单次 node-postgres query 发送完整SQL；结构/函数/权限/断言在同一事务。旧五表仅用于生成真实退役回执的临时夹具，先迁到四表再带入事实，不作为新安装或生产初始化路径。

## 本地备份恢复演练

`recurring-backup-restore.mjs` 在本次升级代表库增加一次性完成历史、周期父子和满足贡献，连同已有7点历史奖励/退役回执做整库 `pg_dump -Fc`。用 `pg_restore --exit-on-error --single-transaction` 恢复到同 cluster 的新数据库，逐项深比较全部表行（含事件快照、hash、XP、revision）、45个函数定义/签名/ACL/invoker/search_path、列、FK/约束、索引、触发器、RLS/policies、schema授权与扩展清单；全部一致。合成备份保留在忽略目录 `.cache/recurring-synthetic.dump`，每次runner重建新备份，实际字节/摘要见 restore报告。

覆盖数据库对象与合成数据；当前扩展仅已有plpgsql 1.0，其清单随恢复核对。已有 anon/authenticated/service_role 为同一cluster角色，因此**没有证明globals/角色/表空间在新cluster独立恢复**。该runner不使用托管迁移registry，特建 `integration_history.migrations` 一行记录真实增量摘要并随备份恢复；**不把这行称为真实 supabase_migrations 历史**。生产角色、扩展/版本、真实迁移历史和完整实例恢复能力均未检查。方法符合 [PG17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) 的单数据库范围，globals另需 [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html) 或托管平台支持的恢复通道。

## 验收预览及未完成门禁

常驻 [本机隔离预览](http://127.0.0.1:5230/adventure)，Orca terminal `term_2fa0813c-ff7f-4fc4-a512-1dd24af2e76a`。由 `start-recurring-preview.mjs` 新建另一个loopback cluster，Vite测试中间件提供受控身份并将正常浏览器网络请求交生产app.request/HTTP RPC；无生产环境配置或数据，其他业务API明确不可用。已通过实际浏览器点击“记录一次”，验证XP/行动1→2、父1/5→2/5、今日进度2/3及正式toast；可继续创建/查看/撤销，服务保留。该预览不是部署。

Agent浏览器自验、fixture截图、真实数据库验证均已单独记录；用户界面验收、合并后独立规范/需求双轴评审尚待主会话。远端push/PR和必需 `validate` CI尚未执行，不能以本地全部通过冒充CI成功。最终PR目标main，但须主会话核对具体远端授权；没有自动关闭关键词。生产备份/通道限额/停流/迁移/同版本部署/恢复流量的门禁见[发布计划](recurring-release-plan.md)，这些阶段均未执行。

Modern Web Guidance本轮查询并读取 `dialog` / `accessibility`，用于检验已有原生modal、键盘及toast；没有新增产品平台代码。Impeccable沿用已确认视觉，不重设计；React既有请求key/取消/迟到响应通过本次68项恢复与18项周期回归，未引入组件改动。
