# Token 生产发布执行单（#221 / #205）

2026-11-16 用户明确指示“新的页面和数据可以直接部署到线上”。现有 LifeSpace 生产环境是本次目标；不再创建隔离Free project/独立Worker，也不重复索取生产许可。最终仅通过累计PR #220向main统一squash一次，Cloudflare Workers Builds自动发布，由总控执行合并和发布核验。阶段PR #222只留证，不单独合入main。用户真实来源/长期timer/付费升级没有新增授权；真实设备和用户人工结果后置留在#205，不作本次上线前的新批准门禁。

## 当前范围与恢复边界

两份已审SQL是纯新增迁移：首次创建 `token_private` schema、5表、内部辅助函数和 `public.token_*` RPC；第二份只替换首次新建的inspection函数。权限变更仅限这些新对象；`pgcrypto`仅 `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA extensions`。函数体的DML只访问token_private，不改删已有账单/Auth等业务表、现有函数或全局权限。

总控已明确将先前的“全生产pg_dump+全库隔离恢复演练”前置要求撤回，改为保存受影响对象/权限/迁移历史基线和现网Worker版本/公开配置/绑定名称。**本次没有执行全库备份或证明全库可恢复，不称其已有恢复证据；不因缺DB密码阻断该新增上线，不要求提供或重置密码。**此前完整备份、隔离项目和凭据导入材料只保留为历史，不能当当前门禁。若实际SQL或生产基线出现既有对象重名/替换、全局授权或既有业务改写，停在该具体差异并交总控处理，不能按此新增性假设继续。

## 发布前只读基线

- 目标：Worker `lifespace`，域名 `https://lifespace.onepeace.cc.cd`，Supabase `zvdcjzjfhkjasikchceo` / ap-southeast-1 / PG17.6。最终SHA/CI/累计评审在PR220与阶段报告固定。
- 当前现网部署 `19b6ee88-bd8d-400f-adc3-fe00f29af721`，100%版本 `be182439-1265-48ad-a460-a36284eec152`（2026-11-16）；版本103注释为更新AUTH_ALLOWED_EMAILS。记录版本供代码回退，不把metadata当作与main字节一致的证明。
- 只读SQL确认token_private不存在、public token命名空间下函数为0、两迁移版本尚无记录；pgcrypto已在extensions/1.3。anon/authenticated/service_role均有public与extensions USAGE、无public CREATE。实际值和时间见私有preflight证据，不查询业务行或role密码。
- 生产配置/绑定与仓库配置逐项核对：兼容日期2026-10-01，既有KV/限流/ASSETS、SUPABASE_URL和MCP issuer保持原目标；只记录secret名称是否存在，不读取、导出或覆盖其值。不要把先前独立Worker模板用于生产。
- `/api/auth/config`和托管`/auth/v1/settings`只读HTTP200；仅在进程内核对公开URL/key一致，不打印key。Data API的`/rest/v1/`元数据入口要求server key，publishable-only在该入口401不等于匿名上报RPC失败。通过现有安全配置的server key做无效Accept-Profile只读元数据探针，记录真实exposed schemas并确认不含token_private；不在聊天/参数/日志中传key。
- 实际PGRST106元数据hint返回exposed schemas为 `public, graphql_public`，不含token_private。保留既有graphql_public配置，不为Token改写无关Data API范围；迁移后再核对同一边界。

## 唯一累计PR与阶段门禁

1. 在阶段06自身分支完成生产执行单与适当验证，记录最后HEAD。核对最新origin/main、前置远端219实际SHA及祖先关系，确认阶段05无其他写入。
2. 正常fast-forward推送该最后HEAD到远端 `codex/219-token-integration`，保留阶段06分支；不用force、不切换/修改阶段05工作区或其服务。复用PR220，不另建main目标PR。若GitHub因此自动结算PR222，记录它只是feature分支纳入累计交付，没有单独生产合并/发布。
3. PR220最终HEAD对最新main做完整累计Standards/Spec复核（尤其迁移新增性、权限和此恢复范围），受影响视觉按实际差异核对；最终完整12项CI全部成功、失败/取消/跳过job不放行。前期799409a的绿不能替代改变后的最后SHA检查。
4. 保存上述生产只读基线，核对以下两份文件原始字节/SHA与单事务边界，验证完整SQL通道的传输能力；整份执行，不切函数、不拆“结构/函数”中间态。每份成功后立即核对对象/ACL/历史再继续；传输/执行失败不靠空迁移历史或跳过错误掩盖。

| 顺序 | 完整文件 | 字节 | SHA256 |
| --- | --- | ---: | --- |
| 1 | `db/token/migrations/20261115152721_token_backend.sql` | 35342 | `046a571de49b2422af072eab135d4a3b8a1149ac93c30fee7fb3a93299a6fd72` |
| 2 | `db/token/migrations/20261115172408_token_registration_inspection.sql` | 1218 | `b41b478f721bc21dd485234d458646942e6669df1dcf967bf0b451323a6e4a53` |

5. 两份迁移先于新Worker/React；旧Worker的既有业务继续运行，新增Token对象不与旧接口争名。只有两个新匿名RPC upload/heartbeat；无有效设备凭据时不能写入。确认5表RLS、private schema不可访问、函数固定空search_path，anon仅执行两上报RPC、authenticated不能直接管理/查询，service_role管理RPC保持受Worker准入控制。
6. 由总控执行PR220唯一main squash，核对Cloudflare自动构建/部署的实际合并SHA与当前100%版本、域名、绑定、公开Auth配置和既有页面/接口；不得绕过main保护或用手动stage发布代替。
7. 在生产完成无效凭据/独立设备头预检及下述有界合成smoke，再提供桌面/手机人工入口。只按实际结果登记；用户真实双设备/日志继承/fork/归档与长期任务继续留#205，不能冒称完成。

## 生产合成smoke的写入与精确清理

实际写入前总控须看到私有 `test-results/token221/production/smoke-scope.json` 中的**唯一合成deviceId、hostname、固定日期2026-11-15、Agent codex、模型token221-unpriced-smoke、允许12→8 Token变更、登记请求ID和时间边界**；设备/请求ID在执行时先持久记录，确认生产中不存在同名对象才创建。仅用本轮生成的合成来源和私有状态，不读当前机器真实Codex日志或系统ID，不装用户timer。

真实设备码审批使用获准账户/现有会话，不能通过伪造Auth用户或绕过网页准入代替。测试仅新设备：start→网页核对批准→claim→publishable apikey+独立设备头直传→严格回执→summary/页面同device/date/Agent/model对账；重复/无新增只心跳、修正可下降、停用旧令牌拒绝且历史保留。server key仅用于本轮受控管理/只读预检，不进入浏览器或采集凭据。

测试可能短暂使该日期总量增加12或8；网页比较限定本轮设备。结束时先停用/停止本轮producer，导出必要脱敏证据及本轮合成汇总，按预先审阅的 `cleanup-smoke.sql` **单事务**只删除该唯一device/date/agent对应rollup（models随外键级联）、本轮登记请求及该唯一device；校验hostname/owner/创建时间和无范围外rollup，不满足即回滚并调查。清理后各相关表本轮主键计数均0、正式总量恢复；不批量删除他人设备、日期或表。

IP/owner级共享rate_limit记录不强行删除或回滚，避免更改其他请求额度；它们不进入用量总量且由既有有限清理策略处理。登记RPC可能清理其他已过期Token登记/超过2小时限流记录，这是已审实现的有界维护，不触既有业务表；不要为“零残留”扩大清理权限。若无法取得真实网页会话，登记/批准/有效凭据链路记为待验，不能用本地TLS替身或直接插表冒充。

## 回退

优先回退Worker/React到记录的上线前版本，同时保留token_private对象、汇总和代际。新入口关闭不自动阻止已持凭据的设备直传；需止写时仅停用本轮测试设备，或由总控按实际范围精确撤销两新匿名上报RPC执行权并核验。不要drop已有数据/schema，不恢复整库覆盖同期账单/Auth等新事实，不改生产无关secret或KV。任何恢复写入范围以总控具体安排执行；本执行单不宣称全库备份存在。
