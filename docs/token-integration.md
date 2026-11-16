# Token 统一集成与验收（#219 / #205）

阶段06的实际OS任务门禁、只读托管发现、具体用户设备/人工操作和外部授权安排见 [#221 验收执行单](token-acceptance.md)；各项仍按实际执行证据签认。

2026-11-16用户已授权页面与新增数据功能直接上线，现有生产目标、纯新增迁移恢复范围和唯一累计PR220流程以[生产执行单](token-production-release.md)为当前依据；本文其余未授权/隔离环境阻塞记录保留为阶段05历史。

阶段01–04从 `706db6a5f8eca92e5aeec05d7cde3a75cd37a5ff` 叠加；2026-11-16 fetch 的 main 是 `3d4ecfad5518c405302a7827fa09dd9c6aff55eb`。集成 merge 为 `1ac48ce5b1d574288ab810e8fcc05073e2f26ee5`，merge-base 已成为该 main；无文本冲突，main 的旧机器绑定退役、日期选择组件和测试完整保留。最终待审 HEAD、CI 与评审结论在最终 PR 和阶段报告中固定。

本次分级为需确认变更：核心统计、持久化、鉴权、公开协议与完整界面。本地实现、隔离验证、提交和最终 main 目标 PR 已授权；所有阶段 PR 保留未合并。#205 保持开放，未部署、未迁移生产、未发 npm release、未启用用户系统任务。

## 历史规划已经收敛的部分

本节是 #79/#82/#83/#85/#203 历史“待定”文字的当前实现索引，保留原议题历史，不把旧待定重新作为产品问卷。

- #79/#83：已实现 Node24 原生 SQLite、固定 Tokscale4.23.0、全量/增量缓存/显式重扫、系统标识应用专用派生、hostname、设备码与独立令牌、直传和心跳。真实用户来源与长期系统任务仍待验证。
- #82：字段、模型 JSON key（未知 `null`）、缺失/null/0、精确十进制、内容白名单/规范化、服务器代际+本地单调版本、整体事务替换及精确回执已固定；见三份协议和 shared schema。
- #85：输入含缓存、输出含推理且不重复相加；缓存率按合计 cacheRead/input；费用保留 actual/apiEstimate/unclassified 与 coverage；规则/价格修正可下降/删模型，来源缺失则保护旧可信结果。合成跨午夜/恢复/乱序已经验证；实际客户端继承/fork/归档来源与实体双设备仍待验。
- #203：最终 `prototype-token-usage-v2` / copy-refinement 是正式界面基线，旧3D/导出/常驻详情文字已被后续决定替代。正式 `/token` 和设备确认页已实现，本阶段重新验证集成后页面，用户最终人工验收仍单列。

Token 原 ADR0016 改为 [ADR0019](adr/0019-token-local-rollup-contract.md)，保留 [main ADR0016](adr/0016-remove-legacy-agent-bindings.md)；0017/0018继续保留，全部有效引用同步，前置提交不重写。阶段文档是当时范围记录，本文描述累计状态。

## 需求矩阵

“实现”只说明代码存在；本地合成链路、CI实际执行、真实用户/托管/人工、生产各自提供证据。最终数字与CI链接见阶段报告，条件跳过不算执行。

| 需求 / 来源 | 实际入口 / 代码 | 本地与 CI 验证入口 | 实现 | 本地 / CI状态 | 用户设备 / 托管 / 人工 | 生产 |
| --- | --- | --- | --- | --- | --- | --- |
| 首期Codex、独立设备、北京时间主键；模型不另加 / #79/#82/#85 | shared/token-usage-contract、tokscale-adapter；token_private.rollups/models | token-usage-contract / token-usage-cli / token-backend-database；两状态React合计830 | 已实现 | 本地通过；CI门禁通过¹ | 真实双设备/来源待验 | 未验 |
| 固定CLI与自动runtime依赖 / #83 | tools/token-collector/package*.json、tokscale-cli | 实际CLI；仓库外pack/install/12Token扫描/升级；Linux及macOS CI job | 已实现 | 本地通过；CI门禁通过¹ | 用户设备安装待验；CI合成不等同用户来源 | 未验 |
| 系统ID域隔离派生、hostname独立 / #83 | local.systemDeviceId/deriveDeviceId、cli、heartbeat | 合成派生向量；安装包真实OS只读探针且不输出ID | 已实现 | 本地通过；CI门禁通过¹ | 用户macOS/Linux身份与重装待验 | 未验 |
| 首次全量/文件增量/显式重扫 / #79/#83 | collector.scan、Tokscale cache、cli sync --rescan | token-collector / token-usage-cli、包真实扫描 | 已实现 | 本地通过；CI门禁通过¹ | 实际日志/客户端版本待验 | 未验 |
| 来源缺失/截断/移动/前后竞态；更大数据仍不能覆盖 / #83/#85 | coverage、sources、collector保护日期 | token-collector：完整前缀/目录句柄/移动恢复/截断后新增更大用量 | 已实现 | 本地通过；CI门禁通过¹ | 实际归档/压缩/继承/fork仍待验 | 未验 |
| 价格初始化/更新、规则下降/模型移除 / #85 | prices、tokscale-adapter、saveScan | token-collector / token-collector-pricing；真实RPC下降/删除 | 已实现 | 本地通过；CI门禁通过¹ | 用户真实价格缓存/订阅实际费用可得性待验 | 未验 |
| SQLite原子保存/不可变队列/运行互斥/崩溃恢复 / #83 | Store、run.sqlite、saveScan | 文件SQLite/kill恢复、精确body重试；包升级库字节不变 | 已实现 | 本地通过；CI门禁通过¹ | 长期设备运行待验 | 未验 |
| A→B→A/单调版本/旧回执/丢回执/断网 / #82/#83 | Store.prepareSnapshots/ack/retry、transport | token-collector、token-backend-database、真实TLS回执丢失重启 | 已实现 | 本地通过；CI门禁通过¹ | 实体设备断网长期待验 | 未验 |
| 浏览器核对/批准/拒绝/到期/明确重绑409 / #83/#205 | DeviceConfirmation、Worker registrations、SQL | token-dashboard浏览器；真实Worker+PG+React批准/重绑 | 已实现 | 本地通过；CI门禁通过¹ | 人工确认待验 | 未验 |
| 领取响应丢失恢复/授权代际/轮换停用 / #83 | transport.claim、SQL registration/device、TokenDevices | 并发领取/限流/窗口；真实旧令牌拒绝且历史830保留 | 已实现 | 本地通过；CI门禁通过¹ | 用户设备恢复待验 | 未验 |
| 日常直传/指纹双验/事务回执/设备隔离 / #82/#83 | token_usage_upload、transport.uploadPending | PG固定向量/Unicode/同版冲突/乱序/事务回滚/跨设备拒绝；TLS头部 | 已实现 | 本地通过；CI门禁通过¹ | 托管HTTPS publishable-key网关待验 | 未验 |
| 无新增也心跳/同步周期/逾期 / #79/#83 | token_usage_heartbeat、uploadPending、devices | 无新增RPC次数/hostname变更/两周期逾期/停用 | 已实现 | 本地通过；CI门禁通过¹ | 真launchd/systemd长期timer待验 | 未验 |
| 私有schema/RLS/定界search_path/最小ACL / #83 | 两份db/token/migrations | 空库与既有ledger/OAuth/旧绑定退役状态；dump/restore后ACL/RLS一致 | 已实现 | 本地通过；CI门禁通过¹ | 托管Data API暴露schema需预检 | 未验 |
| 白名单共享查询、设备凭据不可读 / #79/#83 | Worker verifyIdentity、summary/query/devices RPC | auth/token-backend/API；跨账户共享、无凭据返回；匿名拒绝 | 已实现 | 本地通过；CI门禁通过¹ | 实际托管Auth与用户人工待验 | 未验 |
| summary全范围、明细/设备全分页/范围上限 / #205 | token/api、SQL summary/query | 252行跨页、100000上限与维度缩小；前端13行多页fixture | 已实现 | 本地通过；CI门禁通过¹ | 人工长范围待验 | 未验 |
| 本周/月/短月同期与独立年历 / #203/#205 | token/dates、TokenDashboard/Calendar | 日期单测、浏览器筛选/跨年/月末/方向键/tap | 已实现 | 本地通过；CI门禁通过¹ | 用户常用浏览器待验 | 未验 |
| 缺失/null/0/小额/unknown/unverified/多币种 / #82/#85 | shared schema、SQL、token/format/Trend | JS↔PG对账/精确十进制/浏览器0与<$0.01/费用coverage | 已实现 | 本地通过；CI门禁通过¹ | 实际源字段可得性待验 | 未验 |
| 请求撤销/快速筛选旧响应/会话撤销 / #205 | identity AbortSignal、useResource、api | auth-storage-sync / auth-logout / token-dashboard竞态 | 已实现 | 本地通过；CI门禁通过¹ | 用户真实多标签/会话待验 | 未验 |
| 邮件回跳/缺PKCE手动登录通过和拒绝 / #205 | token-confirmation-return、AuthGate | auth浏览器恢复及准入拒绝，不领取终端秘密 | 已实现 | 本地通过；CI门禁通过¹ | 托管邮箱/真实Auth待验 | 未验 |
| 原型五宽、窄高触屏、查找明细/浮层 / #203 | src/token、共享AppLayout/AppNavigation | 五宽与15张正式图及metadata、真实viewport；fresh独立视觉评审 | 已实现 | 本地通过；CI门禁通过¹ | 最终人工视觉验收待验 | 未验 |
| main日期组件/MCP退役/登录恢复无回归 / #219 | TaskDateField、旧绑定退役迁移、Auth/MCP | 全API/全浏览器；日期选择和禁用专项、legacy404测试 | 已集成 | 本地复验通过；CI通过¹ | 用户人工既有流程待验 | 未验 |
| 正文/路径/原始ID/凭据不上传/不公开 / #79/#82 | strict schema、Node-only Vite边界、脱敏错误 | API字段拒绝、bundle静态拒绝、安全/密钥先行门禁 | 已实现 | 本地通过；CI门禁通过¹ | 真实设备网络审阅待验 | 未验 |

¹ CI初轮 `88cf8b3` / run43750899561全部11项成功，包括macos-15真实只读身份探针与合成包执行。最终SHA的CI与独立评审以最终PR/报告为准；价格在线探针仅本地执行。全仓本地413通过/132条件跳过/4失败，已保留失败证据：原四场景改用独立端口/输出目录，并在其他浏览器结束后各串行重复3次，12/12通过；未修改15秒或断言。原先trace ENOENT来自并行复跑共享输出目录，其他超时发生在AuthGate启动/导航总时限内，未进入日期提交行为。最终真实DB22/22通过（含兼容迁移/恢复），API新增真实DB测试在普通无库批次条件跳过，不算业务执行。

## 可操作隔离预览

`npm run preview:token`（显式设置本机PG/PostgREST工具路径）运行 `tests/support/token-preview.mjs`，默认 `http://127.0.0.1:5220`。此harness不读取生产配置；合成Auth只放tests，全部监听numeric loopback，并拒绝不同Host/Origin。标准产品AuthGate、在线白名单和Worker/RPC业务照常运行；设备令牌/领取秘密只在私有SQLite/内存，入口只返回短码。两处Vite均以 `envDir:false` 禁止dotenv注入，正式开发配置与harness共享完整敏感路径拒绝规则，harness额外拒绝test-results；合成HTTP回归确认凭据/证书/私有配置403且公开资产仍可读。Vite开发工具本身不是生产隔离沙箱，请仅在本机使用。

先访问 `http://127.0.0.1:5220/__token219/session` 建立合成会话，然后进入正式 `/token`。两份独立采集器状态各有30天合成来源，均实际运行在当前Linux；macos仅为合成平台标签。费用未知来自真实无价格缓存输出，不编造实际账单。数据库和私有状态在忽略的test-results临时目录，SIGTERM/SIGINT只清理本实例。

验收步骤：

1. 查看总量/输入输出/缓存率；切换本周、本月、90天、设备和模型，查看年历及展开日明细。刷新会从真实数据库读取。
2. 执行 `node tests/support/token-preview.mjs start linux`，复制返回短码，进入 `/token/devices/confirm` 核对，明确勾选重绑后批准；设备码10分钟到期。
3. 执行 `node tests/support/token-preview.mjs claim linux`，再执行 `node tests/support/token-preview.mjs sync linux`，确认代际轮换后同步正常、历史保留。需要新短码时再次start；重复轮询受5秒间隔约束。
4. 网页停用该设备，执行sync看到不能心跳/上传、历史仍可查。重新start→网页明确重绑→claim→sync可恢复。
5. 注销会话后应回到正常AuthGate；重新访问harness session入口才能恢复合成认证。该入口不在产品路由、构建或生产配置中。

## 安装包与恢复

最终集成源码重新 `npm run build:collector`，再在 `tools/token-collector` 使用 `npm pack --ignore-scripts --pack-destination <绝对目录>`。最终包路径/SHA256记录在交付报告；它是独立Node包，精确携带Tokscale4.23.0 runtime依赖（npm安装时自动解析固定版本）。安装需网络访问npm，包不是全部平台依赖的离线镜像。要求Node24.x、macOS或Linux，与平台原生包支持架构一致。

```sh
npm install --prefix /absolute/private/install --ignore-scripts --no-audit --no-fund --save-exact /absolute/lifespace-token-collector-0.1.0.tgz
/absolute/private/install/node_modules/.bin/lifespace-usage --help
# 在获准的测试/正式环境完成迁移和发布后，才使用真实设备init/authorize/sync。
```

真实使用命令、timer计划/显式apply及卸载见[包说明](../tools/token-collector/README.md)。不要在当前机器安装真实timer。升级前备份私有state-dir，用 `upgrade --archive ... --prefix ... --apply`；本版本已实际验证本地升级保留SQLite字节和待传任务。卸载先timer uninstall --apply，再移除独立install目录，保留私有state-dir可恢复；不把删除状态库当卸载默认。丢失状态/凭据必须重新浏览器批准，不能凭deviceId恢复权限。

## 上线门禁、预检与回退

1. 总控确认目标是隔离托管project/branch还是生产；当前只读发现唯一lifespace项目、无开发分支，没有可直接认定可写的隔离托管环境。
2. 取得备份能力：完整数据库schema/函数/ACL/RLS/约束/数据/迁移历史及角色定义，安全保存且在独立目标恢复。当前本地dump/restore验证包含完整数据库，复用已知harness角色；不冒称已经备份生产角色或托管Auth。
3. 在目标只读核对 Data API 仅暴露public、不暴露token_private。执行[只读SQL预检](../db/token/preflight.sql)，并检查托管Dashboard/配置的真实 exposed schemas；SQL结果未知时不能假装已核实网关配置。
4. 按顺序完整执行 `20261115152721_token_backend.sql`、`20261115172408_token_registration_inspection.sql`，每份文件单事务且不可切函数。记录迁移历史后核对ACL/RLS/search_path；只匿名upload+heartbeat，管理/summary只service_role。两文件合计36,560字节，选完整SQL通道，不在受限API里机械分段。
5. 发布同一完整集成Worker+React版本。迁移先于新入口，旧Worker仍可运行；新增schema不改既有业务表/旧MCP退役决定。
6. 用独立合成设备实际登记→网页批准→终端领取→Supabase HTTPS上传+心跳→summary→React→停用旧令牌拒绝且历史保留；先运行 `node scripts/token-gateway-preflight.mjs` 只读/无效凭据预检，再运行真实授权链路。publishable apikey不得放Bearer；独立设备头不得丢失。
7. 用户macOS/Linux真实来源和长期timer、双设备对账、常用浏览器/手机触屏人工验收、最终生产验收分别留证；达到总控核对的全部条件后才统一合并/生产操作。CI合成macOS或本地TLS替身都不能替代这些门禁。

异常回退：先停止新设备入口和采集器任务，再回退Worker/React到集成前main固定版本，保留token_private汇总、代际和权限边界；已有设备直传要停用或撤销匿名两RPC执行权以停止写入，不能只撤网页。必要时恢复入口前核对数据库版本/凭据状态；完整移除schema需另行授权和导出核对，不作为普通回退。恢复整库可能覆盖其他业务的新写入，需先止写并明确恢复范围，不能把本地演练当作任意生产回滚许可。


## 独立评审修复记录

累计 `3d4ecfa...88cf8b3` 的fresh双轴发现已逐项修复，最终固定SHA复审结论以PR/阶段报告为准：

- Spec P2：`init --replace` 未显式指定来源时，现继承已保存的自定义sourceHome；真实已构建CLI+私有SQLite+loopback登记回归先复现 `EXISTING_PROFILE_SCOPE_CANNOT_CHANGE`，修复后通过，显式换来源仍拒绝。
- Spec P3：空设备提示不再给出不存在的register，改为 `lifespace-usage init --server 本站地址`；仅该提示取消nowrap，320/390两宽真实浏览器验证无全页/提示溢出并新增截图。
- Standards P1：预览拒绝规则遗漏私有文件类别；新增shared sensitiveFileDeny，正式Vite保留原完整规则，harness额外拒绝测试状态。合成临时 `.aws/.codex/.npmrc/.yarnrc/证书/私钥/环境/构建状态` 真实HTTP均403且不泄露标记，普通公开资产200。
- Standards P2：harness显式 `envDir:false`，两Vite均不加载工作区dotenv；合成VITE哨兵不注入。预览仅重启本阶段实例，未读取真实秘密或停止5193/5217。


最终CI焦点回归补充：候选4606e40的CI43787515479中390px旧日期编辑在键盘重开时未获得焦点（browser2失败、validate失败），其余9项成功。这是独立于早期本地Auth启动超时的新问题，保留该失败，不用普通复跑绿替代。原用例本地8/8通过；新增1440/390确定性延迟RAF的真实控件回归均在原源码稳定失败，确认旧close回焦可能晚于new open、夺回焦点。修复仅在关闭回调执行时检查当前picker是否已重开，重开后不再回焦按钮。原日期/禁用/键盘加回归20/20通过，另补390×520真实触屏及登录/导航回归；最后SHA、全部CI和三轴增量复审见最终交付报告。原测试断言和时限未修改，未重新设计日期组件。
