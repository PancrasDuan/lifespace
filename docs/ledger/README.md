# 个人账单文档入口

正式财务页位于 `/finance`，通过现有登录与白名单准入，按访问账户管理普通收支、追加退款、日期筛选、分页和逻辑删除。首版交付记录见 [PR #95](https://github.com/PancrasDuan/lifespace/pull/95)，任务状态以 [#90](https://github.com/PancrasDuan/lifespace/issues/90) 及其子 Issue 为准。

## 接口、实现与验证

| 查找内容 | 入口 |
| --- | --- |
| 当前接口、字段与错误契约 | [api.md](api.md)、[共享契约](../../src/shared/ledger.ts) |
| 正式页面与 Worker 接口 | [src/ledger](../../src/ledger/)、[worker/ledger.ts](../../worker/ledger.ts) |
| 数据库表、事务与权限 SQL | [db/ledger](../../db/ledger/) |
| 自动检查入口、66 条故事归属与实际验证边界 | [verification.md](verification.md) |
| 双轴评审发现、修复与复核证据 | [review.md](review.md) |
| 领域用语与架构决定 | [CONTEXT.md](../../CONTEXT.md#账单术语)、[独立退款流水](../adr/0003-ledger-refund-entries.md)、[撤销跨刷新提交恢复](../adr/0004-ledger-pending-operations.md) |
| 本地认证配置与项目定位 | [认证配置](../auth-setup.md#配置) |

验证与评审文件保留 PR #95 实现阶段的每轮结果；其中“待验收／待部署”指记录当时的交付边界，发布结果查上述 PR。数据库套件的环境门控跳过、定向重跑和完整套件通过分别记录，自动验证不代替真实登录或用户验收。

## 规格与历史设计

| 材料 | 适用范围 |
| --- | --- |
| [issue-spec.md](issue-spec.md) | #90 发布时的规格副本；需求与故事依据，背景描述为实施前状态 |
| [requirements-draft.md](requirements-draft.md) | 规格发布前的需求确认稿 |
| [technical-design-draft.md](technical-design-draft.md)、[database-design.md](database-design.md) | 实施前的技术与两表设计，实际接口和 SQL 查上表 |
| [ticket-drafts](ticket-drafts/README.md) | #91–#94 发布时的任务正文、依赖及覆盖拆分 |
| [UI 原型说明](../../src/ledger/prototype/README.md)、[previews](previews/) | 独立内存原型与设计检查，使用模拟数据 |

历史材料中的“当前／尚未实施／尚未建表”均指相应阶段；保留原始决策与检查结果，正式实现从上方接口、代码和 SQL 入口查找。
