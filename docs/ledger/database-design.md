# 个人账单数据库设计

状态：已确认仅使用流水表与所有者版本表，收入／支出两值与父关联识别退款；尚未建表或执行迁移。采用现有 Supabase PostgreSQL；接口见 [技术方案](technical-design-draft.md)，业务规则见 [需求明细](requirements-draft.md)。

只使用两张表：`ledger_entries` 保存流水并通过创建请求编号去重，`ledger_owner_revision` 处理事务与分页版本。两表均为所有用户共用，通过 `owner_id` 区分数据。

## 1. 流水表 `ledger_entries`

流水只按收入和支出分类；普通收入与退款都记为收入，每笔各占一行。收入是否具有父支出关联，用于识别其是否为退款。

| 字段 | PostgreSQL 类型 | 必填／默认 | 含义 |
| --- | --- | --- | --- |
| `id` | `uuid` | 主键，数据库生成 | 流水唯一标识 |
| `owner_id` | `uuid` | 必填 | 所属访问账户标识，由 Worker 的已验证身份提供 |
| `request_id` | `uuid` | 必填 | 普通新建或退款的创建请求编号，同一次操作重试保持不变 |
| `direction` | `text` | 必填 | 收支方向：`expense` 支出、`income` 收入（含退款） |
| `amount_cents` | `bigint` | 必填 | 人民币金额，单位分；支出负数，收入与退款正数 |
| `occurred_at` | `timestamptz` | 必填 | 实际交易时间，写入精确到秒，按 UTC 表达 |
| `account_name` | `text` | 必填 | 手动填写的交易账户名称，最多 50 个码点 |
| `category_code` | `text` | 必填 | 固定分类代码 |
| `note` | `text` | 必填，默认空字符串 | 可不填的交易备注，最多 500 个码点 |
| `parent_entry_id` | `uuid` | 可空 | 退款关联的原支出标识；普通收入与支出为空 |
| `created_at` | `timestamptz` | 必填，服务端生成 | 这条记录实际创建的时间，与补录交易时间分开 |
| `deleted_at` | `timestamptz` | 可空 | 逻辑删除时间；为空表示未删除 |

`owner_id` 引用 `ledger_owner_revision.owner_id`。它对应现有登录用户的 ID，不是交易账户名称；沿用现有业务的用户归属模式，不新增用户表。

表级约束：

- 金额范围为 `-99,999,999,999` 至 `99,999,999,999` 分，非零；`direction = expense` 必须为负，`direction = income` 必须为正。
- `direction` 只接受 `expense`、`income`。支出的 `parent_entry_id` 必须为空；收入的父流水为空表示普通收入，非空表示退款，不另外存退款类型或标记。
- 保留 `UNIQUE (owner_id, id)`，建立复合外键 `(owner_id, parent_entry_id) → ledger_entries(owner_id, id)`，保证父流水存在且属于同一所有者；外键不使用物理级联删除。
- 建立 `UNIQUE (owner_id, request_id)`，约束包含逻辑删除记录，防止同次创建重复入账或重新创建已删除流水。
- 账户写入前去除首尾空白，必须非空且最多 50 个码点；备注同样规范化且最多 500 个码点。数据库使用长度约束，不依赖截断保存。
- 普通支出与普通收入分别限定分类；有关联父支出的退款收入固定继承父支出分类，不套用普通收入分类清单。

事务函数负责需要读取其他行的业务校验：父流水必须是当前用户未删除的普通支出；退款时间不早于父时间且不晚于当前时间；累计有效退款不超原支出绝对值；账户与分类从父流水复制。普通流水的未来时间也在写入时校验。

普通新建接口不接收父流水标识；登记退款接口必须指定父支出，并固定写入 `direction = income`。退款仍单独展示，可通过父关联推导退款身份。

业务角色只通过受控函数创建或逻辑删除；原始交易字段不授予修改能力，不授予物理删除能力。逻辑删除只写 `deleted_at`，不会更改原金额、时间、账户或分类。

### 分类代码

中文显示名继续使用已确认清单，数据库保存稳定代码，不额外建立分类管理表。

| 普通流水方向 | 显示名与代码 |
| --- | --- |
| 支出 | 交通 `transport`、住宿 `accommodation`、餐饮 `dining`、购物 `shopping`、人情支出 `gift_expense`、充值 `top_up`、订阅 `subscription`、投资理财 `investment`、其他 `other_expense` |
| 收入 | 工资 `salary`、兼职 `part_time`、投资理财 `investment`、人情收入 `gift_income`、二手转卖 `secondhand_sale`、其他收入 `other_income` |

退款保存父支出的分类代码与账户名称。收支方向直接使用 `direction`；退款身份与交易状态作为接口返回字段计算，不增加重复存储列：

- `direction = expense` 显示支出，`direction = income` 显示收入；存在父支出关联的收入额外显示退款身份。
- 普通收入、退款状态为已完成。
- 普通支出汇总全部未删除关联退款：累计为零则已完成，小于原金额绝对值则部分退款，等于则全部退款。

示例：

| 标识（示意） | `direction` | `amount_cents` | `parent_entry_id` |
| --- | --- | --- | --- |
| E1 | expense | -10000 | 空 |
| E2 | income | 3000 | E1 |
| E3 | income | 7000 | E1 |

这代表支出 100 元、退款 30 元、再退款 70 元。E1 始终保留 `-10000` 分，状态计算为全部退款；删除 E3 后，E1 状态重新计算为部分退款。E1／E2／E3 为易读示意，真实标识使用 UUID。

## 2. 所有者版本表 `ledger_owner_revision`

每个使用过账单的用户一行。该表不是储蓄卡、信用卡等交易账户。

| 字段 | PostgreSQL 类型 | 含义 |
| --- | --- | --- |
| `owner_id` | `uuid` | 主键，现有访问账户 ID |
| `revision` | `bigint` | 列表版本，初始 0，每次成功的新写操作加 1 |
| `created_at` | `timestamptz` | 元数据创建时间 |
| `updated_at` | `timestamptz` | 最近一次成功写操作时间 |

所有字段必填，版本范围限制在接口安全整数内。首次写入时创建该用户行；查询尚无数据的用户返回空列表与版本 0。

事务先锁这行，再完成请求查重、退款或删除校验、流水写入和版本递增。没有实际产生新变更的重复请求不递增版本。读取列表时使用同一行的共享锁，保证列表、总数和版本一致；不把整个账户旧版本作为普通新建的前置条件。

## 基本防重复处理

- 创建普通流水或退款时，先在该所有者的全部流水中按 `request_id` 查重，包含已逻辑删除的记录；退款查重先于父流水当前有效性与退款余额校验。
- 命中相同请求编号时，比较与原请求对应的不可变字段。内容相同返回原流水标识和当前列表版本，不再插入或递增版本；内容不同拒绝复用该编号。已删除记录只返回必要操作结果，不回传交易正文。
- 不同真实交易使用不同请求编号，即使金额、时间等字段完全相同，也允许分别保存。
- 删除按所有者与目标流水标识执行。目标已经逻辑删除时直接返回成功，不再次删除、不递增版本；首次删除仍须核对影响范围并在同一事务处理父子流水。
- 不另建操作回执或操作日志表，不承担跨刷新恢复。

## 索引

除主键和唯一约束外，增加两个日常查询索引：

```sql
-- 日期筛选及交易时间倒序分页。
create index ledger_entries_active_time
  on public.ledger_entries (owner_id, occurred_at desc, id desc)
  where deleted_at is null;

-- 查询关联退款和计算有效退款金额。
create index ledger_entries_active_refunds
  on public.ledger_entries (owner_id, parent_entry_id)
  where deleted_at is null and parent_entry_id is not null;
```

这段 SQL 是设计示意，当前没有执行。查询必须包含对应的未删除条件。

## 权限与边界

两表开启 RLS，不给浏览器的 `anon`、`authenticated` 角色开放业务表或函数权限。Worker 通过现有服务端调用链访问；服务端角色可以绕过 RLS，因此事务函数仍必须显式限定所有者。流水写入、退款校验、父子删除和版本变更使用同一次数据库提交；不新增账户体系、分类管理、备份或跨刷新恢复模块。

类型、约束及部分索引依据：[PostgreSQL 数值类型](https://www.postgresql.org/docs/current/datatype-numeric.html)、[约束](https://www.postgresql.org/docs/current/ddl-constraints.html)、[部分索引](https://www.postgresql.org/docs/current/indexes-partial.html)。
