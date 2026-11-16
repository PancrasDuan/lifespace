# 原封套恢复与本地解除（#224）

2026-11-16。交付分级：需确认。用户已授权实现、验证、提交和更新 Issue/PR；合并发布仍待确认。

## 原因与修复

Issue #224 中同一条 IndexedDB pending 在 11:24–11:34 和 13:00 后反复查询回执，得到 `404 RECEIPT_UNKNOWN`。原恢复逻辑只查询回执，所有失败又都变成“结果未知”，因此永远无法退出。

恢复直接复用现有接口，没有新增恢复端点、协议版本或数据库迁移：

- 当前仍可执行的原封套：再次发送 `/api/adventure/commands`，保持原 `requestId`、`expectedVersion` 和 `command`。数据库已有账户锁与幂等处理，先查历史回执，找到就返回；未提交才按原条件执行一次。
- 旧模型已退役命令：继续只读 `/api/adventure/receipts/lookup`，不转换或补全旧命令。`canRetryPlanningEnvelope` 排除历史主线、聚焦、迁移、旧改期/结束以及不完整编辑等仅供历史解析的形状。
- 业务明确拒绝：复用现有错误码和 HTTP 状态表，允许重新读取并人工核对。`INVALID_COMMAND` 和 `COMMAND_TOO_LARGE` 可能发生在回执检查前，不允许据此解除。
- 旧命令明确无回执：lookup 的 404 错误增加已有请求的 `requestId`、`nonce` 关联字段。客户端仅对关联匹配、`no-store` 且错误码精确为 `RECEIPT_UNKNOWN` 的响应开放人工核对。成功回执与 compatibility 四字段契约保留，旧客户端仍按原逻辑冻结。

网络、超时、Auth、`REQUEST_ID_REUSED`、`REPLAY_UNAVAILABLE`、损坏回执、未知错误及状态码不匹配均保留 pending，不显示解除入口。当前命令的 `RECEIPT_UNKNOWN` 同样不能授权解除。

用户确认的等待行为：首次命令提交及原封套恢复每次最多等待 10 秒；超时结束加载，显示“响应超时，点击重试。原操作已保留，请勿重复新建。”，释放本次 busy/提交锁而保留 IndexedDB pending。期限覆盖读取登录会话、请求、解析回执和成功后刷新；会话迟到时仍受发送前的 signal/身份检查阻止，不补发业务请求。重载后仍可用原 requestId、原版本、原命令重试；超时本身不允许人工解除，也不自动发送下一次请求。命令回执已确认后读取超时仍显示“操作已成功，页面更新失败”，只允许重新读取，不重发命令。

commands 不增加请求元数据，保留原 32,768 字节预算；旧 lookup 额外保留 128 字节容纳其原有 nonce，避免合法原封套无法查询。

## 人工核对

沿用现有页面，添加一个内联核对区：

1. 重新读取当前事实；读取失败仍保留 pending。
2. 读取成功后可浏览终态、分页、目标/行动/周期详情与成长记录。写操作仍被 pending 阻止。
3. 本人明确勾选“我已核对当前页面事实，确认解除本地待确认状态”后解除。
4. 在同账户 Web Lock 内重新核对完整封套，在单个 IndexedDB readwrite 事务中比较后删除，再读取业务事实。

解除只移除本机记录，不撤销或伪造服务端结果，不重提命令，不生成 requestId。封套被替换、锁被占用、删除失败、核对读取失败均撤销读取资格。身份切换及旧请求沿用现有生命周期隔离。

## 验证

原最小回归已在修复前运行失败：页面加载 pending 后期望收到原封套命令，实际为 `[]`，持续冻结。最终实现的固定 SHA、双轴评审、CI 和本地结果集中记录在 PR #226。

使用 Node v24.22.1，主要入口：

```sh
npm run test:api -- --maxWorkers=1
npm run build
npm run check:secrets
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium PLAYWRIGHT_PORT=5224 \
  npm run test:browser -- tests/browser/adventure-pending-recovery.spec.ts \
  tests/browser/adventure-confirmation.spec.ts tests/browser/adventure-goal-relations.spec.ts
POSTGRES_BIN=<PG17-bin> POSTGREST_BIN=<PostgREST> LD_LIBRARY_PATH=<动态库目录> \
  TMPDIR=<工作区专用临时目录> node tests/support/run-recurring-database.mjs --browser
```

覆盖未送达、响应丢失、六路并发只写一次、历史完成已撤销后仍返回原回执、不重复奖励、版本/跨天明确拒绝、旧命令缺失、完整封套预算、存储/锁/账户/坏响应保护，以及核对时只读浏览。

2026-11-16 简化版代码 `ebca2c1` 已验证：全量 API 504 通过、245 个环境依赖跳过；相关浏览器 99/99；真实 PG17/PostgREST/Worker HTTP 103/103、SQL 11 组及并发读取 600 次通过。规范与需求双轴对 `739488c...ebca2c1` 均无阻塞；按评审修正文档中的选路归属，按真实浏览器结果修正复用 commands 后的旧请求计数。最终真实浏览器、构建、安全扫描及最终提交 CI 结果集中在 PR #226。

失败运行不计作通过：受限沙箱的 API 本机监听曾报 EPERM，改为允许监听后完整通过；并行重负载时真实库成长测试曾超时，串行重跑 HTTP 103/103；浏览器 fixture 曾漏掉既有 compatibility 响应，补齐后 99/99。首次 CI 的 API 全部断言通过，但现有 Token 采集器产生异步 AbortError；本地同版本完整重跑通过，最终 CI 仍须按最终提交核实。

`docs/evidence/224-recovery/` 保留 1440px/390px 虚构数据截图；不代表用户生产数据或用户验收。普通 API 入口中环境依赖跳过不能替代真实数据库运行器。当前机器 `/tmp` 空间不足，数据库使用工作区 `.cache/db-temp`；浏览器临时 socket 使用其短路径链接。API 采集器安全检查要求真实目录；安全回归副本使用 `/dev/shm/lifespace224`。浏览器、安全预览串行运行，避免共享 Vite 缓存。

代码可通过 revert PR 回退；已明确解除的本地记录不能由回退自动恢复，服务端事实保留。未合并、未发布、未修改生产数据库；发布验收完成前 Issue 保持开放。
