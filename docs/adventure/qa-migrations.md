# #60 目标与任务迁移验收

日期：2026-10-22。分支 `codex/53-adventure`，评审基线 `a6ff08a`。仅使用新建本机临时 PostgreSQL／PostgREST、正式 Worker HTTP 和受控身份；真实 Supabase 未连接。

## 验收对照

| 场景与步骤 | 页面预期 | DB 预期 |
|---|---|---|
| 创建两条主线、一个聚焦目标及任务，详情迁移至另一主线后刷新 | 同目标和任务移至新位置，标准、聚焦和日期不变，目的同类组末尾 | goal ID／task ID 不变，仅目标 mainline_id／sort_order 更新；一条 goal_migrated，revision +1；不创建普通主线或真实目标 |
| 目的已有三个聚焦目标，打开迁移；取消弹窗 | 候选禁用并说明满额；不自动取消聚焦；取消无变化 | 候选和取消不写事实、事件或版本；直接提交返回 FOCUS_LIMIT，事务不留部分变更 |
| 完成任务后从目标 A 迁往 B，再转独立任务并刷新 | 状态、日期和奖励保留；当前归属更新，完成时来源仍显示 A；A 详情显示已迁出项 | tasks.goal_id 更新；完成事件整行不变，amount／calculation／历史归属不变；独立任务复用唯一 inbox；迁移事件无奖励 |
| A、B 达成预览 | A 保留历史行动，B 不补记迁入前行动 | goal_reward 按完成事件历史 goal_id 计 N；达成冻结 actionIds 和来源，迁移不增 total_xp |
| 原目标达成后操作已迁出任务 | 取消完成和迁移禁用；原任务历史仍可看 | 历史终态锁定拒绝取消与再次迁移，不改完成事件或总经验 |
| 另一个设备争最后聚焦名额／同版本同时完成、迁移、取消或达成 | 仅一个新操作成功；409 后重读候选并重新选择确认 | 账户锁串行，同版本一个新回执，失败无部分事实／事件；不超三个名额 |
| 网络结果未知，安全重试；成功后查询失败 | 安全重试相同操作，查询失败只重新读取 | 原 requestId 回放同回执；不重复迁移或入账，不复活终态 |
| 超过二十个目标候选，进入下一页 | 完整候选分页，换页清除旧选择；不可用项有原因 | owner 范围全量 total、稳定分页，主线不作为任务候选，不泄露他人内容 |

取消旧完成后再迁出、于新归属重新完成时，旧来源目标详情与总数排除已取消事实，不显示新归属奖励；数据库保留失效旧事件和取消记录。

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

需 Node.js 22.12+、本机 PostgreSQL／PostgREST 和 Playwright Chromium。运行器只创建本次临时库，空库初始化后执行 SQL 回滚探针、正式 HTTP 和浏览器，最后审计全部账户经验、版本、有效完成、达成、迁移快照及配额，然后删除临时库。SQL 强制经验核对失败，验证 inbox／独立主线创建、外键迁移、事件和版本整笔回滚；受控 ended 夹具仅存在于回滚事务。截图位于忽略目录 `.cache/adventure60-migrations-1440.png`、`.cache/adventure60-migrations-390.png`。

## 结果与评审

| 检查 | 结果 |
|---|---|
| 密钥扫描 | 本地可达历史及当前 Git 文件通过；提交钩子另扫描最终暂存内容 |
| 隔离数据库完整链路 | 空库初始化、全部 SQL 探针、22 项真实 HTTP、8 项桌面／手机浏览器及全量 DB 审计通过 |
| 全站 API | 156 通过、28 环境跳过；22 项隔离用例已在上行实际运行，另外 6 项在线用例未运行 |
| 安全检查 | portable 安全回归 1／1、密钥钩子／历史扫描自测 1／1 通过 |
| 类型与构建 | typecheck、生产 build 通过；仍有原有客户端 chunk 超过 500 kB 提示 |
| 全站浏览器 | 155 通过、10 环境跳过；8 项隔离 DB 浏览器已另行运行，2 项真实账户用例未运行 |
| 差异检查 | git diff --check 和暂存差异检查通过；不提交 .scratch、预览脚本、截图、配置或缓存 |

首条迁移 HTTP tracer 在原实现返回 400，原有 16 项通过；实现后该条转绿。评审修复后重跑完整隔离链路，以及全站 API、安全、类型、构建和浏览器回归。

### 规范轴

独立初审指出历史查询使用失效完成选中迁出任务，可能展示新归属的完成；已让列表和总数统一排除失效事件，并补 HTTP 及桌面／手机回归。另一个判断性重复展示 smell 已通过共用 PlanningCompletionOrigin 修复。原评审者只读复核确认两项关闭，无新增硬问题或需单列 smell。

### 需求轴

独立初审同样发现取消旧完成后原目标历史可能显示新归属奖励；修复后确认 P2 关闭，最新增量无需求缺失或超范围。静态评审与主执行者的实际测试分别记录。

本轮预览为 `http://127.0.0.1:5192/adventure`，使用专属新建临时库和受控身份；页面及正式 Worker 读取 HTTP 200，已打开并保留浏览器。旧 5190 预览及数据保留。

## 限制

本票不开放结束或误建删除，不开放完整成长流水页面；只展示任务冻结完成来源与目标迁出历史。现有 Supabase RPC、索引及真实数据等上线前另行同步。本地受控身份验证不替代真实 JWT、人工或发布验收；不推送、不合并、不部署、不关闭 Issue。
