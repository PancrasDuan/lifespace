# 跨功能集成与交付验收（#63）

基线 `2277f12`，交付工作树 `codex/53-adventure`。本期创建、执行、改期、迁移、达成、结束和成长追溯在本地组合验证。仅使用临时 PostgreSQL／PostgREST 与受控身份，不读取或修改现有 Supabase。

## 49 条故事对照

故事编号对应父规格发布稿 `issue-spec.md`，原稿不修改。任务归属按用户后续确认：未选择即独立任务，无额外独立选项。`.test.ts` 位于 `tests/api`，`.spec.ts` 位于 `tests/browser`，`.sql` 位于 `tests/database`。表中为当前执行范围的定位线索，不把历史单表测试计为新版通过证据。

| 故事 | 验收内容 | 当前证据文件／用例线索 |
|---|---|---|
| 1 | 导航进入 | `adventure.spec.ts`：导航／页面 |
| 2 | 空规划与初始成长 | `adventure-growth-database.test.ts`：空流水／不增加版本 |
| 3 | 5 条在用主线 | `adventure-lifecycle-database.test.ts`：五条在用主线结束释放名额 |
| 4 | 主线只承载目标 | `adventure-actions-database.test.ts`：主线目的拒绝 |
| 5 | 独立目标与任务 | `adventure-actions-database.test.ts`：空账户创建独立任务 |
| 6 | 固定独立身份 | `adventure-lifecycle-database.test.ts`：独立区和 inbox 禁止结束 |
| 7 | 名称标准和默认独立 | `adventure.spec.ts`：目标归属默认为独立且可清空；`adventure-planning.sql`：默认独立／清空／标准持久化 |
| 8 | 目标编辑取消 | `adventure.spec.ts`：目标详情编辑后取消，封套数不变；`adventure-management.spec.ts`：修改主线与目标 |
| 9 | 聚焦配额 | `adventure-integration-database.test.ts`：聚焦迁入和本地聚焦争最后名额 |
| 10 | 聚焦排序与执行 | `adventure-actions-database.test.ts`：同归属同聚焦组排序 |
| 11 | 独立任务双视图 | `adventure-actions-database.test.ts`：搜索和日期与双视图组合 |
| 12 | 手动达成 | `adventure-actions-database.test.ts`：目标八次行动选系数二 |
| 13 | 无任务或有待办达成 | `adventure-actions-database.test.ts`：零行动／pending结束 |
| 14 | 预览影响与先迁出 | `adventure-integration-database.spec.ts`：迁移达成来源联动 |
| 15 | 目标终态锁定 | `adventure-actions-database.test.ts`：终态能力均正确 |
| 16 | 下属停止并保留完成 | `adventure-actions-database.test.ts`：pending结束并保留completed |
| 17 | 手动结束主线释放名额 | `adventure-lifecycle-database.test.ts`：五条在用主线结束释放名额 |
| 18 | 结束保留成果经验 | `adventure-lifecycle-database.test.ts`：主线结束预览／奖励保留 |
| 19 | 一次性任务创建 | `adventure-actions-database.spec.ts`：创建目标任务／创建独立任务 |
| 20 | 任务状态与逾期 | `adventure-actions-database.spec.ts`：漏做改到今天并完成 |
| 21 | 后端日期与冻结 | `adventure-actions.sql`：当天／过去完成 DATE_LOCKED |
| 22 | 当天取消具体完成 | `adventure-actions-database.test.ts`：取消、再完成后旧成功请求只回放 |
| 23 | 取消逻辑失效 | `adventure-actions-audit.sql`：invalidation detached／task current completion |
| 24 | 再次完成与幂等 | `adventure-growth-database.test.ts`：19→20→19→20 |
| 25 | 待办编辑与历史快照 | `adventure-actions-database.spec.ts`：创建、编辑、完成、取消、重做 |
| 26 | 改期保留行动 | `adventure-reschedule-database.test.ts`：连续改期保留完整来源链 |
| 27 | 任务结束只读 | `adventure-lifecycle-database.test.ts`：结束待完成任务立即只读 |
| 28 | 误建删除资格 | `adventure-integration-database.test.ts`：未来任务改期再迁移仍失去误建删除资格 |
| 29 | 目标迁移与聚焦 | `adventure-actions-database.test.ts`：目标跨主线与独立归属迁移 |
| 30 | 任务迁移保留身份 | `adventure-actions-database.test.ts`：迁移任务保持身份 |
| 31 | 失败无部分迁移与历史锁 | `adventure-migrations.sql`：权限／回滚／历史锁定 |
| 32 | 2／3 当前归属进度 | `adventure-actions-database.test.ts`：分页不截断进度 |
| 33 | 零分母与非自动达成 | `adventure-integration-database.test.ts`：停止后零分母 |
| 34 | 统一终态开关 | `adventure-actions-database.spec.ts`：结束主线／只读刷新 |
| 35 | 终态排序 | `adventure-lifecycle-database.test.ts`：历史主线超过五条仍可读取 |
| 36 | 按账户记忆与隐藏来源 | `adventure-lifecycle.spec.ts + adventure-growth-database.spec.ts`：账户切换／永久链接 |
| 37 | 完成实时 1 点 | `adventure-actions-database.test.ts`：空账户创建／完成刷新 |
| 38 | 目标 N×C 与保底 | `adventure-actions-database.test.ts`：八次行动／三种系数 |
| 39 | 预览评价及冻结 | `adventure-actions-database.test.ts`：全量影响／默认评价与感想 |
| 40 | 历史归属计奖 | `adventure-integration-database.test.ts`：改期完成后迁出、迁移原目标并达成 |
| 41 | 取消经验等级回退 | `adventure-growth-database.spec.ts`：19→20→19→20 |
| 42 | 七个动态成就 | `adventure-growth-database.spec.ts`：七项成就全部点亮 |
| 43 | 只读成长与分页来源 | `adventure-growth-database.test.ts`：大内容目标／游标分页 |
| 44 | 后端权威投影 | `adventure-integration-database.test.ts`：进度／冻结来源／名额 |
| 45 | 预览后提交重新查询 | `adventure-integration-database.spec.ts`：真实提交恢复／预览过期 |
| 46 | 成功后只重读 | `adventure-integration-database.spec.ts`：查询失败 |
| 47 | 未知重试与409 | `adventure-integration-database.spec.ts + adventure-review.spec.ts`：原封套／预览过期／旧版本拒绝覆盖 |
| 48 | 刷新持久与账户隔离 | `adventure-integration-database.spec.ts + adventure-account-recovery.spec.ts`：刷新／迟到旧账户响应 |
| 49 | 桌面手机键盘全链路 | `adventure-integration-database.spec.ts`：1440／390px／Enter／Escape |

## 页面与数据库联动验收

| 步骤 | 页面预期 | 数据库预期 |
|---|---|---|
| 创建主线、目标和过去的任务；改期到今天 | 逾期完成按钮禁用；预览显示新旧日期；Enter 确认后今天列表出现同一任务 | 预览不变版本；改期事件关联最初安排；taskId 不变、无奖励 |
| 完成任务但模拟响应丢失 | 保留安全重试，输入和其他写操作禁用 | 实际完成已经提交；只有一个带 1 点奖励的 task_completed |
| 安全重试后模拟查询失败，再重新读取 | 明确“操作已成功，页面更新失败”；只重读后显示已完成 | 重试封套完全相同；没有新事件、版本或重复奖励 |
| 打开取消预览，另一会话写入后确认 | 409 后旧确认禁用；重新预览、确认才取消 | 旧确认不写入；取消精确失效原 completionId，总经验回退 |
| 再次完成后迁为独立任务，确认原目标达成并选系数 3 | 原目标没有当前任务进度，仍预览 1 次历史计奖行动、额外 3 点 | 新完成 ID；原目标 N=1，迁移不改历史，累计经验 4；独立任务不能再取消 |
| 原目标跨主线迁移后达成，再结束两条主线 | 隐藏终态仍可通过永久链接读历史和成长来源 | 目标达成来源冻结达成时归属；计奖行动冻结完成时归属；结束不扣经验 |
| 聚焦迁入与目的目标聚焦争最后名额 | 任务列表的“只看聚焦目标”保留独立任务并排除未聚焦目标任务；重读后展示唯一已提交结果，不自动重放 | 同版本一个 200、一个 409；新版本重试失败者仍因满额拒绝；无部分迁移 |
| 未来任务改期、迁移，再结束目标 | 误建删除不可用；结束后只读，零分母为空进度 | 原安排链保留；无删除事件、无奖励、无待完成残留 |
| 旧账户查询未返回时切换账户，再释放旧响应 | 新账户内容保留，不显示旧账户主线；新版本可继续操作 | 此项只验证客户端隔离；真实行权限由 SQL 和 HTTP 越权探针另证 |

## 执行方式与证据范围

```sh
npm run check:secrets
POSTGRES_BIN=<本机临时PostgreSQL的bin> POSTGREST_BIN=<本机PostgREST> POSTGRES_LIB=<动态库目录> npm run test:database -- --browser
npm run test:api
npm run test:security:portable
npm run test:secrets
npm run build
npm run test:browser
npx vitest run --config vitest.legacy.config.ts
git diff --check
```

临时数据库运行器从空库创建五表，执行全部 SQL 探针、正式 Worker HTTP 和真实数据库浏览器流程，最后执行 `adventure-actions-audit.sql` 全库核对，再销毁临时实例。API 测试调用正式 `app.request`；浏览器路由转交同一个正式 Worker handler，Auth 使用受控响应，RPC 转发本机真实 PostgREST。它证明应用 HTTP 契约与数据库事务，不冒称真实登录或生产网络验收。

跨日现有 SQL 探针用过去完成事实验证日期冻结与旧回执重试；没有修改系统时钟，也没有等待真实午夜。网络故障测试在真实事务提交后丢弃响应，再验证原封套重试及只读恢复。账户切换测试使用 SDK 跨标签页会话通知和受控投影，单独标为交互证据。

## 当前结果与交付门禁

2026-10-22 在基线 `2277f12` 加本票待提交差异上执行，最终检查使用 Node 22.21.0。

| 检查 | 实际结果 |
|---|---|
| 密钥扫描先行 | 完整可达历史与当前 Git 文件通过；提交前再次扫描 |
| 空库、全部 SQL 探针 | 通过：五表权限、同 owner 关联、失败回滚、日期冻结、幂等、版本、奖励及索引 |
| 正式 Worker HTTP → 临时 PostgreSQL | 53 项通过，含本票 3 项跨功能组合 |
| 数据库驱动浏览器 | 22 项通过，含本票 1440／390px 的两条完整联动及提交恢复 |
| 操作后全库审计 | 通过：实体／有效完成／取消／达成／冻结奖励／安排链／聚焦名额／经验／版本／回执一致 |
| 全量 API | 156 通过、59 跳过；其中 53 项隔离用例已单独执行，6 项在线用例未运行 |
| 全站浏览器 | 165 通过、24 跳过；其中 22 项隔离用例已单独执行，2 项真实账户用例未运行；包含首页、新闻、认证、账户切换迟到响应 |
| Portable 安全与密钥钩子自测 | 各 1 项通过；安全包装执行完整隔离安全检查 |
| 类型检查、构建、差异空白检查 | 通过；保留已有客户端 chunk 超过 500 kB 警告 |
| 独立历史回归 | 35 项通过，重定位后的能力基准可运行；不计作新版业务验收 |
| 本地预览 | `http://127.0.0.1:5200/adventure` 可访问，已主动打开并核对渲染；新临时数据库和受控身份 |

初次全站浏览器在并行构建期间因 Vite 依赖缓存缺失启动失败；构建结束后串行完整重跑得到上表结果，不修改产品逻辑或跳过失败用例。首次新增用例中的字段名与等待条件错误均按正式契约修正，未以改动业务规则取得绿灯。

评审基线固定 `2277f12`，审阅本票完整待提交差异（含新增文件）：Standards 初评无硬违规，提出共享测试桥接重复的 P3，已抽取 `tests/support/planning-database-browser.ts`；Spec 提出最终执行结果未填写及故事 7／8 证据定位不准的两项 P2，均已修正。最终复核：Standards 硬违规 0、未关闭启发式问题 0；Spec 两项 P2 均关闭、未关闭问题 0。本轮授权范围内无阻断项。桥接整理后的 53 项 HTTP、22 项数据库浏览器及全库审计均再次通过。

完整执行日志在本机 `/private/tmp/lifespace63-{database-green,final-api,final-browser-retry,final-build,final-security,final-secret-tests,final-legacy,legacy-benchmark}.log`；桥接整理后的受影响回归为 `/private/tmp/lifespace63-review-database.log`，最终类型检查为 `/private/tmp/lifespace63-review-typecheck.log`。这些日志为本机会话证据，不作为已上传 CI 或线上记录。

本地验收可使用“验收-第20点经验”验证 19→20→19→20；“验收-漏做改期”用于过去→今天→完成→迁移→原目标达成；“验收-未来误建”用于改期前后删除资格对比。页面与 DB 预期见上表；服务保持运行，不改动旧预览数据。

- 当前应用仅导入新版投影契约；旧页面、旧 Worker HTTP 写入口及浏览器次日结算调用已移除。历史引擎与存储测试归入 `tests/legacy/adventure`，通过独立配置复跑；旧表、旧初始化 SQL 和数据保留。
- 真实 Supabase 未同步；真实用户 JWT、人工最终验收、线上网络和 Cloudflare 运行环境均未冒称通过。预览使用受控身份与新的临时数据。
- 用户验收后仍须取得具体 PR 的合并授权；本轮只本地提交，不推送、不合并、不部署、不关闭 Issue。
