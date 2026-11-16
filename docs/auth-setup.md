# 认证接入与验收

代码、模拟流程与页面用户验收已通过。邮件采用 Resend，发信域名为 `onepeace.bbroot.com`；用户已确认保存 SMTP 与注册 Hook 配置，`SUPABASE_PUBLISHABLE_KEY` 与 `AUTH_HOOK_SECRET` 两个 Worker 认证项已核验为 Secret。PR #38 已合并并发布；真实注册邮件、邮箱确认和密码登录已通过。其余生产验收见下文。

## 配置

现有 Supabase 项目显示名为 `lifespace`，曾用名为 `personal_os`。在控制台按仓库 [wrangler.jsonc](../wrangler.jsonc) 中 `SUPABASE_URL` 的项目标识确认同一项目，再配置该项目的认证与密钥。

1. 在该项目启用邮箱密码认证与邮箱确认。保持多会话可用，不设置固定登录期限，关闭匿名登录及未使用的登录方式。
2. 配置 Site URL 为 `https://lifespace.onepeace.cc.cd`，允许回跳 `/auth/callback` 和 `/auth/reset`；本地调试只添加所用回环地址，不使用宽泛生产通配地址。PKCE 邮件链接应在发起注册或恢复的浏览器打开。注册验证链接在其他浏览器打开时，可能已完成邮箱验证，但不能自动登录；使用邮箱和密码登录即可继续。
3. 将以下值保存为 Worker runtime secrets。本地使用忽略的 `.dev.vars`，示例见根目录 `.dev.vars.example`，不要把真实值写进 Issue、终端日志或聊天。`AUTH_ALLOWED_EMAILS` 不再作为 Worker secret，改由 `AUTH_KV` 读取。

| 配置 | 内容 |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | 当前项目的 publishable key，允许通过公开配置接口下发；不能替换为 secret key 或 service_role |
| `AUTH_HOOK_SECRET` | Supabase HTTP Hook 生成的签名密钥，支持控制台给出的 `v1,` 前缀 |

4. 创建独立的 Cloudflare KV namespace 并在 Wrangler 绑定为 `AUTH_KV`；键名固定为 `AUTH_ALLOWED_EMAILS`，值为逗号分隔的获准邮箱。读取时逐项 trim、转小写并按完整邮箱匹配。binding 缺失、键缺失、空值、任一非法邮箱或读取异常均返回 503；名单外返回 403，不回退旧 secret，也不默认放行。
5. 在 Auth Hooks 启用 `Before User Created`，地址为 `https://lifespace.onepeace.cc.cd/api/auth/hooks/before-user-created`；将签名密钥配置到 Worker。启用前，客户端可绕过注册页直接调用 Supabase，所以必须完成此项才能对外开放注册。
6. 在 Supabase → Authentication → Notifications → Email → SMTP Settings 启用自定义 SMTP，使用下表配置。Resend 域名须显示 `Verified`，API Key 直接填入 Supabase 控制台，不保存到本站前端、Worker 或 Git。

| SMTP 配置 | 值 |
|---|---|
| Sender email | `noreply@onepeace.bbroot.com` |
| Sender name | `LifeSpace` |
| Host | `smtp.resend.com` |
| Port | `465`，SSL/TLS |
| Username | `resend` |
| Password | Resend API Key |

参数依据 [Resend 官方 Supabase SMTP 接入说明](https://resend.com/docs/send-with-supabase-smtp)。发信域名只用于认证邮件，Site URL 与回跳地址使用上文的 LifeSpace 网站地址。

## 白名单更新与最终一致性

网页会话、注册 Hook 与 Agent 鉴权每次请求都异步读取同一个 `AUTH_KV/AUTH_ALLOWED_EMAILS`，不在进程内缓存白名单。Cloudflare KV 为最终一致存储：写入或移除后，通常在当前边缘位置立即可见，但其他位置可能继续读到旧值，最长约 60 秒或更久；读取过旧值的位置可能更晚更新。因此应表述为“KV 传播后拒绝”，不能宣称“移除后立即拒绝”。不收回已返回数据或回滚在途请求。

更新时由获准运维人员通过 Cloudflare Dashboard 或受控 CLI 直接写入 KV，不在 Issue、PR、日志或聊天中粘贴真实邮箱。可先在 `umask 077` 的受控 shell 中把值写入 `chmod 600` 的临时文件，再执行 `npx wrangler kv key put AUTH_ALLOWED_EMAILS --path <临时文件> --binding AUTH_KV --remote`，完成后立即删除临时文件。不要把真实名单放进 `.dev.vars.example`、测试 fixture 或任何 Git 文件。

从 Secret 迁移到 KV 使用停流量窗口，不把等待传播做成发布门禁：先把现有名单写入 KV（旧 Worker 仍读 Secret，不受影响），再停止生产流量并部署只读取 KV 的 Worker。恢复流量前，从生产入口用受控探针确认已路由到新 Worker 且名单读取成功；探针失败或仍命中旧 Worker 时保持停流量并等待/重试，不回退旧 secret。该窗口只解决迁移空窗，不改变日常白名单更新的最终一致语义。

本地开发先启动一次 `npm run dev` 以创建本地 KV 状态，再执行 `npx wrangler kv key put AUTH_ALLOWED_EMAILS <示例邮箱> --binding AUTH_KV --local`；本地值只用于隔离调试。

## 发布顺序

1. 发布前确认 Site URL、两个精确回跳地址、邮箱确认开关、SMTP、注册 Hook 和其余 Worker Secret。尚未部署的 Hook 端点会拒绝注册，不能将 404 视为接入成功。
2. **先迁移数据，再停流量部署。** 由获准运维人员把现有白名单值写入 `AUTH_KV/AUTH_ALLOWED_EMAILS`，并用受控只读方式确认键存在、格式合法；不得导出或展示真实值。若无法安全读取旧 Secret，由用户从受控来源重新整理并直接写入 KV，不把值回显到终端。写入期间旧 Worker 仍读 Secret；随后停止生产流量，发布只读取 KV 的 Worker。恢复流量前从生产入口用受控探针确认新 Worker 已接管且名单读取成功，覆盖实际使用的生产域名/边缘；探针失败或仍命中旧 Worker 时保持停流量并等待/重试，不恢复旧 secret。顺序颠倒会使新代码在键写入前对全部业务请求返回 503。
3. 用户对待发布 PR 明确确认合并后，按项目流程 squash merge，等待 Cloudflare 自动发布，核对部署 SHA、`AUTH_KV` 绑定和 Secret 状态。部署脚本会在 `AUTH_KV` 仍是占位 ID 时停止，不自动创建生产资源。
4. 使用用户指定的获准邮箱进行真实注册与恢复验收。真实账户密码由用户在页面输入，验证与恢复链接由用户在发起操作的浏览器打开。
5. 完成下列生产验收后关闭任务。模拟服务不用于真实密码或收信验收。

回退时在停流量窗口内恢复上一版 Worker，并保留 KV 键与 namespace；不要删除 KV 或重新引入旧 secret 作为默认回退。若 KV 写入有误，修正键值后重新探针核验。

## 验收

- 名单内注册、邮箱验证、登录回跳到现有首页；名单外直接调用 Supabase 注册也被 Hook 拒绝。
- 无凭据、过期或已撤销凭据不能读取业务 API；配置缺失和 Auth 断网返回 503，不能默认放行。
- 多标签页并发续期、休眠与断网恢复后保持正确会话；多个浏览器独立登录，退出只撤销当前浏览器。
- 密码恢复完成后，所有旧浏览器的未过期 token 均被 Worker 拒绝；撤销失败明确显示待完成，并且重试不再更新密码。
- 从白名单移除后，待 KV 传播完成，所有浏览器的后续业务访问被拒绝，已有业务界面清除；保留用户首页设置。迁移切换使用停流量窗口，不代表日常移除即时生效；传播与异地复核属于生产验收，不能用进程内替身测试代替。
- `AUTH_KV` 缺失、键缺失、空值、损坏或读取异常时返回 503；不得回退旧 secret 或默认放行。
- 检查生产静态资源、公开配置与响应中不存在服务端密钥、Hook 密钥和完整白名单；确认部署 SHA，再关闭任务。

自动模拟检查使用 `npm run test:api`、`npm run test:browser`、`npm run test:security:portable` 与 `npm run build`。它们不调用真实 Supabase、不发送邮件，不能代替上述接入验收。
