# #149 生产接入准备与发布边界

2026-11-08，用户明确批准 **A：生产接入准备**；没有批准 B 的完整业务数据导出，也没有批准合并 PR、正式切流或套餐升级。接入资源已配置，远端功能验证通过；**Free CPU 预算验收未通过，当前不建议正式切流。**

## 资源与权限

| 项目 | 已核对状态 |
|---|---|
| 数据库 | Supabase lifespace，ap-southeast-1，PostgreSQL 17.6.1.166，连接上限 60 |
| 生产迁移记录 | `20261108110124_worker_database_role`，对应仓库 `db/migrations/20261108000000_worker_database_role.sql` |
| SQL 文件 SHA-256 | `c3ed8c4ce37dd51eb3c49727ee2b3cf013437eeebe65c1585f8bb89d2b375f67` |
| 登录角色 | `lifespace_worker`；无超级用户、CREATEDB、CREATEROLE、BYPASSRLS；9 项 owner 策略及只读启用绑定策略 |
| Hyperdrive | `lifespace-postgres`，ID `a3307e803a27447f854d2e1a9253b5ae` |
| 连接配置 | Supabase Direct:5432，`verify-full`，缓存 disabled=true，起始软连接限额 5 |
| CA | `5dd89e60-76fc-41d3-a045-b4495af4826d`，Supabase Root 2021 CA，2031-04-26 到期 |
| CA SHA-256 | `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa` |
| 仍在线的 Worker | 版本 `8a65f2c2-a466-4b52-a2ef-0867c786520e`，原部署承接 100% 正式流量 |

迁移前后以及本轮远端回滚探针后，十张业务表的行数／摘要相同。旧 service_role RPC 执行权限保留，新角色不能读取 Auth、删除历史或调用旧写事务。没有创建生产 `public.tasks`、删除旧函数或修改 Auth 配置。

生产 DDL 日志开启；凭据由客户端生成高熵密码和 SCRAM 校验值，数据库只接收校验值。明文密码仅交给 Hyperdrive，配置后本地临时密码及校验值副本已删除。仓库不包含真实密码、完整连接串或验收令牌。

官方 CA URL 取自 Supabase 控制台源码，校验单证书、有效期和指纹后上传；Hyperdrive 创建时使用 verify-full 成功连接。数据库侧也观察到新角色连接全部使用 TLS。本机直接 TLS 探针曾失败，未计为通过。

## 远端功能证据

使用独立、令牌保护的临时 Worker，兼容日期和 nodejs_compat 与待发布代码一致，复用生产 transaction、queryLedger、queryPlanning 和 applyCommand。只有最小 owner 上下文在临时服务端绑定中使用，未返回业务行或身份标识。

- 无令牌请求被拒绝；无 owner 上下文看不到账户，跨 owner 查询为空。
- 正式账户列表及成长读取可用。
- 账户／余额调整／版本写入后强制回滚；其他连接看不到未提交账户，回滚后账户及版本恢复。
- 正式 createTask 命令能执行并生成预期版本回执，随后强制回滚。
- 真实共享锁阻塞同 owner 排他锁；全部查询、提交／回滚及关闭沿用请求内 client。
- 两组 5 并发只读请求成功，本轮观察到该角色最多 5 个数据库连接。该数值不证明所有地域／流量的硬上限。
- Hyperdrive 查询指标未观察到 cache hit；配置回读确认缓存禁用。
- 两处临时验收 Worker 和本地验收令牌已删除。清理后复查为 5 个 TLS 池连接、0 个闲置未提交事务，数据库总连接采样 18／60；保留的池连接不等于请求 client 泄漏。

探针身份来自受保护的内部验收入口，因此不代替真实用户登录后完整 HTTP／MCP 验收。远端未提交退款、转账或任务完成等测试事实；这些完整业务语义及竞争证据保留在隔离 PostgreSQL／CI 中。

## Placement 与延迟

同一客户端、相同数据路径，每组 2 次预热和 20 个有效读取样本，缓存关闭。数据操作耗时不含真实 Auth 请求；客户端往返还包括进入 Cloudflare 的网络。

| 数据操作 | 默认位置中位数／P95（ms） | 新加坡位置中位数／P95（ms） |
|---|---:|---:|
| 账户读取 | 215／240 | 41／73 |
| 成长读取 | 176／200 | 34／41 |
| 客户端完整探针往返 | 522.5／612.1 | 371.2／976.4 |

新加坡配置实际返回 remote-SIN，证明 fetch 被放置到数据库附近；客户端入口仍为 HKG。内部数据库往返改善，客户端 P95 存在波动，不能声称所有请求更快。由于下述 CPU 风险，功能分支暂不采用 placement hint。

## Free CPU 与查询额度

Cloudflare API 明确以 Free plan 拒绝自定义 CPU 限额；没有修改套餐。[官方限制](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) 为每次请求标称 10 ms CPU。

单条正式 createTask 命令的核心探针使用一次事务，输入校验、业务编排及 20 条数据库语句均执行，结尾用回滚代替提交；事后完整摘要另行核对，不把验证读取塞进该核心计量。下表来自 Workers 原生 CPU 指标，每组 12 次（含 2 次预热）：

| 位置／tracing | 平均 CPU（ms） | P95／最大 CPU（ms） |
|---|---:|---:|
| 新加坡，tracing 开启 | 32.0 | 56／56 |
| 新加坡，tracing 关闭 | 37.6 | 63／63 |
| 默认位置，tracing 关闭 | 16.8 | 31／31 |

这些请求均成功返回；CPU 超出标称预算仍是未解决的发布风险。即使从默认位置样本中移除最高的两次预热，余下 10 次平均 CPU 下界仍约 14 ms，不能只用冷启动解释。关闭 tracing 或恢复默认位置都未使本轮样本满足 10 ms。没有触发套餐升级，也不依赖平台偶发超额宽限来宣布稳定可用。

单次任务创建已发送 20 条 SQL，其他操作和页面读取另占额度；Hyperdrive Free 每日 100,000 条查询不能等同于用户请求数。实际结算以平台指标为准，本轮短时抽样不证明长期峰值、所有输入规模或每日容量。

## 合并发布前仍需完成

1. 解决 CPU 预算：继续降低请求成本并实测，或由用户另行明确批准合适的套餐方案；当前准备不授权升级。
2. 确认备份／恢复保障。B 未授权，没有完整业务数据导出；已保存的权限元数据和不可逆行摘要不能代替业务备份。
3. 最终用户身份下的登录、HTTP／MCP 与写后回读验收；确定生产 placement 和 tracing 采样后复核。
4. 最终配置的双轴评审、必需 CI 和具体合并发布确认。PR 保持草稿，Issue 保持开放。

回退时保留历史事实、角色迁移和旧 RPC；正式切流前原 Worker 始终保留。若以后需要恢复旧版本，按[切换与回退](database-access.md#切换与回退)协调，不删除业务表或反写余额。

官方依据：[Hyperdrive TLS](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)、[指标](https://developers.cloudflare.com/hyperdrive/observability/metrics/)、[placement](https://developers.cloudflare.com/workers/configuration/placement/)、[查询定价](https://developers.cloudflare.com/hyperdrive/platform/pricing/)。原始脱敏采样和权限元数据保存在本工作区被忽略的 .cache/149-release/ 中；临时入口验收后清理。
