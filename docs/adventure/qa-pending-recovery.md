# 原封套恢复与本地解除（#224）

2026-11-16。交付分级：需确认，涉及未知结果恢复、幂等写入及 IndexedDB 持久化状态。用户已授权实现、验证、提交、Issue/PR 更新；合并、发布及真实用户验收仍待确认。

## 事故与原因

Issue #224 记录 2026-11-16 11:24–11:34 和 13:00 后同一条 pending 持续查询回执。身份校验成功，但 `receipts/lookup` 返回 `RECEIPT_UNKNOWN`；未观察到对应写请求。旧实现对从 IndexedDB 载入的记录只允许只读 lookup，任何失败都保留记录，形成无法退出的冻结。

最小回归为 `adventure-pending-recovery.spec.ts` 中“RECEIPT_UNKNOWN 后重载的 pending 可按原封套恢复，不再永久冻结”。修复前实际运行失败：原封套恢复请求期望为 `[currentEnvelope]`，实际 `[]`，5 秒轮询超时；修复后应通过。

## 恢复契约

保留 `compatibility` 的严格四字段协议及 `receipts/lookup` 的现有行为，供未升级客户端继续只读查询。新增 `POST /api/adventure/recovery`，要求有效本人会话、当前 `X-Adventure-Client-Version`、原 `{requestId, expectedVersion, command}` 及每次随机生成的 32 字节十六进制 `nonce`。传输预算保留原入口完整 32,768 字节，另加 128 字节容纳固定恢复元数据，不能因 nonce 让原合法封套无法取回回执。不接受客户端 owner，不升级或改写旧命令，不生成替代 requestId，不替换 expectedVersion 或规划日期。

当前模型仍支持执行且字段完整的封套直接调用现有 `adventure_planning_command`。`canRetryPlanningEnvelope` 排除为历史回执而保留解析能力的主线/聚焦/旧改期/旧迁移/任务结束，以及缺少当前完整字段的旧编辑封套。数据库在账户行锁内先按原 requestId 检查回执和命令摘要，再检查日期、版本及业务条件；已有成功回执优先返回。并发重试最多提交一次。客户端没有“查不到就认定失败”的分支。

旧目标封套（例如含 `destination` 的 create/editGoal、含 `mainlineId` 的 reorderGoals）只调用 `adventure_receipt_lookup`，不尝试转换成当前模型。成功结果返回 `outcome=confirmed` 与原回执；仅以下受限结果返回 `outcome=review`：

| 分支 | code | 含义 |
|---|---|---|
| 当前封套的锁内命令 RPC | VERSION_CONFLICT | 原版本已变化，本次重试未执行 |
| 当前封套的锁内命令 RPC | PLANNING_DATE_CHANGED | 原日期已变化，本次重试未执行 |
| 当前封套的锁内命令 RPC | RESCHEDULE_PAST、DATE_LOCKED 等严格白名单业务拒绝 | 原条件已不再允许执行，锁内已先核对回执；本次事务未提交 |
| 不支持重试的旧封套只读 RPC | LEGACY_RECEIPT_MISSING | 无可用回执，不能证明过去未提交，需本人核对 |

白名单见 `recoveryRejectionCodeSchema`，只收回执检查之后的日期、版本、实体状态、目标阻塞、周期及容量拒绝；这些拒绝同事务回滚。INVALID_COMMAND 和 COMMAND_TOO_LARGE 可能在回执检查前发生，仍不能授权解除。所有成功/核对结果必须绑定 requestId、nonce、`X-Lifespace-Adventure-Recovery: 1` 和完整 `Cache-Control: no-store`，客户端严格验证结果结构及分支适用性。不匹配、过期、损坏回执、网络/超时、Auth、REQUEST_ID_REUSED、REPLAY_UNAVAILABLE 或其他异常均保持未知；不显示人工解除入口，不降级调用 commands。

## 人工解除

核对区沿用既有页面，仅在可信 `review` 响应后出现。显示原操作及原因，说明解除只影响本机 pending，不撤销服务端结果，也不重新提交。

1. 点击“重新读取当前事实”。读取成功前禁用确认勾选与解除按钮；读取期间仍阻止写入。
2. 读取成功后开放只读浏览：终态筛选、目标分页/详情及相关任务、行动详情、周期父子详情/分页和成长记录。所有写入口仍冻结，`command` 仍要求没有 pending。待确认读取期间禁用页签切换；读取后的视图切换不因懒加载开关重建生命周期，生命周期替换时也重置 busy/submitting，旧请求不能清理新请求的操作标志。正常预览期间仍允许原有取消/切换行为。用户核对事实后，明确勾选“我已核对当前页面事实，确认解除本地待确认状态”。
3. 点击“解除本地待确认状态”。在同账户 Web Lock 内重新读取并匹配完整封套，在单一 IndexedDB readwrite 事务内比较后删除，再广播变化、废弃旧预览并重新读取事实。
4. 重新读取成功后恢复操作能力；删除成功而读取失败时仍要求重新读取，不显示保存成功。不伪造原操作成功。

锁被占用、封套被替换、删除失败或核对读取失败均撤销已读取资格，保留持久化记录。其他账户记录不展示、不删除。认证变化及页面卸载沿用 identity/lifecycle abort 隔离。

## 验证入口

使用用户级 Node.js v24.22.1。数据库运行器仅创建随机本机端口的临时集群，不访问生产。当前机器 `/tmp` 空间不足，因此把 `TMPDIR` 指向任务工作区 `.cache/db-temp`。

```sh
npm run test:api
npm run build
npm run test:security:portable
npm run check:secrets
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium PLAYWRIGHT_PORT=5224 \
  npm run test:browser -- tests/browser/adventure-pending-recovery.spec.ts \
  tests/browser/adventure-account-recovery.spec.ts tests/browser/adventure-growth-recovery.spec.ts \
  tests/browser/adventure-date-list-recovery.spec.ts tests/browser/adventure-recurring.spec.ts
POSTGRES_BIN=<本机PG17-bin> POSTGREST_BIN=<本机PostgREST> LD_LIBRARY_PATH=<动态库目录> \
  TMPDIR=<当前工作区专用临时目录> node tests/support/run-recurring-database.mjs
POSTGRES_BIN=<本机PG17-bin> POSTGREST_BIN=<本机PostgREST> LD_LIBRARY_PATH=<动态库目录> \
  TMPDIR=<当前工作区专用临时目录> PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium PLAYWRIGHT_PORT=5225 \
  node tests/support/run-planning-database.mjs --goal-model \
  --api tests/api/adventure-recovery-database.test.ts --browser tests/browser/adventure-recovery-database.spec.ts
```

`run-recurring-database.mjs --browser` 也纳入新的真实浏览器恢复专项；默认 API 入口中真实数据库测试会跳过，不能用这些跳过项代替独立数据库验证。

## 验证记录

最终结果及固定评审提交记录在关联 PR。2026-11-16 本地已完成：

| 检查 | 结果 |
|---|---|
| 全量 API，`--maxWorkers=1` | 513 通过，245 个依赖独立数据库/环境的测试按原条件跳过，0 失败 |
| 周期模型真实 PG17/PostgREST/Worker 运行器 | HTTP 103 通过，0 跳过；SQL 11 组通过，并发读取 600 次 |
| 恢复专项真实四表模型 | HTTP 3 通过；真实浏览器 3 通过；均 0 跳过 |
| pending/账户/成长/日期列表/周期浏览器 | 首轮 52 通过，0 跳过；评审新增只读导航/成长页切换 2/2 通过；最终扩大范围结果见 PR |
| TypeScript 与生产构建 | 通过 |
| 安全回归 | 原有 4 项通过，含 7 项隔离检查及清理负例 |
| 完整历史及工作树 Gitleaks | 通过 |
| 1440px/390px 人工看图 | 核对区可读，无横向溢出；外围布局沿用既有页面 |

双轴复审及最终 CI 的结果继续记录在 PR。覆盖点包括：

- 新 API 的协议与错误分类；旧 compatibility/lookup 不变。
- 真实 SQL/Worker HTTP：原封套 6 路并发仅提交一次、回执丢失后原样重放、已撤销完成仍返回原历史奖励而不重新发奖、版本和 ID 冲突、旧目标缺失不写入。
- 浏览器：重载 pending 后恢复，版本/日期/旧模型核对，先读再勾选，无新 requestId，存储/锁/账户/认证与坏响应保护。
- 1440px、390px 的既有页面与核对区截图位于 `docs/evidence/224-recovery/`，使用虚构数据；不代表用户真实事故记录或生产验收。

环境记录：首次隔离数据库因 `/tmp` 的 tmpfs 空间不足失败，改在工作区专用目录运行后通过；Chromium 的临时 socket 路径过长时，使用指向该目录的短路径解决。Token 采集器 API 有拒绝路径中符号链接的保护，因此 API 使用真实目录。并行浏览器与安全预览曾共享 `.vite` 缓存、浏览器结果目录，产生资源路径/trace 清理失败；已分离输出并串行重跑。安全副本通过 `git ls-files` 复制源码，新增文件须先暂存；副本不能放在应用明确拒绝的 `.cache` 路径下，改用 `/dev/shm/lifespace224` 后安全回归 4/4 通过（含全部 7 项隔离检查及预期失败负例）。扫描器下载超时后复用项目既有固定版本缓存，核对两份缓存二进制 SHA-256 一致。上述失败运行不计作通过，也没有修改 Token、安全测试或放宽门槛。

首轮固定提交 `679692d` 的双轴评审发现跨天明确拒绝没有出口、核对期间无法浏览终态/分页/详情、大封套被 nonce 挤出请求预算，以及成长页读取中切换导致生命周期重置四处 P2。补充真实跨天事务、32,720 字节原封套、只读导航和成长页并发切换回归后修复，最终提交的复审范围及结论以 PR 为准。共享成功回执处理的重复是判断性维护建议，本轮保留两条不同错误语义的既有边界，未进行额外状态管理重构。

Impeccable detector 只报告现有配色与 DESIGN.md 的 advisory；该设计文档明确仅规范 Token 路由，本次保留人生冒险既有视觉，不把 Token 配色强行推广到其他页面。Modern Web Guidance 的 accessibility 指南用于原生 button/checkbox、可访问名称和确认说明；本流程采用内联核对，不新增 modal。

本轮不执行数据库迁移或生产数据清理。代码可通过后续 revert PR 回退；已由本人明确解除的本地 pending 不能由回退自动恢复，服务端历史事实与成功回执仍保留。生产合并/发布前须核对最终 validate、用户验收及针对最终 PR 的授权；发布后另行核对 Cloudflare 版本和线上只读接口，完成后才能关闭 Issue。
