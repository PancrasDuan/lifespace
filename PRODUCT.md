# LifeSpace

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

获准登录 LifeSpace 的个人使用者，通过电脑和手机浏览器管理日常信息。

## Product Purpose

围绕个人日常信息提供首页、新闻与人生冒险。拟新增个人账单明细，方便使用者手动记录和回看自己的收支。

## Operating Context

账单使用现有访问账户隔离数据，包含新建、查看、日期筛选、追加退款和删除。需求来自本次用户访谈，核对稿位于 `docs/ledger/requirements-draft.md`。

## Capabilities and Constraints

每条账单流水独立；仅退款流水关联原支出。采用人民币和北京时间，支出为负、收入为正，退款不改变原支出金额。流水不可编辑，逻辑删除后不可恢复。交易账户暂时自由填写，交易分类采用按普通收支分组的固定单选，具体清单见需求草案。本期只聚焦明细，转账与还款不在本次讨论范围内。

投资理财按实际付款与到账全额记录；充值分类仅用于向其他方充值，本人账户间资金转移不属于充值。

## Evidence on Hand

现有网页实现、`CONTEXT.md`、需求草案与 `docs/adr/0003-ledger-refund-entries.md`。账单原型采用虚构数据，评审选择与当前交互约定记录于 `src/ledger/prototype/README.md`。
