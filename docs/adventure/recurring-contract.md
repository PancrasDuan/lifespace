# #198 周期共享契约 v1

状态：2026-11-15，面向 #199／#200 的共同实施依据；共享 schema、纯客户端及契约测试已实现，Worker 路由、SQL 业务及产品 UI 尚未实现。父规格为 [#56](https://github.com/PancrasDuan/lifespace/issues/56)，交付属需确认变更；允许开发、验证、提交和功能分支准备，未授权合并 main、生产迁移或部署。基线为 `7730a2f17ebe5fa6e191637c02429c24692ab84b`。

业务来源固定为 `3a45dab02e59cf1ac486b86a313463acbcbfe2e4` 的 [spec](recurring-spec.md)、[R01–R54](recurring-requirements.md) 和 implementation；只逐文件导入，没有带入原型代码或图片包。来源 ADR0012 与 main 的 MCP OAuth ADR0012 重号，周期领域 ADR 仅重编号为 [0013](../adr/0013-recurring-periods-and-completion-facts.md)，物理决定为 [0014](../adr/0014-recurring-storage-and-counters.md)。approved-v1 的[固定26状态及范围](https://github.com/PancrasDuan/lifespace/blob/d2a0fa4ccb0b52edc44595fd2fc2dff27364df97/docs/evidence/56-recurring-approved-v1/README.md)仍是前端唯一视觉／交互依据；本契约不替代原型。

## 公共入口与命令

共享定义在 `src/shared/adventure-planning.ts`（命令、封套、回执、预览、原一次性类型）、`adventure-recurring.ts`（父／子／分页响应）、`adventure-growth.ts`（奖励来源）、`adventure-client-version.ts`（发布门禁）。客户端入口为 `src/adventure/planning-api.ts` 的 `planningApi`，无原型 bridge、mock 或演示日期导入。所有 HTTP 沿用认证 owner、JSON body、禁止缓存、大小限制及通用错误封套 `{error:{code,message}}`；owner 只由 Worker 注入 RPC `p_owner`。

`POST /api/adventure/commands` 继续接收 `{requestId,expectedVersion,command}`；requestId 为 8–128 位 `[A-Za-z0-9_-]`，revision、计数均为 0..9007199254740991 的安全整数，要求次数为 1..9007199254740991。禁止字符串／隐式取整。名称 trim 后 1..200 字符，通用说明 trim 后 0..4000。`destination` 为目标 UUID 或 `''`（独立身份）；真实目标须为当前 owner 的进行中目标。未传 destination 的编辑保留现归属。

| command.type | command 其余字段（全部严格校验） | 说明 |
| --- | --- | --- |
| createRecurringTask | title, description, periodType, startOn, requiredCount, destination, today | periodType=week/month/quarter/year；创建开始日只可今天或未来 |
| editRecurringTask | id, title, description, requiredCount, today；可选 startOn、destination | 统一编辑／迁移；开始后不得提交 startOn，即使与原值相同；周期类型不可改 |
| recordRecurringCompletion | id（父ID）, today | 直接记录一次；不传子ID、备注、目标、发生日期、奖励或进度 |
| cancelRecurringCompletion | completionId（完成事件ID）, today | 只失效该完成与子任务；不可变成待办或恢复 |
| endRecurringTask | id, today | 仅运行中；立即只读，不可恢复；不清除有效行动 |
| deleteRecurringTask | id, today | 仅未开始且未结束；逻辑删除父，保留审计 |

这些命令进入既有 `planningEnvelopeSchema`、`storedPlanningEnvelopeSchema`、preview 和 command 通道；一次性形状保持不变，新 `today` 只在周期 command 内，不扩展旧命令封套。`planningApi.send` 不自动重试、不生成 requestId、不更新 expectedVersion。#200 必须沿用 pending 持久化、账户互斥与稳定封套；新用户动作生成新 requestId，同一次未知重试保持全部字段不变。

## 权威日期、锁与回执顺序

`today` 必须来自成功服务端页面／详情／列表响应，绝不能取选中日期、设备时间或首页地区。它是用户页面依据，不赋予客户端决定实际日期的能力；服务端在取得账户锁后用一次 `clock_timestamp()` 捕获 `occurredAt` 和 `Asia/Shanghai` 的 `today`，并同时校验 revision。所有新周期写均带该依据，不能用单独 expectedVersion 代替日界校验。

写事务顺序固定：认证 owner → 有界严格解析／规范化 → 账户事务锁 → 按 owner/requestId 查成功记录、比对原规范化摘要 → 若同摘要直接返回原回执 → 捕获权威时间 → 校验 command.today → 校验 expectedVersion → 加载同 owner 关系／能力并执行 → 更新计数、XP、revision 和成功回执 → 提交。旧成功回执优先于日期、版本和当前生命周期；异摘要为 REQUEST_ID_REUSED，不允许把旧 today 换成今天再用旧 requestId。摘要沿用当前规则，不把 expectedVersion 纳入；周期 today 属于 command，必须纳入。

跨天新写返回 HTTP409 `PLANNING_DATE_CHANGED`，无业务写入、无 revision/XP/子任务变化、不创建成功回执。#200 清理该次明确失败的 pending 后提示、回读权威日期／期数／能力，等待用户再次主动操作，不能补交；未知响应保留 pending，先按原封套确认。锁等待跨午夜也按取得锁后的日期处理。

`POST /api/adventure/receipts/lookup` 仍只读、不得在查无回执时落到 command；继续绑定 nonce、requestId、no-store、精确模型头与规范化摘要。`GET /api/adventure/compatibility` **始终只返回**旧四字段 `{model:'goal-categories',version:1,receiptLookup:true,legacyRetry:false}`，不得加周期或写版本字段；新旧客户端都使用该恢复协议。lookup 成功响应**始终使用** `X-Lifespace-Adventure-Model: goal-categories-1`（共享常量 `adventureReceiptModel`），与 command 的 `adventureClientVersion`／recurring-1 写门禁完全独立。周期能力仅在 `planningPage.recurring` 声明，不升级或复用旧恢复探针。所有合法旧一次性、退役命令及五表目标封套的成功回执仍可只读查到；新周期 pending 也走同一只读协议。查不到为未知，不通过换 requestId、today 或版本重做。

服务端必须在写版本切到 recurring-1 后继续支持旧页面的四字段严格解析和旧回执模型头；仅让新客户端兼容旧协议不构成双向兼容。`receipts/lookup` 不要求新写版本头，不经过 command gate，原 owner／规范化摘要／nonce 校验保持；`commands` 与 `legacy-retry` 仍拒绝旧客户端新写，不能借恢复协议放行目标终态、计奖或其他写。#198 现有 Worker 只读接线已引用共享冻结值，未新增周期业务，#199 不得在切换写版本时更改这些值。

## 只读列表、详情与分页

以下为 **#199 待实现** 的正式 POST endpoint；响应 schema 都含 `{version,today,timeZone:'Asia/Shanghai'}`。客户端新方法只请求一次，验证输出 schema 及 version/today 与请求一致；不一致要求回读，不自行接续另一版本的分页。

| endpoint / planningApi 方法 | input | response / RPC |
| --- | --- | --- |
| /api/adventure/recurring/list / recurringList | expectedVersion,today,date,scope,search,page | recurringListSchema；adventure_recurring_list |
| /api/adventure/recurring/detail / recurringParent | expectedVersion,today,id（父） | recurringParentDetailSchema；adventure_recurring_detail |
| /api/adventure/recurring/children / recurringChildren | expectedVersion,today,parentId,page | recurringChildrenSchema；adventure_recurring_children |
| /api/adventure/recurring/child / recurringChild | expectedVersion,today,id（子） | recurringChildDetailSchema；adventure_recurring_child |
| /api/adventure/date-tasks/list / dateTaskList | expectedVersion,today,date,scope,search,page | dateTaskListSchema；adventure_date_task_list |

RPC 参数逐字段加 `p_` 并转 snake_case（expectedVersion→p_expected_version，parentId→p_parent_id）；owner 由 Worker 追加。详情分别用 p_id。query string 必须为空，禁止多余字段。page=1..1000000，默认1，固定10项；scope=all/focus 默认all，focus 沿用“聚焦目标或独立任务”；search trim 后0..100，默认空。固定版本下越界页返回空 items 和真实 total，不静默换页。每个请求账户 share lock 后捕获日期；版本不符 VERSION_CONFLICT，today不符 PLANNING_DATE_CHANGED。读不创建账户、不写计数、不增 revision。响应最大1MB，超限 CAPACITY_REACHED；不能无限聚合全部子任务快照。

`recurring/list` 的 total 包括该 date/scope/search 下所有父对象，父列表只提供一个分页流，按 active、not_started、ended 排序，同组按 created_at,id 升序稳定排列；UI可按状态分区展示，不新增产品视图。今天包含运行中父及当天结束父；未来仅 startOn=date 且真实未开始的父；过去仅 endedOn=date 的结束父。未开始入口随 startOn 移动。运行中父不生成历史或未来预测。搜索匹配父当前 title/description/当前目标 title（独立身份按现有规则）；只读 ended父也用其结束后固定内容。

`date-tasks/list` 为新前端提供一次性任务与**生效子任务**的单一分页，`tasks` 为 `kind=once` 的现有 planningTask 或 `kind=recurring_child`；父另在 recurring/list，不混入行动分母。一次性日期规则沿用现行：过去仅实际完成日，今天含逾期／今日待办及今日有效完成，未来仅该日待办；子任务永远按 snapshot.occurredOn，无未来条目，失效子不在列表。搜索对一次性沿用当前字段，子用冻结 title/description/goalTitle；focus 子按完成时目标当前 focused 状态或独立身份，迁移不改变子归属。排序先逾期一次性、今日／未来待办一次性、有效完成；前两组 planned_on,created_at,id 升序，完成组 occurred_at,id 升序。total、progress 在完整过滤范围计算，不能按10项当前页推算。

`recurring/children` 对该父全部时期生效子分页，按 occurred_at,id 降序；total 与父 effectiveChildren 均为完整生效数量。撤销后回父详情重新读取相同父身份；最后一条撤销后 total=0、children=[]，页码可由前端主动回1。详情可按稳定ID读取取消子（status=cancelled），以支持已打开窗口的权威失效反馈，但不能恢复、迁移或作为独立待办。不存在、删除或跨owner对象统一NOT_FOUND，不泄漏身份。父详情不自动内嵌无限关联；父存在时可独立分页，两个响应必须同版本／日期。

现有 `/api/adventure`、`/tasks/list` 及一次性详情／历史／相关列表保留既有字段，任务数组继续只含一次性任务；新UI切到 dateTaskList 读取统一行动。目标关系卡背面仍只提供原一次性相关任务，不混入周期父子。目标工作区的 `goals[].taskCount` 是新权威任务数，`goalDetail.totalTasks` 仍是一次性任务分页总数；不得将其替作新的任务数。`planningPage.recurring={version:1,timeZone:'Asia/Shanghai',clientVersion:'recurring-1'}` 表明已激活周期服务；#199 激活后必须输出，不允许客户端因缺字段假定已实现。

## 父、子、能力和成功回执

`RecurringParent`：稳定 id；kind=recurring；当前 title/description、periodType、startOn、requiredCount、goalId/goalTitle/categoryLabel、independent；status=not_started/active/ended；endedAt/endedOn；completedPeriods；effectiveChildren；currentPeriod（未开始为null；结束后停留在 endedOn）。currentPeriod={number,startOn,endOn,completed,required,satisfied,ratio}，number从1开始，实际 completed 可大于required，satisfied为>=，ratio=min(1,completed/required)。不返回或接受持久化 progress 字段。

父 capabilities 必须完整提供 `editRecurringTask`、`changeStartOn`、`changeDestination`、`recordRecurringCompletion`、`endRecurringTask`、`deleteRecurringTask`，每项沿用 `{allowed,reason?}`。未开始允许编辑、改开始日、迁移和删除，禁止记录／结束；运行中允许编辑／迁移／结束，禁止改开始日／删除，记录受满额控制；已结束全部禁用。实际校验仍须在写事务重做。#200 只消费能力，不按设备时间或0次推断可删除。

`RecurringChild`：kind=recurring_child；id（子taskId）、parentId、completionId（事件ID）；status=completed/cancelled、invalidatedAt；不可变 snapshot；冻结固定1XP reward；`capabilities.cancelRecurringCompletion`。快照包含 parentId/childId、父发生时 title/description、periodType、anchorOn、periodNumber、periodStartOn/periodEndOn、requiredCount、occurredAt/occurredOn、发生时 goalId/goalTitle/categoryLabel。无备注／子编辑／子迁移。独立归属对外 goalId/goalTitle/categoryLabel=null；内部可继续使用owner inbox，但绝不将当前归属补到旧快照。撤销只改 invalidation，不改快照和身份。父结束、完成时目标终态、跨日均禁止撤销，父迁移不解除原目标锁。

记录一次的回执继续为 `planningReceiptSchema`：result.entityId=子taskId、completionId=完成事件ID、reward固定1、source 中加入 taskKind=recurring_child、parentId/childId、periodType、anchorOn、periodNumber、periodStartOn/periodEndOn、requiredCount，并保留 title/description/occurredAt/occurredOn/历史归属；growthChange 沿用现行 before/after/xpDelta，message 复用一次性toast通道。父创建／编辑／结束／删除的 entityId 为父；撤销的 entityId 为子，completionId 指原完成事件。旧回执不能因新字段缺失被拒绝；保留历史大额奖励，不重算为1。reward amount仍为冻结正数，撤销通过growthChange.xpDelta=-1表达，本事件失效，不追加负奖励流水。

preview 沿用 `/api/adventure/preview` 和 `{expectedVersion,command}`。create/edit/record 返回 requiresConfirmation=false；end/delete 返回 operation、entityId、title、effectiveChildren、completedPeriods 的确认形状；cancel返回 operation、completionId、parentId、childId、reward、growthBefore/After。preview 同样校验 today/version/能力但不写、不产生回执。目标 preview/终态命令遇未结束父均拒绝 PENDING_RECURRING_TASKS，不能自动结束、忽略满额或仅检查当前页。新字段在旧一次性确认渲染处只做类型收窄，本票不实现新确认UI。

成长 `RewardEntry.recurring` 和 `RewardSource.actionSources[].recurring` 可携带同一快照；只对周期子项输出，旧项字段可缺。顶层 rewardSource.plannedOn 及周期 actionSource.plannedOn=null，表示没有一次性执行安排；子实际日期只用 occurredOn。entityId/taskId 指子，不指父；kind仍task_completed，calculation仍fixed_task，保证既有7个成就继续按真实行动计数。

## 错误和恢复

| code | HTTP | 无副作用的业务含义 |
| --- | --- | --- |
| PLANNING_DATE_CHANGED | 409 | 页面依据已跨北京时间日界，刷新并等待主动操作 |
| PERIOD_FULL | 400 | 本期已达或超过要求 |
| RECURRING_NOT_STARTED | 400 | 尚未开始，不能记录或结束 |
| RECURRING_ALREADY_STARTED | 400 | 开始当天起不能删除／提交startOn |
| RECURRING_START_PAST | 400 | 创建或开始日前编辑不得设过去日 |
| PENDING_RECURRING_TASKS | 400 | 目标终态前须处理全部未结束父任务 |

既有 NOT_FOUND404、READ_ONLY400、DATE_LOCKED400、COMPLETION_CHANGED409、VERSION_CONFLICT409、INVALID_COMMAND400、COMMAND_TOO_LARGE400、CAPACITY_REACHED400 继续适用。上表与既有确定错误的**精确HTTP/code组合**只在本页面首次响应时证明新请求未提交；PlanningError增加code与requiresRefresh，日期／版本／完成变化要求回读。未知响应、错误状态不匹配、网络／超时、畸形成功响应、AUTH_*、REQUEST_ID_REUSED、RECEIPT_UNKNOWN、REPLAY_UNAVAILABLE、CLIENT_UPDATE_REQUIRED 保持 uncertain，不能删除pending后重新做。已处于未知状态的旧请求后续失败不能证明先前未提交，恢复仍走原封套／只读查回执。

## 物理字段和 owner 约束（#199 实施）

| 位置 | 新增／变化 |
| --- | --- |
| adventure_recurring_tasks | id、owner_id、goal_id、title、description、period_type、start_on、required_count、status(active/ended)、ended_at/ended_on、deleted_at、completed_periods、tracked_period_no、tracked_period_satisfied、created_at/updated_at；真实未开始状态由日期派生 |
| adventure_tasks | kind约束扩展once/recurring_child；nullable recurring_parent_id；子行始终status=completed、completed_at/on为实际发生值、planned_on仅内部兼容填实际日，不向UI当作计划；title/description/goal_id冻结；取消不改成pending，不物理删子 |
| adventure_events | task_completed复用，task_id为子；新增nullable recurring_parent_id、entity_type允许recurring_task，父操作kind为recurring_created/updated/ended/deleted；取消复用task_completion_cancelled；快照含父子与周期字段 |
| adventure_accounts/goals | 原XP、revision、目标状态／奖励事实保留；attainment_action_count 从integer扩为安全范围bigint，既有值不变；目标计奖行动ID仍是每个独立taskId（子有独立身份） |

父有unique(owner_id,id)、FK(owner_id,goal_id)→goals，子FK(owner_id,recurring_parent_id)→父；task unique(owner_id,id,recurring_parent_id)，event FK(owner_id,task_id,recurring_parent_id)→该task三元组，并保留event原owner/task FK及event owner/parent FK；父操作event的task_id=null，entity_id=父ID，目标和失效引用继续使用owner复合FK。JSON里的ID不能替代关系列；RPC断言快照父子ID、parent列、子ID与event引用一致。once的parent列必须null，child必须非null，父操作必须有parent列且entity_id等于parent列。子归属冻结，不随父迁移更新；父目标终态前阻止遗留未结束父。

父 start_on、period_type 开始后不可变（period_type创建后即固定）。所有日期限公历0001-01-01..9999-12-31，实际当前期或下一期起点溢出此范围时CAPACITY_REACHED并回滚，不能截短周期或将无限日期序列化。数值用bigint并CHECK安全整数；required_count>=1，completed_periods>=0，tracked_period_no>=0，累计<=tracked_period_no，tracked_period_satisfied=true时tracked_period_no>=1且累计>=1。0维护期只能表示未开始无子事实且false。XP／revision溢出沿用CAPACITY_REACHED，禁止饱和截断。

所有表启用RLS，普通浏览器角色／anon/authenticated不可直写或调用特权RPC；按当前仅service_role授权通道加函数撤销／授予，security invoker、空search_path、owner来自认证。父／子／事件／回执／详情／搜索及错误均受owner隔离；不创建生产测试入口。索引至少覆盖parent(owner_id,goal_id,status)、parent(owner_id,start_on)和(owner_id,ended_on)、child(owner_id,recurring_parent_id)、event(owner_id,recurring_parent_id,occurred_on,occurred_at,id)的生效完成；保留(owner,requestId)唯一及每child一条生效完成唯一索引。计数聚合按父及periodNumber/起止范围，必须排除已失效事件，按子身份校验期一致。

## 锚点和计数算法

周边界=原start_on+7*k天；月／季／年边界=**原始**start_on加k*1/3/12个月、以原始日临时夹到目标月最后一天；每次均由原始锚点计算，禁止从上次夹取日期再加月。第n期为boundary(n-1)..boundary(n)-1；日期命中起点即新期。未开始period=null，结束后以ended_on计算并保留最终期。可用月份差估算n后比较实际boundary作常数次修正，长时间未操作不得逐期循环生成空记录。

维护算法（同账户锁内；不作为客户端自行计算规则）：

1. 取得权威当前期p。若p>tracked_period_no，旧tracked_satisfied的1已包含于completed_periods，**保持累计不变**，将tracked_period_no=p、tracked_period_satisfied=false；跨过任意空期均不增减。日期倒退或期号倒退视完整性失败，拒绝写而非重算历史。未开始只保留0/false/0；合法改开始日仍无子。
2. 对该父当期生效子聚合c，读取当前要求r；校验旧满足位与c>=r一致（若刚跨期则c应为0）；不一致是完整性错误，不能当正常用户错误吞掉。然后执行业务操作，得到c'、r'。
3. s'=(c'>=r')；completed_periods+=int(s')-int(tracked_period_satisfied)，保存s'。创建子时先校验c<r；取消只准当天生效子，目标终态／父结束锁优先；编辑要求不改旧子快照。结束前先维护并冻结该期，然后改ended_at/on；结束后不再变化。
4. 事件审计为本次父计数维护记录periodNumber、before/after要求与满足位、累计差量及跨期前维护期，或放入本次既有操作事件snapshot的recurringCounter字段；这只是操作审计，不按每期创建快照。子snapshot仍为完成当时父内容，不包含后续可变counter。计数、子失效／完成、XP、revision和带hash成功回执原子提交；异常全部回滚。

只读投影：若仍是tracked期，验证并返回该期聚合进度及已存累计；若进入更晚期，旧贡献已冻结，投影当前0/要求，completedPeriods不减。不存在无写入却有该期子事实的合法状态。读取不能为了刷新期数写库或改revision。所有写（含无周期目标的其他写）不必扫描全部父，只在涉及该父／目标终态时维护或校验；长期未访问父在下次相关操作时直接跨期。

| 场景 | c/r与满足位 | completedPeriods变化 |
| --- | --- | --- |
| 完成4/5→5/5 | false→true | +1 |
| 当天撤销5/5→4/5或上调5/5→5/6 | true→false | -1 |
| 再完成／下调4/5→4/3 | false→true | +1且保留4条 |
| 撤销4/3→3/3 | true→true | 0，行动／XP各-1 |
| 跨期5/5→0/5 | 上期true冻结，新期false | 0 |
| 跳过100个无行动期 | 直接落当前期false | 0 |
| 本期要求5改10，上期已满 | 只比较本期 | 历史贡献不变 |

完整性校验包括结构CHECK/FK、owner关系、所有生效子与完成事件一一匹配、完成日期／锚点归期一致、当前满足位匹配聚合、累计不超期数、XP等于有效冻结奖励和、revision/request唯一。历史冻结累计可通过**保留的操作审计差量和**离线核对，不能拿当前要求或子完成时旧要求重新聚合历史是否满足（4/5下调4/3且无新完成就是反例）。若不保留足够审计以校验历史差量，不能宣称计数完整性已验证。

## 统计口径

- 父任务不奖励、不算行动、不进入今日分母，完成周期数无额外奖励。
- 有效子每条1XP／1行动；撤销同步失效并各减1，父迁移不改旧行动归属。
- 目标progress仍仅一次性完成／（待办＋完成），零分母null；taskCount=当前归属有效一次性（pending/completed，非deleted/ended）＋未结束未删除父（含未来未开始和满额）；不按当前页算，不含子和已结束父。
- 目标计奖N=发生时归属该目标的有效一次性完成＋有效子，按各自taskId去重，N>0取N*系数1/2/3，N=0固定1，父和完成期不参与。
- 今日progress.completed=当天有效一次性完成＋当天有效子；total=completed＋今日及逾期待办一次性。一次性2完成、1待办、2子为4/5。dateTaskList的progress为所选日期及当前scope/search完整范围；workspace.todayTaskProgress按scope完整今日范围且不受当前页限制。历史日期没有父期预测或补记。

## fixture

`tests/api/adventure-recurring-contract.test.ts` 是可执行的合成fixture，供双方复用字段示例；不是产品数据源。以下请求只用于说明，真实today/version必须取服务端：

```json
{"requestId":"record-example-01","expectedVersion":9,"command":{"type":"recordRecurringCompletion","id":"00000000-0000-4000-8000-000000000198","today":"2026-11-15"}}
```

父本期响应可为`{number:1,startOn:'2026-11-11',endOn:'2026-11-17',completed:4,required:3,satisfied:true,ratio:1}`；旧子snapshot.requiredCount可仍为5。取消后子保留id/completionId/snapshot/reward、status=cancelled、invalidatedAt非空、撤销能力false，但children响应不含它。

## 迁移、客户端与交付门禁

1. #198仅交付契约：当前`adventureClientVersion=goal-categories-1`保持部署版本，新增周期请求专用`recurringAdventureClientVersion=recurring-1`；现行Worker会拒绝这些尚未实现的写，不通过契约提交冒充后端上线。新只读endpoint目前未挂载，必须由#199实施并通过隔离公共边界测试。
2. #199协同发布时把`adventureClientVersion`切到recurring-1，Worker拒绝所有旧客户端**新写**（包括旧一次性写，因为目标计奖／终态口径已变），新客户端所有一次性和周期新写都发recurring-1。旧UI可读及只读查成功回执：保留精确四字段探针与goal-categories-1回执头；不要求旧lookup发送recurring-1，不把新写门禁用于只读回执。新增验收必须将写门禁模拟／切到recurring-1后以基线旧严格解析器读取旧成功回执，同时证明旧目标写与legacy-retry仍被拒绝；不允许旧目标写绕过周期阻塞。不得仅改前端或仅改schema而先部署。缺少新`planningPage.recurring`不得显示可写周期UI。
3. 新库安装在现行四表基础上增加父表、扩展子kind／事件约束、RPC／权限及查询；非空四表库用一个可回滚事务升级，结构、函数、权限、后置断言一起完成。禁止重放旧五表初始化或重新导入示例；保留全部旧ID、快照、有效奖励、XP、revision及成功回执/命令摘要，不重算历史奖励，不恢复historical_lock。重复执行必须安全或明确无副作用拒绝，并测试。
4. #199先在隔离PostgreSQL分别做新库与非空升级，比较结构／索引／约束／权限／函数签名和相同输入的公开输出；逐ID核对旧任务、事件、XP、revision、回执。覆盖升级失败回滚、重复执行、owner攻击、RPC授权、并发上限、跨午夜锁等待、旧回执跨天优先、年月末锚点、历史计数冻结。真实数据库验证未运行不得称通过；本票无生产DB操作权限。
5. #200按同一冻结提交实施原型26状态，沿用一次性toast／pending／确认模式；成长的周期来源按快照表达并正确处理plannedOn=null，不把父归属当历史归属；#201统一真实联通、截图／外围范围、浏览器／数据库／权限／迁移、双轴评审和必需CI，不以mock或契约解析替代。
6. 生产阶段须另有具体授权、传输上限确认、可完整恢复备份、停流或兼容窗口、整体事务与部署次序、逐阶段后置证据与回退点。不得在结构和函数不一致的中间态恢复流量。共享提交／下游分支均不提前合并main、部署或自动关闭Issue。
