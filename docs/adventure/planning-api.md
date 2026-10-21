# 规划与一次性任务接口

适用 Issue #54、#55；实现与本机隔离验收已完成，现有 Supabase 验收库尚未同步 #55 函数。页面读取、创建／编辑与任务完成／取消使用五表事务；账户、规划日期、版本、能力和成长由后端返回。浏览器不能直接调用表或 RPC。

## 页面查询

`GET /api/adventure?page=1&pageSize=20&taskRange=today&taskPage=1`

参数仅允许目标页 `page`（1–1,000,000）、共享页容量 `pageSize`（1–50，默认 20）、任务日期范围 `taskRange`（today／future／past，默认 today）和任务页 `taskPage`（1–1,000,000，默认 1）。首次查询安全初始化账户，不预建独立区，不导入旧单表或演示数据，不触发结算。

响应由 `src/shared/adventure-planning.ts` 定义：

- `version`、`today`：账户版本及服务端上海日期。
- `mainlines`：全部在用普通主线；最多五条，包含改名／结束能力。
- `goals`：本页进行中真实目标，包含名称、`standards` 标准数组、归属、创建时间及操作能力；不返回 inbox。
- `page`、`pageSize`、`totalGoals`：当前页及全量目标总数；列表为空不代表总数为零。
- `destinations`：可用普通主线 ID；归属留空即默认独立目标，不显示独立身份选项。
- `tasks`、`totalTasks`、`taskPage`、`taskRange`：当前范围和页的任务、全量总数；每项含名称、说明、执行日、状态、真实目标或独立身份、当前具体完成事件 ID、冻结 `reward`（无有效完成为 null）、服务端逾期标记及操作能力。
- `growth`：总经验、等级、本级进度、升级所需经验、有效行动数、达成目标数，以及七个实时成就的当前计数和点亮结果。
- `capabilities`、`limits`：页面能力、禁用原因及输入限额。当前未交付操作返回 `allowed=false` 和原因。

内部使用 `adventure_workspace_read`，持有与基础规划读取相同的账户共享锁；以锁后一次日期统一任务范围、逾期及能力，成长由单一 SQL 函数计算。任务按执行日、创建时间及 ID 排序；主线按创建时间及 ID 排序；目标按保存的 `sort_order`、ID 排序。聚焦和手动排序操作不在本票开放。

## 操作预览

`POST /api/adventure/preview`

```json
{
  "expectedVersion": 0,
  "command": {"type": "createMainline", "name": "健康"}
}
```

预览校验输入、当前版本、归属和配额，返回 `version`、`today`、`allowed=true`、`requiresConfirmation=false` 及说明。不初始化账户、不写业务行或回执、不推进版本。取消任务完成时 `requiresConfirmation=true`，同时返回具体 `completionId`、原事件的冻结 `reward`、`growthBefore`、`growthAfter`；两者含经验、等级、行动数和七个成就结果。确认命令使用此预览版本；409 后重读并重新预览，不静默换用新版本。失败返回与命令相同的业务错误；提交仍重新校验。

## 业务命令

`POST /api/adventure/commands`

```json
{
  "requestId": "a-stable-request-id",
  "expectedVersion": 0,
  "command": {"type": "createMainline", "name": "健康"}
}
```

| type | 其他字段 |
|---|---|
| `createMainline` | `name` |
| `renameMainline` | `id`、`name` |
| `createGoal` | `destination`（空字符串默认独立目标，或普通主线 UUID）、`title`、`standards` |
| `editGoal` | `id`、`destination`（规则同上）、`title`、`standards` |
| `createTask` | `title`、`description`（可空）、`plannedOn`（有效 YYYY-MM-DD）、`destination`（空字符串默认独立任务，或真实目标 UUID） |
| `editTask` | `id`、`title`、`description`（可空）；只编辑待完成任务的名称与说明 |
| `completeTask` | `id`；只允许服务端上海当天的待完成安排 |
| `cancelTaskCompletion` | `completionId`；定位具体完成事件，不接受仅凭任务 ID 取消 |

名称去除首尾空白后必填，最多 200 个 UTF-16 码元。完成标准为 1–50 项数组；空白项由前端在提交前排除；后端接收最多 50 项并同样过滤空白项，过滤后至少保留一项，每项去除首尾空白后最多 4,000 个 UTF-16 码元。`id` 必须为 UUID；`requestId` 为 8–128 位英文、数字、下划线或连字符。版本必须为非负 JavaScript 安全整数。封套和命令均拒绝额外字段，不接受客户端 owner、日期、经验、事件或整包状态。

前端目标归属默认显示“默认独立目标”，提交空字符串；后端负责创建或复用唯一独立主线及 inbox，再写入真实目标。普通主线 ID 必须属于当前账户且在用。编辑目标可清空归属转为独立目标；不能把真实目标直接指向 inbox。

任务归属留空即默认独立任务，页面不提供独立身份选项；提交真实目标 UUID 时归属该目标。任务说明最多 4,000 个 UTF-16 码元。`plannedOn` 是用户安排的执行日期；权威当天、完成时间、经验和状态均由后端确定。过去／未来安排可查询，但不得补写或提前完成；过去尚未完成仍是待完成。独立任务由后端复用 inbox，不展示为真实目标。

成功仅返回稳定回执：

```json
{
  "version": 1,
  "result": {"entityId": "00000000-0000-4000-8000-000000000054", "message": "已创建"}
}
```

任务命令的 `result` 另含 `growthChange`：服务端经验变化、成长前后结果及点亮／不再点亮的成就名称；提示文案由后端返回。完成只写一条 task_completed，在该事件保存 amount 和 calculation；`result.completionId` 与 `result.reward` 返回具体完成及冻结奖励，取消回执也返回原完成的冻结奖励。创建／编辑时这两个字段为 null。取消保留旧事件并逻辑失效该完成及内嵌奖励。取消后再完成生成新事件，旧成功请求仍返回原回执，不影响新事件。当前及完成发生时上级终态、过去完成均锁定取消。

`reward={amount,calculation}`；任务 calculation 为 `{type:"fixed_task",completionId,count,coefficient}`，本期新完成冻结 amount=1、count=1、coefficient=1。历史读取及取消按冻结金额和依据，不重算。`growthChange.xpDelta` 为有符号安全整数；预览与回执中的取消扣减使用原冻结 amount。

目标达成 #59 尚未开放命令；共享 `goalRewardSchema` 约定 `{amount,calculation:{type:"goal_actions",actionIds,count,coefficient,fallback}}`，count 为 N、coefficient 为 C，actionIds 是去重后的稳定行动／task ID；来源内容与归属保存在达成事件 snapshot。一次达成只写一条 goal_achieved，不可撤销。

同一账户按账户行锁串行写入。数据库规范化 JSONB 并计算命令摘要；相同 requestId 和命令返回原回执，即使当前账户已有更新，也不重做操作。同 key 异命令拒绝。实体、事件、版本和成功回执同事务提交，任何中途失败全部回滚。

全局操作反馈统一使用单份浮动 toast：成功约 4 秒自动消失，错误可手动关闭；关闭提示不取消待恢复操作，弹窗内保留可键盘访问的恢复按钮。页面不提供日常刷新按钮。

前端在成功后重新查询页面；读取结果不得早于已知成功版本。成功但查询失败时只重试查询；网络结果未知时只允许用户以原封套安全重试。409 后重新读取并等待用户再次确认，不自动重放。请求只保存在当前页面内存，刷新后读取服务端，不重建旧操作。

## 错误和预算

响应统一为 `{"error":{"code":"…","message":"…"}}`。

| HTTP | code |
|---|---|
| 400 | `INVALID_QUERY`、`INVALID_COMMAND`、`COMMAND_TOO_LARGE`、`MAINLINE_LIMIT`、`READ_ONLY`、`DATE_LOCKED`、`TASK_NOT_PENDING`、`CAPACITY_REACHED` |
| 401／403 | 现有 `AUTH_*` 身份和准入错误 |
| 404 | `NOT_FOUND`；不区分他人内容与不存在 |
| 409 | `VERSION_CONFLICT`、`REQUEST_ID_REUSED`、`COMPLETION_CHANGED` |
| 503 | `ADVENTURE_UNAVAILABLE`；不返回数据库原文、上下文或凭据 |

命令／预览请求体最多 32 KiB，读取请求体最多等待 5 秒；内部 RPC 响应读取上限 1 MiB，数据库页面序列化预算 1,000,000 字节。超限拒绝，不裁剪历史或回执。数据库账户锁最多等待 3 秒；Worker 上游请求及响应体读取各设 10 秒上限，页面操作总等待最多 15 秒。超时后的命令按结果未知处理。

本模块尚未上线，新环境只执行 `db/adventure/create-planning.sql` 建立当前结构，不串行执行开发阶段的升级脚本。该脚本仅用于空库初始化，不对已有表重复执行；本轮不更新现有验收库结构或数据。五表启用 RLS，无浏览器策略；浏览器角色没有表权限或函数执行权限。事务函数为固定 `search_path` 的 `SECURITY INVOKER`，仅后端角色可执行；后端只授予表的 SELECT／INSERT／UPDATE，不增加 DELETE。
