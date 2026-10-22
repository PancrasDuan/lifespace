# 任务改期验收

范围：Issue #61，基线 `8e68623`，分支 `codex/53-adventure`，交付工作树 `/Users/pancras/.codex/worktrees/adventure-delivery/lifespace`。只用新建临时 PostgreSQL／PostgREST 和受控测试身份，不访问真实 Supabase。

## 页面与数据库对照

| 场景与操作 | 页面预期 | 数据库预期 |
|---|---|---|
| 过去待完成任务→改期到今天→预览→取消 | 显示逾期；过去完成按钮禁用；取消后日期与列表不变 | 预览无写入，planned_on、revision、事件数不变 |
| 确认改到今天，再完成、刷新 | 过去列表移除、今天列表显示；原安排链可展开；完成后1点奖励、1次行动 | 同一个task ID更新planned_on；追加一条无奖励task_rescheduled；完成时仅新增一条task_completed，冻结amount=1 |
| 连续改到未来、再改回今天 | 每次确认展示后端旧／新日期，只有一个任务；历史日期链持续可见 | 每次sourceEventId指向上一创建／改期事件；tasks仅一个当前日期，不新增行动或奖励 |
| 编辑／迁移后再改期 | 当前名称、说明、归属变化；历史详情仍能看到发生时内容与归属 | 旧snapshot不变，新改期snapshot保存当时内容；编辑／迁移不生成第二条安排 |
| 已完成、过去完成、任务或上级终态 | 当前能力禁用；今天完成须先合法取消才允许改期 | 不合法命令整笔拒绝；过去完成冻结，取消精确关联具体completionId |
| 旧requestId重试、并发改期／完成／结束／取消 | 409须重新读取并预览；未知结果仅原封套重试；成功后读取失败仅重读 | 同key返回原回执；账户锁／版本只允许合法胜者，不重复日期更新、行动、奖励或revision |
| 写入事件时故障 | 返回暂不可用，重读仍是原安排 | 任务日期更新后事件触发器抛错，事实、事件、版本、经验全部回滚；重试仍无半安排 |
| 超过一页原安排链 | 列表显示总数和前5条日期摘要；进入稳定taskId历史，每页5条、前后翻页，刷新仍可查看 | 完整历史保留，来源连续；大内容101条历史分页无丢失或重复，列表不加载全部长快照 |
| 越权、过去／同日／非法日期、改期后删除 | 权限／日期错误明确；曾改期不再允许误建删除 | 跨owner404，日期／历史锁拒绝；当前安排与历史保持一致 |

## 验证边界与命令

业务使用正式 Worker HTTP → 本机真实 PostgREST → 临时 PostgreSQL。测试仅替换受控身份校验和RPC网络目的地，不替换业务函数。浏览器关键路径同样连接正式 Worker 和临时真实数据库，提交后刷新回读；最后SQL审计直接核对全库经验、版本、请求、完成取消关联、达成、迁移、生命周期和安排来源链。UI专用fixture仅证明409／未知结果／查询失败恢复，不证明数据库持久化。

```sh
npm run check:secrets
POSTGRES_BIN=<临时本机PostgreSQL的bin目录> POSTGREST_BIN=<本机PostgREST> POSTGRES_LIB=<其动态库目录> npm run test:database -- --browser
npm run test:api
npm run test:security:portable
npm run test:secrets
npm run build
npm run test:browser
```

SQL探针位于 `tests/database/adventure-reschedule.sql`，覆盖跨日旧请求、过去完成冻结、权限和中途失败回滚；正式HTTP故障注入只由测试运行器安装在临时库内，不进入初始化脚本。安排链HTTP、浏览器和全库审计分别位于 `tests/api/adventure-reschedule-database.test.ts`、`tests/browser/adventure-actions-database.spec.ts`、`tests/database/adventure-actions-audit.sql`。

## 最终结果

2026-10-22 当前代码验证：

| 检查 | 结果 |
|---|---|
| 空库初始化、全部SQL探针、RLS／索引／函数权限、回滚 | 通过 |
| 正式Worker HTTP→临时真实数据库 | 43项通过（其中本票9项） |
| 真实数据库驱动桌面／手机浏览器 | 13项通过（其中本票3项） |
| HTTP／浏览器操作后全库一致性审计 | 通过，含当前日期与最新安排、完整来源链、冻结奖励及版本 |
| 全站API | 156通过、49跳过；跳过中43项已在隔离套件实际运行，6项在线用例未运行 |
| 全站浏览器 | 162通过、15跳过；跳过中13项已在隔离套件实际运行，2项真实账户用例未运行 |
| portable安全回归、密钥钩子自测 | 各1项通过 |
| 全量密钥扫描、typecheck、build、diff检查 | 通过 |

验证日志在 `/private/tmp/lifespace61-final-{database,api,browser,security,secret-tests,secrets,build}.log`，不提交测试产物。当前隔离预览 `http://127.0.0.1:5196/adventure` 已打开并核对页面；“过去”中预置验收-漏做改期，“未来”中预置验收-未来改期，均为临时测试数据。旧预览与数据保留。

## 评审与限制

规范与需求两轴以固定基线独立评审并最终复核：规范轴0项阻塞问题，需求轴0项未解决问题，无明确范围扩张。安排链使用有界日期摘要、显式总数及独立分页历史详情，101条长内容真实数据库验证通过；完整历史没有截断或删除。

真实Supabase同步与真实账户在线用例留到上线前另行授权；当前没有推送、合并、部署或关闭Issue。分页历史只读，新增改期不会改写已有页中的历史事件；刷新重新读取最新总数。全站构建保留既有大于500kB的chunk提示。
