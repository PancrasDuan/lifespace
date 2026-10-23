# 规划与一次性任务接口

适用 Issue #54、#55、#65、#59、#60、#66、#61、#62；实现和本机隔离验证范围见相应验收报告，现有 Supabase 验收库不在本轮同步。页面读取、生命周期命令与任务完成／取消使用五表事务；账户、规划日期、版本、能力和成长由后端返回。浏览器不能直接调用表或 RPC。

## 页面查询

`GET /api/adventure?page=1&pageSize=20&taskRange=today&taskPage=1&taskScope=all&search=&includeTerminal=false`

参数仅允许目标页 `page`（1–1,000,000）、共享页容量 `pageSize`（1–50，默认 20）、任务日期范围 `taskRange`（today／future／past，默认 today）、任务页 `taskPage`（1–1,000,000，默认 1）、`taskScope`（all／focus，默认 all）、`search`（去除首尾空白后最多 100 个 UTF-16 码元，默认空）及 `includeTerminal`（true／false，默认 false），可选 `goalId`（真实目标 UUID）及 `goalTaskPage`（1–1,000,000，默认 1）。首次查询安全初始化账户，不预建独立区，不导入旧单表或演示数据，不触发结算。

可选 `mainlineId`（普通主线 UUID）返回 `mainlineDetail`，将 `goals`、`totalGoals` 和 `page` 限定为该主线全部目标历史（包含终态，独立于显示开关）。`/adventure?mainlineId=<uuid>` 可刷新、分页并进入目标详情；非本账户或系统独立区返回 404。`mainlineDetail` 含状态、结束时间及操作能力，已结束主线只能查看。

响应由 `src/shared/adventure-planning.ts` 定义：

- `version`、`today`：账户版本及服务端上海日期。
- `includeTerminal`：本次查询是否包含终态目标与已结束主线。
- `mainlines`：默认仅在用普通主线；开启 `includeTerminal` 后追加已结束主线。每项含 status、endedAt、改名／结束能力；在用主线最多五条。
- `goals`：默认本页进行中真实目标；开启 `includeTerminal` 后在所属主线组末尾追加已达成／已结束目标。每项含名称、`standards`、归属、创建时间、状态、终态时间、`focused`、`sortOrder`、全日期目标任务 `progress` 及操作能力；不返回 inbox。
- `page`、`pageSize`、`totalGoals`：当前页及全量目标总数；列表为空不代表总数为零。
- `destinations`：可用普通主线 ID；归属留空即默认独立目标，不显示独立身份选项。
- `tasks`、`totalTasks`、`taskPage`、`taskRange`：当前范围和页的任务、全量总数；每项含名称、说明、执行日、状态、真实目标或独立身份、当前具体完成事件 ID、冻结 `reward`（无有效完成为 null）、服务端逾期标记，以及编辑、完成、取消、迁移、结束、误建删除等操作能力。逻辑删除任务不返回。
- `taskScope`、`search`、`taskProgress`：当前视图、已提交搜索条件及完整筛选范围的任务进度；分页不截断分母。
- `goalDetail`：指定 `goalId` 时返回该账户目标的只读详情（包含终态），其 `goal` 含 status、terminatedAt 和冻结 achievement；tasks 按全部日期分页，totalTasks 为当前归属该目标或仍有该目标有效完成事实的未删除任务去重总数；迁出项标注当前归属和冻结完成来源，目标 progress 仍只统计当前归属，taskPage 为 goalTaskPage。与页面同事务、同版本；不属于账户或为 inbox 返回 404。
- `growth`：总经验、等级、本级进度、升级所需经验、有效行动数、达成目标数，以及七个实时成就的当前计数、差额和点亮结果。
- `capabilities`、`limits`：页面能力、禁用原因及输入限额。当前未交付操作返回 `allowed=false` 和原因。

内部使用 `adventure_workspace_read`，持有与基础规划读取相同的账户共享锁；以锁后一次日期统一任务范围、逾期及能力，成长由单一 SQL 函数计算。任务按执行日、创建时间及 ID 排序；在用主线按创建时间及 ID 排序，已结束主线排在其后并按结束时间倒序；目标先按所属主线创建时间及 ID 分组，同归属内进行中在前（先聚焦后未聚焦，再按 `sort_order`、ID），终态目标在组末按终态时间倒序。普通主线与独立目标组各有 3 个聚焦名额；inbox 不可聚焦。`focus`、`moveUp`、`moveDown`、`end`、`delete` 能力由数据库返回，前端不自行判断名额、日期资格或相邻边界。

任务的 completionOrigin 从当前有效完成事件返回 goalId、mainlineId、goalTitle、mainlineName、title、description、plannedOn、occurredOn；无有效完成为 null。它与当前 goalId／goalTitle／mainlineName 分开展示，迁移不重算或改写冻结奖励。

任务视图按当前归属筛选：focus 包含聚焦目标任务及独立任务，all 包含全部任务；日期和搜索条件对两种视图同时生效。搜索是名称／说明的忽略大小写字面子串，不把 `%`、`_` 当作通配符。`taskProgress` 使用相同日期／视图／搜索范围，统计 completed／(pending＋completed)，排除 ended、已删除和无效完成。目标 `progress` 使用该目标当前归属下的所有日期任务；二者均在分页前统计。ratio 为 null 时显示“暂无可统计任务”，不自动达成目标。刷新页面恢复默认全部／今天／空搜索，已保存聚焦及顺序从数据库回读。

## 迁移候选

`GET /api/adventure/migration-options?kind=goal&id=<uuid>&page=1`，kind 可为 goal／task，page 范围 1–1,000,000。独立 RPC `adventure_migration_options` 在账户共享锁内读取，不创建容器或写回执。响应含 version、kind、entityId、page、固定 pageSize=20、total、options。每项为 id、name、capability（allowed、不可选时 reason）。goal 候选为普通主线与空字符串独立身份；task 候选为全部真实目标与空字符串独立身份。当前归属、终态、历史锁定或满额项保留原因但不可选；候选按名称及稳定 ID 分页，不使用页面当前 goals 页充当全部候选，不返回其他账户内容。

迁移弹窗按候选版本提交，版本不同禁止确认。409 后重读当前事实及候选，清除旧选择，必须重新选择确认；网络结果未知仅重试原封套；成功后查询失败仅重新读取。

任务项含 `rescheduleMin`（服务端当天）、`totalArrangements` 和按发生版本顺序排列的前 5 项 `arrangements` 日期摘要（id、kind、sourceEventId、oldPlannedOn、newPlannedOn、occurredAt）。创建项 oldPlannedOn／sourceEventId 为 null；改期指向上一条创建／改期事件，不指向编辑或迁移。任务列表及目标任务详情可展开日期并进入完整历史；不向列表重复装载历史长说明。

`GET /api/adventure/task-history?id=<task UUID>&page=1` 返回 version、taskId、title、page、pageSize=5、total 和 items。每项在日期摘要之外返回发生时 title、description、goalId、goalTitle、mainlineId、mainlineName。参数 page 为 1–1,000,000，默认 1，跨 owner／已删除任务返回404。数据库在账户共享锁内读同一版本；只对 service_role 授予函数执行权限，浏览器经 Worker 读取。`/adventure?taskId=<uuid>` 可刷新打开安排历史和分页，不受终态显示开关影响。完整历史存于事件，每页返回上限明确，原始快照不随当前名称或归属变化；单次响应仍受序列化预算约束。

## 操作预览

`POST /api/adventure/preview`

```json
{
  "expectedVersion": 0,
  "command": {"type": "createMainline", "name": "健康"}
}
```

预览校验输入、当前版本、归属和配额，返回 `version`、`today`、`allowed=true`、`requiresConfirmation=false` 及说明。不初始化账户、不写业务行或回执、不推进版本。取消任务完成时 `requiresConfirmation=true`，同时返回具体 `completionId`、原事件的冻结 `reward`、`growthBefore`、`growthAfter`；两者含经验、等级、行动数和七个成就结果。确认命令使用此预览版本；409 后重读并重新预览，不静默换用新版本。失败返回与命令相同的业务错误；提交仍重新校验。

目标达成预览为 `requiresConfirmation=true, operation=achieveGoal`，返回 goalId、title、standards、version、today、三档 `rewards`（每档含完整冻结奖励依据）及全量 `stoppingTasks`（id、title、plannedOn）。前端仅选择服务端返回的评价档位并展示金额，不能自行计算 N 或奖励。预览无写入；取消不变更业务状态。确认前提示需继续的任务先迁出；版本冲突后旧确认禁用，必须重新预览。

结束目标或主线预览为 `requiresConfirmation=true`，`operation` 为 `endGoal`／`endMainline`，返回稳定 entityId、title、全量 `stoppingGoals`、全量 `stoppingTasks`，以及 `preservedCompletedTasks`／`preservedAchievedGoals`。任务结束／误建删除预览也返回 `requiresConfirmation=true`，`operation` 为 `endTask`／`deleteTask`，并返回目标、执行日与历史安排计数。结束只停止当前归属下未删除的 pending 任务，不撤销完成、达成或经验；预览不写业务事实。

改期预览为 `requiresConfirmation=true, operation=rescheduleTask`，返回 taskId、title、oldPlannedOn、newPlannedOn、sourceEventId、version、today 和说明；不写入事实。输入与终态检查复用最终命令校验。用户先输入日期、预览后确认；修改日期使旧预览失效，409 后须重新预览，不能自动换版本提交。

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
| `endMainline` | `id`；仅在用普通主线；进行中目标及当前 pending 任务同事务进入未达成终态 |
| `createGoal` | `destination`（空字符串默认独立目标，或普通主线 UUID）、`title`、`standards` |
| `achieveGoal` | `id`、`coefficient`（1／2／3，省略默认 1）、`reflection`（最多 4,000 码元，省略默认空）；手动按完成标准达成，无任务或有 pending 任务也允许 |
| `endGoal` | `id`；仅进行中真实目标；未达成结束、退出聚焦并停止当前 pending 任务 |
| `focusGoal` | `id`、`focused`（boolean）；仅进行中真实目标；满额失败不推进版本 |
| `reorderGoals` | `mainlineId`、`id`、`direction`（up／down），可选 `targetId`；同归属同聚焦组相邻移动，拖动时移至 targetId 原位置，中间目标稳定平移；不得跨组 |
| `editGoal` | `id`、`destination`（规则同上）、`title`、`standards` |
| `createTask` | `title`、`description`（可空）、`plannedOn`（有效 YYYY-MM-DD）、`destination`（空字符串默认独立任务，或真实目标 UUID） |
| `migrateGoal` | `id`、`destination`（空字符串为独立身份，或在用普通主线 UUID）；保留聚焦及目标 ID，任务随行，追加目的同类组末尾 |
| `migrateTask` | `id`、`destination`（空字符串为独立任务，或在用真实目标 UUID）；保留 ID、当前日期、状态 |
| `rescheduleTask` | `id`、`plannedOn`；仅任务及当前上级可操作的 pending 任务，日期须在服务端今天或未来，且不同于当前日期 |
| `editTask` | `id`、`title`、`description`（可空）；只编辑待完成任务的名称与说明 |
| `completeTask` | `id`；只允许服务端上海当天的待完成安排 |
| `cancelTaskCompletion` | `completionId`；定位具体完成事件，不接受仅凭任务 ID 取消 |
| `endTask` | `id`；仅 pending 任务；立即结束、不可恢复、不发奖 |
| `deleteTask` | `id`；仅执行日在未来、pending 且从未产生完成／改期事件的任务；逻辑隐藏、不物理删除 |

名称去除首尾空白后必填，最多 200 个 UTF-16 码元。完成标准为 1–50 项数组；空白项由前端在提交前排除；后端接收最多 50 项并同样过滤空白项，过滤后至少保留一项，每项去除首尾空白后最多 4,000 个 UTF-16 码元。`id` 必须为 UUID；`requestId` 为 8–128 位英文、数字、下划线或连字符。版本必须为非负 JavaScript 安全整数。封套和命令均拒绝额外字段，不接受客户端 owner、日期、经验、事件或整包状态。

前端目标归属默认显示“默认独立目标”，提交空字符串；后端负责创建或复用唯一独立主线及 inbox，再写入真实目标。普通主线 ID 必须属于当前账户且在用。编辑目标可清空归属转为独立目标；变更归属复用与 migrateGoal 相同的校验并写 goal_migrated，未变归属仍写 goal_updated；不能把真实目标直接指向 inbox。

任务归属留空即默认独立任务，页面不提供独立身份选项；提交真实目标 UUID 时归属该目标。任务说明最多 4,000 个 UTF-16 码元。`plannedOn` 是用户安排的执行日期；权威当天、完成时间、经验和状态均由后端确定。过去／未来安排可查询，但不得补写或提前完成；过去尚未完成仍是待完成。独立任务由后端复用 inbox，不展示为真实目标。

成功仅返回稳定回执：

```json
{
  "version": 1,
  "result": {"entityId": "00000000-0000-4000-8000-000000000054", "message": "已创建"}
}
```

任务命令的 `result` 另含 `growthChange`：服务端经验变化、成长前后结果及点亮／不再点亮的成就名称；提示文案由后端返回。任务命令完成只写一条 task_completed，在该事件保存 amount 和 calculation；`result.completionId` 与 `result.reward` 返回具体完成及冻结奖励，取消回执也返回原完成的冻结奖励。创建／编辑时这两个字段为 null。取消保留旧事件并逻辑失效该完成及内嵌奖励。取消后再完成生成新事件，旧成功请求仍返回原回执，不影响新事件。当前及完成发生时上级终态、过去完成均锁定取消。

`reward={amount,calculation}`；任务 calculation 为 `{type:"fixed_task",completionId,count,coefficient}`，本期新完成冻结 amount=1、count=1、coefficient=1。历史读取及取消按冻结金额和依据，不重算。`growthChange.xpDelta` 为有符号安全整数；预览与回执中的取消扣减使用原冻结 amount。

目标达成使用共享 `goalRewardSchema`，约定 `{amount,calculation:{type:"goal_actions",actionIds,count,coefficient,fallback}}`，count 为 N、coefficient 为 C，actionIds 是去重后的稳定行动／task ID；来源内容与归属保存在达成事件 snapshot。一次达成只写一条 goal_achieved，不可撤销。回执 result 返回 achievementId、冻结 reward 与 growthChange，目标和事件均保存去重后的稳定行动 ID、N、C、评价和来源快照。N 按完成时目标归属计算，排除已失效完成；N>0 奖励 N×C，N=0 固定 1。达成退出聚焦，未删除 pending 任务同事务进入 ended，已有完成和经验保留，当前及历史归属终态均锁定取消。默认列表隐藏达成目标；`/adventure?goalId=<uuid>` 可刷新进入只读结果、评价及分页任务历史，统一终态开关由生命周期票实现。

结束主线写 `mainline_ended`，结束目标写 `goal_ended`，结束任务写 `task_ended`，误建删除写 `task_deleted`；均不携带 amount／calculation，snapshot 保存 before、after、impact 和 result。结束与删除不扣减经验、不撤销达成、不追加负奖励；目标／主线／任务状态、传播、事件、revision 与回执同一事务提交。已完成任务不能改成 ended；曾完成后再取消、曾产生改期历史的任务均永久失去误建删除资格。普通编辑或迁移本身不视为历史安排。

改期更新同一 tasks 行的 planned_on，追加无金额的 task_rescheduled；snapshot 冻结 before、after、oldPlannedOn、newPlannedOn、sourceEventId、内容／归属和 result。taskId 不变，不新增任务、行动或奖励，growthChange.xpDelta=0。曾改期永久阻止误建删除。过去完成不可取消或改期；当天完成须先合法取消，改期不会恢复被取消的完成。

同一账户按账户行锁串行写入。数据库规范化 JSONB 并计算命令摘要；相同 requestId 和命令返回原回执，即使当前账户已有更新，也不重做操作。同 key 异命令拒绝。实体、事件、版本和成功回执同事务提交，任何中途失败全部回滚。

全局操作反馈统一使用单份浮动 toast：成功约 4 秒自动消失，错误可手动关闭；关闭提示不取消待恢复操作，弹窗内保留可键盘访问的恢复按钮。页面不提供日常刷新按钮。

前端在成功后重新查询页面；读取结果不得早于已知成功版本。成功但查询失败时只重试查询；网络结果未知时只允许用户以原封套安全重试。409 后重新读取并等待用户再次确认，不自动重放。请求只保存在当前页面内存，刷新后读取服务端，不重建旧操作。

聚焦和排序均在账户行锁内校验并更新目标、事件、版本及成功回执，不改经验或目标身份；重试沿用既有幂等规则。现有编辑目标归属入口同样校验目标聚焦名额，跨归属时追加目的手动顺序末尾。

“显示已达成／已结束”默认关闭，开关按 `ownerId` 存在当前浏览器 `localStorage`，刷新保留、不跨设备同步，切换账户使用各自值。它只控制查询是否返回终态列表内容，不阻止按稳定 `goalId` 读取终态详情、任务历史或成长来源。

## 成长记录与冻结来源

`GET /api/adventure/growth` 返回 `{version,growth,pageSize:10,total,items,nextCursor}`。growth 是全账户总经验、等级、本级进度、升级所需、差额、有效行动数、达成目标数及七个实时成就；每个成就含 id、label、threshold、count、remaining、unlocked。没有成就奖励、持久解锁状态或解锁时间。total 是全部有效奖励数，与当前页无关。

items 仅投影有效 task_completed／goal_achieved，含 id、kind、entityId、发生时 title、occurredAt、occurredOn、amount、calculation、mainlineId、mainlineName、mainlineKind、goalId、goalTitle。amount 和 calculation 直接来自事件；目标计算摘要含 type、count、coefficient、fallback，不把完整行动数组塞进流水。事件的回执、before／after 及当前实体不会进入公开奖励响应。升级成本仍为 `20+5×(当前等级−1)`，前端只展示服务端结果。

流水按 `(applied_revision DESC,id DESC)` 排序。后续页使用 `?version=<首屏版本>&cursor=<nextCursor>`，固定每页10条；cursor 为上页最后一条有效奖励事件 ID，非空时必须带 version。version 为非负安全整数；只允许 version、cursor 两个参数。版本变化返回409，前端保留旧快照并要求从首屏重新读取，不能静默拼接不同版本；跨账户或非有效奖励游标返回404。刷新回到首屏。

`GET /api/adventure/reward-source?id=<事件UUID>&page=1&version=<成长版本>` 返回 `{version,event,description,plannedOn,standards,reflection,page,pageSize:5,totalSources,actionSources}`。id 必填，page 范围1–1,000,000，version 可省略，传入时严格核对账户版本。event 与流水摘要相同；正文、安排日期、完成标准、感想取冻结快照。目标计奖来源每页5条，包含 taskId、completionId、发生日、发生时标题／说明／安排与归属；不根据当前事项或规则重建。跨账户、不存在、取消完成来源统一404。终态或日常列表隐藏不影响读取。

两个查询均只读、持账户共享锁，与命令账户锁配合返回同版本统计和事实；无账户的首次读取返回一致空快照且不初始化账户。`/adventure?view=growth` 可直接打开成长页，`/adventure?view=growth&rewardId=<事件UUID>` 可刷新查看冻结来源。流水失败仅重试当前游标，来源及计奖来源分页失败仅重试来源；版本冲突重新读取成长首屏。读取不发奖、不追加事件、回执或版本。

## 错误和预算

响应统一为 `{"error":{"code":"…","message":"…"}}`。

| HTTP | code |
|---|---|
| 400 | `INVALID_QUERY`、`INVALID_COMMAND`、`COMMAND_TOO_LARGE`、`MAINLINE_LIMIT`、`FOCUS_LIMIT`、`SAME_DESTINATION`、`READ_ONLY`、`DATE_LOCKED`、`DATE_STARTED`、`RESCHEDULE_PAST`、`SAME_DATE`、`HISTORY_LOCKED`、`TASK_NOT_PENDING`、`CAPACITY_REACHED` |
| 401／403 | 现有 `AUTH_*` 身份和准入错误 |
| 404 | `NOT_FOUND`；不区分他人内容与不存在 |
| 409 | `VERSION_CONFLICT`、`REQUEST_ID_REUSED`、`COMPLETION_CHANGED` |
| 503 | `ADVENTURE_UNAVAILABLE`；不返回数据库原文、上下文或凭据 |

命令／预览请求体最多 32 KiB，读取请求体最多等待 5 秒；内部 RPC 响应读取上限 1 MiB，数据库页面序列化预算 1,000,000 字节。超限拒绝，不裁剪历史或回执。数据库账户锁最多等待 3 秒；Worker 上游请求及响应体读取各设 10 秒上限，页面操作总等待最多 15 秒。超时后的命令按结果未知处理。

本模块尚未上线，新环境只执行 `db/adventure/create-planning.sql` 建立当前结构，不串行执行开发阶段的升级脚本。该脚本仅用于空库初始化，不对已有表重复执行；本轮不更新现有验收库结构或数据。五表启用 RLS，无浏览器策略；浏览器角色没有表权限或函数执行权限。事务函数为固定 `search_path` 的 `SECURITY INVOKER`，仅后端角色可执行；后端只授予表的 SELECT／INSERT／UPDATE，不增加 DELETE。
