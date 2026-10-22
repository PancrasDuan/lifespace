# #66 生命周期、误建删除与终态历史验收

日期：2026-10-22。分支 `codex/53-adventure`，评审基线 `9e61488`。仅使用本机新建临时 PostgreSQL／PostgREST、正式 Worker HTTP 和受控身份；真实 Supabase 未连接、未修改。

## 验收对照

| 场景与步骤 | 页面预期 | DB 预期 |
|---|---|---|
| 打开进行中目标，点击“结束目标” | 确认弹窗列出全量待停任务和保留完成数；取消无变化 | 预览不写事件、不推进 revision；提交返回 200 后目标 ended、focused=false，pending 任务 ended/end_cause=goal_ended，completed 与原奖励不变 |
| 结束后刷新永久链接并尝试取消完成 | 目标只读，结束／编辑／迁移／新增任务／达成禁用；已完成任务保留 | goal_ended 一条，amount／calculation 为空；goal_achieved 和 task_completed 不失效，total_xp 不变；终态锁拒绝取消 |
| 打开在用主线并确认结束 | 预览列出进行中目标和待停任务；确认后主线从默认列表隐藏，已达成目标仍可查看 | mainline_ended 一条；主线 ended；进行中目标 ended/mainline_ended，下属 pending 任务 ended/mainline_ended；已完成／达成及经验不变；active 名额释放 |
| 结束独立任务 | 先展示后端影响预览；确认后任务显示已结束，编辑／完成／迁移／删除禁用 | status=ended、end_cause=manual，task_ended 无奖励；重复结束与已完成任务结束均拒绝 |
| 未来误建任务删除成功与拒绝 | 仅未来、尚未开始且无安排／完成历史任务显示可删除；确认弹窗展示执行日和历史数，确认后消失；今天／曾改期／曾完成／已结束不可删；普通编辑本身不影响资格 | deleted_at 非空、task_deleted 事件；无物理 DELETE；改期事件及取消过的旧完成永久阻止删除 |
| 打开“显示已达成／已结束”，刷新后切换账户 | 默认隐藏终态；开关按账户保存，刷新保留；另一账户不沿用 | includeTerminal 只影响读取，不写事件、不推进版本；终态详情可按稳定 ID 访问 |
| 终态列表排序及主线历史入口 | 进行中优先，聚焦和手动顺序保持；终态目标在组末按结束时间倒序，已结束主线在列表末尾；主线“查看历史”可分页、刷新、进入目标 | SQL 使用同版本快照排序，分页不截断全量计数；mainlineId 限定同账户主线历史，关闭显示开关仍可直接访问 |
| 并发结束／失败注入／重试 | 仅一个请求成功，另一请求 409；原 requestId 回放同回执；未知结果不重放 | 账户锁串行；传播中途抛错时目标、任务、事件、revision 全回滚；重复请求不产生第二条终态事件 |

## 自动验证与复跑

```sh
npm run check:secrets
POSTGRES_BIN=/private/tmp/lifespace54/postgres-tool/node_modules/@embedded-postgres/darwin-arm64/native/bin \
POSTGREST_BIN=/private/tmp/lifespace55/postgrest \
POSTGRES_LIB=/private/tmp/lifespace54/postgres-tool/node_modules/@embedded-postgres/darwin-arm64/native/lib \
npm run test:database -- --browser
npm run test:api
npm run test:security:portable
npm run test:secrets
npm run build
npm run test:browser
```

需 Node.js 22.12+、本机 PostgreSQL／PostgREST 和 Playwright Chromium。运行器只创建本次临时数据库，空库初始化后执行 SQL 回滚探针、正式 HTTP 和浏览器，最后审计账户经验、版本、有效完成、达成、终态传播及误建删除资格，然后删除临时库。SQL 强制经验核对失败，验证结束目标／主线、结束任务和删除任务均整笔回滚；受控终态夹具仅存在于回滚事务。浏览器截图位于忽略目录 `.cache/adventure66-lifecycle-1440.png`、`.cache/adventure66-lifecycle-390.png`。

另用任务更新触发器在传播中途抛错，检查已更新的主线、目标、任务、事件和 revision 全部回滚；触发器只存在于隔离测试事务。新用例也覆盖七条历史主线、201 条待停任务、原归属结束后的迁出完成锁定、主线结束与完成竞争。`tests/browser/adventure-lifecycle.spec.ts` 仅验证未知结果原封套重试、409 重新预览、成功后只重读、账户偏好隔离与存储拒绝，不作为数据库持久结果证据。

## 结果与评审

| 检查 | 结果 |
|---|---|
| 密钥扫描 | 本地可达历史及当前 Git 文件通过；提交钩子另扫描最终暂存内容 |
| 隔离数据库完整链路 | 空库初始化、规划／任务／达成／迁移／生命周期 SQL 探针、34 项真实 HTTP、10 项桌面／手机浏览器及全量 DB 审计通过 |
| 全站 API | 156 通过、40 按环境跳过；其中 34 项隔离用例已在上行运行，6 项真实账户／在线用例未运行 |
| 安全检查 | portable 安全回归 1／1、密钥钩子／历史扫描自测 1／1 通过 |
| 类型与构建 | 最终 typecheck、生产 build 通过；保留原有客户端 chunk 超过 500 kB 提示 |
| 全站浏览器 | 159 通过、12 按环境跳过；其中 10 项隔离 DB 场景已另行实际执行，2 项真实账户场景未运行 |
| 差异检查 | `git diff --check` 与暂存差异检查通过；不提交 `.scratch`、预览脚本、截图、配置或缓存 |

## 规范轴

独立规范评审以本票实现相对 `9e61488` 的暂存差异为准，记录硬违规、判断性 smell 及复核结果。

初审指出终态主线误用五条上限、预览数组数量限制、任务结束未走后端预览，以及文档／文案未对齐；均已修复。原评审者对最新源码只读复核，硬问题 0，原问题全部关闭。UI 四类生命周期入口与标题已统一。保留两项非阻塞 P3 判断建议：SQL 命令分类在校验／预览／执行分发处需同步维护；`adventure_lifecycle_*` 名称比目标／主线的实际职责宽。当前校验复用且单体任务与容器传播边界明确，不为消除条件分发引入通用事务框架。

## 需求轴

独立需求评审以本票实现相对 `9e61488` 的暂存差异为准，逐条对照 #66 验收标准及父规格故事 17、18、27、28、34、35、36，记录缺口、超范围和复核结果。

初审指出误建删除未检查历史改期、终态详情缺少终态时间、任务结束确认与测试路径不完整。已增加 task_rescheduled 历史锁、终态时间、后端预览及统一确认弹窗，补历史安排回滚夹具和真实浏览器回归。原评审者最终只读复核确认全部关闭，未发现新增需求偏差或范围扩张；静态评审与主执行者实际测试分别记录。

新预览为 `http://127.0.0.1:5194/adventure`，使用本票专属临时 PostgreSQL／PostgREST 和受控身份，浏览器已打开并确认空规划、Lv.1 及本机隔离标记。旧 5192 预览及数据保留。

## 限制

本票只使用临时隔离数据库和受控身份，不连接真实 Supabase；不推送、不合并、不部署、不关闭 Issue。现有验收库、真实 JWT、生产 Worker 和历史数据同步留到上线前授权阶段。任务改期命令仍属于 #61；本票只使用事务回滚夹具验证已有 task_rescheduled 事实会阻止误建删除。完整成长流水属于 #62；当前按稳定 ID 的主线／目标历史入口不受终态显示开关影响。
