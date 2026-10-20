# 后端验证

> 证据范围：以下是旧单表实现的固定测试或评审记录，不作为当前关系表设计的通过声明。十张物理表、复合外键、有效完成唯一索引、多表事务及服务端能力等尚未实现和验证；当前要求见 [规格](spec.md)、[数据库设计](backend-database.md) 和 [任务映射](coverage.md)。本次只改文档，不重跑运行验收或修改远端状态。

## 本地命令与容量

Node 24.19.0、Vitest v5.0.3：`npx vitest run tests/api/adventure-storage.test.ts tests/api/adventure-http.test.ts`，2 files / 11 tests passed（296 ms）；`npm run typecheck` 通过。后续集成修改仍须最终复跑，不将此结果当作生产验收。

- 首个 HTTP 测试先以404红灯，再实现路由通过；特殊幂等键先暴露重复409，命名空间修复后通过。
- HTTP 测试执行真实 Worker 鉴权、命令、领域和持久适配器，仅外部 Auth/PostgREST 网络边界模拟。覆盖A/B隔离、猜ID、未知结果重试、稳定结果与最新状态、同key异命令、同key并发、CAS冲突、refresh有限重算、严格字段／128KiB、服务端上海午夜结算及重复发奖防护。
- Astra容量回归先证实超额CAS仍会提交，再验证修复：完整候选行（含state、journal、owner、version、updated_at）按UTF-8计数，超过8,000,000 bytes在写入前返回容量错误且不发送PATCH；旧行新实例可读。32,000,000 bytes外部响应上限为格式与内存留余量；覆盖恰好预算、少一字节拒绝、中文UTF-8和生产预算约束。
- **尚未验证**：128MB真实Worker中接近8MB聚合的解析／克隆峰值。容量约束不是无限历史承诺，不裁剪journal或历史。

## 真实数据库

2026-10-19，用户明确授权现有Supabase `personal_os` 新增专用冒险表和权限后执行。原自动审批拒绝已通过具体授权解决；没有换通道绕过。事前元数据确认新表不存在。

- `apply_migration(create_adventure_states)` 成功，迁移版本 **20261019035109**；SQL来源 `db/adventure/create-state.sql`。只新增该表，不修改旧 tasks/schedules 或用户数据。
- 已执行 `db/adventure/verify-permissions.sql`：anon、authenticated 的SELECT/INSERT/UPDATE/DELETE均触发42501；service_role可SELECT/INSERT/UPDATE、不能DELETE；旧version CAS零行、ignore-duplicates不覆盖。独立随机探针行事务ROLLBACK，四项结果均true。
- 独立元数据核对：`rls_enabled=true`、`anon_no_grants=true`、`authenticated_no_grants=true`、`service_minimum_grants=true`。
- security advisor：本表只有INFO `rls_enabled_no_policy`，符合禁止浏览器直连、仅service_role的策略，不能为消除提示扩大授权。[提示说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。既有表和Auth提示没有修改。

## 实际PostgREST HTTP

使用正式 `AdventureStore` 和真实网络，通过预先确认不存在的随机owner进行隔离验证；凭据仅在进程内复用必要 `SUPABASE_SECRET_KEY`，URL来自公开配置，无密钥值输出，没有写入或覆盖任何.env文件。

以下六项实际HTTP结果全部true：

1. `initial_zero`：新行version0、空主线。
2. `real_http_cas_one_winner`：两个同版本PATCH恰好一个成功。
3. `fresh_store_reads_committed`：独立Store实例读回已提交state、version1和journal。
4. `stale_cas_zero_rows`：旧版本条件PATCH返回零行。
5. `ignore_duplicates_http_ok`：再次POST相同owner成功。
6. `ignore_duplicates_preserves_version_and_journal`：state、version和journal未被初始化覆盖。

finally通过MCP精确删除自己的随机测试owner行：`own_probe_rows_cleaned=1`；独立读回 `isolated_probe_cleaned=true`。未扩大service_role DELETE grant，没有留下测试行。SQL角色探针验证真实anon/authenticated权限；不冒称已运行真实用户JWT的HTTP测试。

本地执行证据保存在忽略目录 `.cache/adventure-db-http-evidence.json`，无凭据或真实用户内容。原checkout `.dev.vars`仅提供service-role所需键；预览未复制配置、未启动端口，Auth公开配置与本地邮箱由主agent另行安排。

## 契约

- GET `/api/adventure` → `{state,version,today}`；只初始化缺失账户，不执行业务结算。
- POST `/api/adventure/commands` ← 严格 `{requestId,expectedVersion,command}`，成功返回读取字段及`result`。普通版本冲突／异payload同key为409；未知结果沿原key重试。journal不进入公开响应。
- 时间固定服务端Asia/Shanghai；客户端不能发送owner、state、XP或替代today。
- 已核对 [Supabase upsert](https://supabase.com/docs/reference/javascript/upsert)、[PostgREST Tables and Views](https://docs.postgrest.org/en/stable/references/api/tables_views.html)、[Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。
