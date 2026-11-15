## Summary

周期任务与一次性行动现在通过同一日期入口管理：周/月/季/年按开始日锚定，每次真实完成生成冻结归属的子任务并入账1XP；合法撤销同步回退，父迁移不改旧子，目标终态先处理全部未结束父。集成固定后端da835b5与前端132e1bf，保留旧四字段恢复协议和goal-categories-1回执头，所有新写使用recurring-1。

```text
正式前端 → Worker → 单事务RPC → 周期父 / 子任务 / 完成事件
                                     └─ XP、计数、revision、成功回执
```

关联 #56、#198、#199、#200、#201；目标分支main。没有集成冲突或共享契约变更；新增验收和隔离预览。分级：需确认（生命周期/奖励/公开契约/迁移）。当前仅本地实施、验证和PR准备授权，远端交付由主会话核对具体授权后处理。

## Evidence

- **Before:** 两端独立fixture/后端证据无法证明浏览器实际完成与数据库事实、奖励和回执一致。
  **After:** 新隔离PG的新库/非空升级/故障回滚/全旧行和回执对账、11组SQL、15RPC600并发读取、99项真实Worker/HTTP、9项真实数据库浏览器均通过，无跳过。浏览器业务经Node app.request认证桥与真实HTTP RPC；未验收线上Auth或业务请求的workerd部署。
- 26个同视口状态已重捕获，25张与独立复审前端逐像素一致，另1张仅两像素差；18项周期fixture与68项旧页面/恢复/外围浏览器通过。[截图与逐状态比较](https://github.com/PancrasDuan/lifespace/blob/codex/201-recurring-integration/docs/evidence/201-recurring-integration/README.md)。真实4/3、旧快照、同ID恢复、异摘要、父子分页/撤销空态及结束只读均验证。
- 普通API383通过/219数据库跳过（单列）；类型/构建、portable安全4项、主安全7项、全历史及当前文件密钥扫描通过。初轮非零/失败的触发和修正保留在[完整验收记录](https://github.com/PancrasDuan/lifespace/blob/codex/201-recurring-integration/docs/adventure/recurring-integration-validation.md)，没有放宽冻结业务预期。
- 合成代表库pg_dump/pg_restore新数据库恢复后，schema/45函数/FK/索引/RLS/ACL/数据/XP/revision/hash全部一致。复用同cluster角色，没有独立globals恢复或生产备份证明。
- **待补充门禁：** 本次最终HEAD独立双轴评审；远端推送/PR与必需validate全部CI；用户界面验收和具体合并/生产迁移/部署授权。当前CI尚未运行，不以本地通过替代。

## Merge Danger

**Door:** one-way after new recurring facts are written.

**Blast Radius:** adventure

增量SQL126905字节/SHA256 cf7ae7fb6cb806c8f3494441b1ab3563f1630fad1946c6db23d8b3531c68c171，新库整份224046字节；两者在本机单连接完整执行。生产实际连接/传输上限尚未核实，不能拆事务或用本地方法成功替代生产完整备份。

[发布门禁与回退](https://github.com/PancrasDuan/lifespace/blob/codex/201-recurring-integration/docs/adventure/recurring-release-plan.md)：具体授权与CI → 通道/完整可恢复备份 → 停流及在途清空 → 单事务迁移/逐行对账 → 同SHA Worker/前端部署 → 受控核验 → 恢复流量。main自动部署时点须与迁移门禁协调；有新周期事实后不能直接退旧Worker或删表，须停流保护新增事实后前向修复/获授权整体恢复。本票未执行上述生产阶段，Issue保持开放。
