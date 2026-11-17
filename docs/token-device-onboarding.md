# 真实设备接入（#223 / #205）

正式看板已在 `https://lifespace.onepeace.cc.cd/token` 上线，本阶段使用现有生产。阶段06的隔离目标讨论是历史资料；真实设备、正常网页登录、有效设备直传、长期任务与用户人工仍分别待验。

每台macOS/Linux实际设备均须由操作者明确设备、受控连接、source-home 和要授权的 Agent 来源；正式state由总控单写，worker不读取真实来源或正式state。运行证据仅保存在受控私有文件，公共文档不记录真实用量、设备状态、回执hash或托管数据。source-home 是包含所选 Agent 数据目录（如 `.codex`、`.grok`、`.hermes`）的 home，不是 Agent 目录本身；来源格式／roots 由固定 Tokscale 及该 home 的 scanner 配置决定，不再运行独立 `coverage.ts` 审计。**扫描和同步覆盖所指定来源的全部历史，固定日期 D 只限定对账，不限制上传范围。**

## 同一包和私有传输

发行包未发布 npm；不使用 `npm install @lifespace/token-collector`。两设备使用同一份 0.1.6 归档，不在设备端重新 pack：

| 项目 | 固定值 |
| --- | --- |
| 包 | `lifespace-token-collector-0.1.6.tgz`，26,996 字节，13 个文件 |
| SHA-256 | `9677c8181855e4a1045ccaa445162a1a6dccc4c400bfdb85cbff53238783311d` |
| 声明源码 | `docs/evidence/token-onboarding/package.json` 中的 14 项；摘要 `8a3a2fcfa35c5b08df3c948e2b405fb6c0abc4123360ec3addc6027da664b642` |
| 运行时 | Node >=24.22.1 <25；仓库CI固定24.22.1；安装自动取得固定 Tokscale 4.23.0 和 Zod 4.6.7，保留 optional dependencies |
| 私有副本 | 当前工作区 `test-results/token235/onboarding-0.1.6/lifespace-token-collector-0.1.6.tgz` |

0.1.3 按[ADR0020](adr/0020-token-recorded-usage-authority.md)接受固定 Tokscale 成功且通过输出校验的已记录用量。missing-usage／价格／未知告警只保留固定脱敏类别，不再逐文件审计或冻结有效统计；真正失败、无效输出、版本／时区冲突继续保留旧统计与待传请求。有效更正可增可减或移除模型，graph缺席的旧日期保留，不补未知为0。Node >=24.22.1 <25的已测基线保持。

0.1.6在显式授权后支持Codex、Grok Build（`grok`）、Hermes Agent（`hermes`）、Claude Code（`claude`）、WorkBuddy（`workbuddy`）和Cursor（`cursor`）；默认仍只采Codex，旧状态库无`agents`时按Codex读取。已有设备升级不会自动扩大来源；要新增来源须由操作者执行`sources add --agents claude,workbuddy,cursor`（或只加其中一个），再用`sources list`核对。一次调用只传授权列表，缺少某个来源目录不影响其他来源。Claude、WorkBuddy与Cursor只依赖`--home`；Cursor只读`<source-home>/.config/tokscale/cursor-cache/usage*.json`，采集器不代为`cursor login`/`sync`，操作者须在采集器之外准备缓存。已有0.1.5安装先校验归档，再用原CLI的`upgrade --archive /absolute/lifespace-token-collector-0.1.6.tgz --prefix /absolute/installation --apply --state-dir /absolute/private/state`保持原state升级，不重跑全新接入向导。无需因升级重绑有效授权；先手动核对新扫描成功和实际回执，再按指定设备授权安排timer。旧队列成功上传不能代替`scanFailed=false`。

0.1.0–0.1.5的归档、目录和校验值按受控私有位置分别保存，不覆盖；本仓库只记录映射，不证明每个历史副本在当前机器仍可取得。0.1.6有独立归档、来源映射和六文件目录 `test-results/token235/onboarding-0.1.6/`，包括包、向导、只读对账辅助、本说明、SHA256SUMS和来源记录。只传该目录，不传 `.env`、用户状态、原始日志或整个工作区。

已发现的 Orca CLI 提供本地文件打开和浏览器 upload/download，但没有通用的主机间文件传输命令，当前也没有远程目标。操作者能直接读本机文件时复制上述目录；远端设备则由总控取得已有受控 SSH/SFTP/文件传输目标后，先列出准确源目录和目标目录，再通过该已有连接复制。缺少连接时由用户以自己的受控文件渠道取得这几个非敏感发行文件。尚未进行跨主机传输，不公开 npm、GitHub Release、生产下载路由或临时公网服务。

目标设备在私有目录校验：

```sh
# Linux
sha256sum -c SHA256SUMS
# macOS
shasum -a 256 -c SHA256SUMS
bash token-device-onboarding.sh --plan
bash token-device-onboarding.sh
```

`SHA256SUMS` 校验复制完整性，不能替代可信来源；采集器归档还由向导对照上表硬编码 SHA 验证。安装要联网下载精确 runtime 依赖，这不是全离线镜像。向导保留 wizard 技能原库，仅新增阶段；交互只在选定设备本机运行，不把登录密码或令牌复制到聊天。

## 向导执行边界

向导先检查 Node >=24.22.1 <25、包字节/SHA、绝对路径和新建的私有独立 install/state，显示生产目标、source-home 与已授权 Agent，取得本机操作者确认后安装。它不复用默认状态、不覆盖已有安装、不执行 `init --replace`；全新接入默认只采 Codex，扩大来源须在向导中明确选择或由操作者执行 `sources add`。中断后保留 install/state，按已安装 CLI 的正常命令继续；重新运行向导请选择新路径，已有设备重绑仍须网页明确确认，不能删除状态续权。

随后打开正式 `/token`，由获准账户正常登录；在终端 `init` 后显示8位码，网页「核对设备」确认设备名称、平台、设备标识，再「批准连接」。若提示替换已有设备，必须先确认确实为本设备，并在网页勾选明确替换；不能因名称相似就替换。返回终端 `authorize --wait` 后核对 `authorized=true`，过期/拒绝时退出，不把进程退出0当领取成功。

操作者分别确认 `sync --offline`（读取来源，写本机 SQLite/缓存）和正常 `sync`（上传该来源全部汇总）。scanFailed 或 `scan.snapshots=0` 不会被向导记为成功；Tokscale告警和retainedDates仅留诊断，不阻断其他有效日期；计价unknown如实保留。输出不留原始日志、来源路径、系统原始 ID 或凭据。向导最后只生成 1 小时 timer **计划**，不安装长期任务、不创建常驻进程、不自动停用设备或删除数据。

## 固定范围四方对账

先在两设备选同一个已完成北京日期 D、同一个已授权 Agent（例如 `codex`；启用其他来源后也可分别选 `grok`/`hermes`/`claude`/`workbuddy`/`cursor`）、同一个 canonical modelId M（未知为 JSON 字面值 `null`），分别设备 A/B 与合计 A+B。不同 Agent 的同名模型不能互相替代，必须按 Agent 分别对账。使用设备标识确认范围，hostname 不要求唯一。冻结 D 的来源与价格/统计版本，再开始对账。

已安装采集器没有导出命令；辅助脚本只读 SQLite 的该日期 `rollups` 与队列描述，检查快照内容 hash，输出白名单统计，**不读 meta、credential、sources 或 queue.body**：

```sh
node token-local-evidence.mjs \
  --installation '/absolute/private/install' \
  --state-dir '/absolute/private/state' \
  --date '2026-11-15' \
  --agent codex \
  --model-key '"your-canonical-model-id"'
# 未知模型用 --model-key null；Agent 默认 codex，可显式传 grok/hermes/claude/workbuddy/cursor；日期是示例，应选择两设备都有数据的已完成 D。
```

辅助输出保留缺失字段、null、实际0、费用分类/coverage、模型覆盖及是否存在所选模型；模型缺席不制造零值。输出仅为本地证据，不能称托管 summary 或 HTTP 回执。Node SQLite 的运行时提示与业务错误分开；失败只打印固定码，不输出原始数据库错误和路径。

维护者验证入口为 `npm run test:collector-evidence`，先构建采集器，再用独立合成 SQLite 核对敏感字段排除、只读不变、缺失/null/0、模型缺席、摘要篡改和错误脱敏；它不接触用户来源或线上。该入口纳入既有 Node24 `collector_linux` CI job，在系统任务测试前执行，失败会阻止既有 `validate` 门禁通过。

| 证据 | 记录内容与取得方式 |
| --- | --- |
| 本地快照 | 上述只读辅助，D/Agent/M、deviceId、generation/version/hash、metrics/cost/models |
| 上报回执 | 正常 CLI 内部严格校验 persisted/device/date/agent/generation/version/hash 后清任务；记录同步结果及前后队列变化 |
| 托管 summary | 获准网页登录后，查看同 D/Agent/设备/M 的 `/api/token/summary` 响应；同时看 `/api/token/usage` 的已收版本/hash，分页须完整 |
| 页面 | 正式看板同 D/Agent/设备/M，截图与实际值；A/B分别核对，再设备全选核对 A+B |

当前包**不保留原始上传回执**。pending 清空只说明 CLI 接受了内部匹配回执，单独不足以出具每份实际 HTTP 回执证据；有效设备可用后，由总控安排受控的本机响应观察，只留上述回执字段，不输出请求头/claim/uploadToken或原请求。未取得这一证据时，“原始回执留证”保持待验。不要为取得回执修改原包、绕过设备授权或直接插表。

网页登录的只读响应可由操作者在开发者工具 Network 中按上述路径查看响应正文；不要复制 Request Headers、Authorization、cookies 或导出 HAR。页面数字可能缩写，应与同范围原始响应逐项比对，不能仅对缩写作精确相等断言。比较 input/output/total/cacheRead/cacheWrite/reasoning、按币种费用分类及 coverage；缓存和推理是包含分量，不再次相加，不跨设备去重。

重复 sync、显式 rescan 前后比较版本/hash和相同范围统计；价格刷新导致内容变化时先记录新 priceVersion 并重新冻结基线，不能强行要求 hash 不变。断网测试需实际阻断到目标的网络并保留队列，再恢复按退避时间同步；`--offline` 本身不能代替网络失败/回执丢失。下降/模型移除不通过改写真实日志造样本，真实来源继承/fork/归档和规则修正材料由操作者指定，缺样本即待验。停用/重绑会影响本设备上传权限，按操作者明确指示通过正式网页和 `init --replace` 完成，确认拒绝及历史保留。

## 长期任务、卸载与人工记录

计划支持每1/3/6/8/12/24小时；建议先手动成功，再指定设备、周期和观察窗口。已有 `com.lifespace.token-collector` 必须先核对所属状态与备份配置，不覆盖其他安装。仅在收到针对设备的指示后，由操作者加 `--apply` 安装；Linux 的注销持续性与 macOS 真实 gui domain 另实测，不默认 enable linger。

```sh
collector='/absolute/private/install/node_modules/.bin/lifespace-usage'
state='/absolute/private/state'
"$collector" timer install --hours 1 --state-dir "$state"   # 仅计划
"$collector" timer status --state-dir "$state"
"$collector" timer uninstall --state-dir "$state"          # 仅计划
# 针对该设备明确同意卸载后再执行：
"$collector" timer uninstall --state-dir "$state" --apply
```

Linux另查 `systemctl --user status com.lifespace.token-collector.timer` 和同名 service；若本任务 oneshot 仍在运行，只停止自己的 service。macOS查 `launchctl print gui/$(id -u)/com.lifespace.token-collector`。确认不再加载/运行后，可人工移走准确的独立 install，**保留 state 和其私有备份**。本向导未安装 timer 时无需卸载系统任务。卸载不撤销设备令牌；撤权使用网页停用，历史汇总保留。

每步写：`设备别名 | OS/Node/Tokscale版本 | 包SHA | 授权Agent | D/Agent/M/设备范围 | 动作 | 预期 | 实际白名单值/固定错误码 | PASS/FAIL/未执行 | 私有证据位置`。分别签认接入辅助、Agent/CI、真实设备/线上、长期任务、用户桌面手机人工。桌面/真实手机均通过正式 HTTPS 看板登录并操作日期、Agent/设备/模型筛选、趋势、日历提示、日统计与设备状态；窄视口 Agent 检查不充当人工签认。没有获准会话和指定设备时，#223 与 #205 保持开放。

Grok 费用可能因上游 4.23.0 返回 `cost=0`/unknown 而显示未知，不读原始日志补价。Hermes 跨日拆分可能把未覆盖部分留在会话开始日；其 `codex_app_server` 与 Codex 可能重复计量，同时授权时须记录这一限制，不把采集器结果当作去重后的账单。真实 `.grok`/`.hermes` 来源、托管上传和页面四方对账必须由用户指定设备后另验，不能用合成测试替代。

Claude 的 `--home` 优先于 `CLAUDE_CONFIG_DIR`，采集器不设置后者。WorkBuddy 读取 `<source-home>/.workbuddy/workbuddy.db`。Cursor 只读 `<source-home>/.config/tokscale/cursor-cache/usage*.json`，需要操作者在采集器之外先完成 Tokscale 的 Cursor 登录与同步；该流程会联网并触及 Tokscale 自身的凭据/缓存边界，不属于本采集器授权。缓存缺失或损坏时 graph 返回空结果、退出码 0，并记录 `TOKSCALE_CURSOR_CACHE_UNAVAILABLE`；旧汇总保留，不制造零快照。真实 Cursor 数据、有效缓存和页面四方对账仍待用户指定设备后验证。
