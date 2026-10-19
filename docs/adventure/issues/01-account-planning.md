# 01：创建个人主线、支线和目标并持久保存

## Parent

https://github.com/PancrasDuan/lifespace/issues/53

## What to build

从主导航进入人生冒险，用真实账户创建容器和目标，刷新后保留；在收敛 A 布局查看与调整聚焦和优先顺序。

## Acceptance criteria

- [ ] 持久化采用 adventure_states(owner_id PK,state jsonb,version bigint)；Worker 领域命令＋owner/version PATCH CAS，初始化 ignore-duplicates；客户端禁止整包state写。
- [ ] 数据迁移提交并实际验证；anon／authenticated 对冒险表直接读取、插入、修改、删除全部拒绝，仅 Worker service_role 可访问，不以 HTTP mock 代替真实权限验证。
- [ ] 所有普通用户变更命令携带 expectedVersion，失配 409，不自动重放旧视图；owner＋requestId journal 含 payload 摘要和稳定结果，与 state 原子CAS，同key异payload拒绝；未知结果同key重试。
- [ ] 响应返回最新 state＋稳定 command 结果，客户端按version防倒序覆盖；结算可CAS有限重算，普通编辑／规则／排序／创建不可自动覆盖。
- [ ] 使用真实持久存储并经现有 Worker 身份验证；两个账户互不可读写，owner 由服务端决定。
- [ ] 主线最多5条含归档；在用支线最多10条含空壳且每条最多1目标；并发提交也不突破限额。
- [ ] 统一新建容器／目标；全局归属为空、提示仅占位不可选、必选校验；新目标不自动聚焦。
- [ ] 主线及支线改名，目标改名与完成标准；取消不保存，保留稳定关联，空名和主线重名反馈明确。
- [ ] 每主线最多3聚焦且无全局上限；拖动和上下移动仅同主线排序，不改变聚焦。
- [ ] 像素人、紧凑XP、dashboard、10成就横排的真实空账户状态；目标行更多、顺序模式、窄屏和键盘可用。
- [ ] 领域命令＋真实存储回读及HTTP账户隔离测试通过，浏览器创建后刷新仍存在。

## Blocked by

无，可以立即开始。

状态：ready-for-agent

覆盖规格用户故事：1, 2, 3, 4, 5, 6, 7, 34, 35, 36。
