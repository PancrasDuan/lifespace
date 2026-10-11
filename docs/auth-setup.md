# 认证接入与验收

代码、模拟流程与页面用户验收已通过。邮件采用 Resend，发信域名为 `onepeace.bbroot.com`；用户已确认保存 SMTP 与注册 Hook 配置，三个 Worker 认证项已核验为 Secret。真实投递与生产接入仍需验收。

## 配置

1. 在现有 Supabase 项目 `personal_os` 启用邮箱密码认证与邮箱确认。保持多会话可用，不设置固定登录期限，关闭匿名登录及未使用的登录方式。
2. 配置 Site URL 为 `https://lifespace.onepeace.cc.cd`，允许回跳 `/auth/callback` 和 `/auth/reset`；本地调试只添加所用回环地址，不使用宽泛生产通配地址。PKCE 邮件链接应在发起注册或恢复的浏览器打开。
3. 将以下值保存为 Worker runtime secrets。本地使用忽略的 `.dev.vars`，示例见根目录 `.dev.vars.example`，不要把真实值写进 Issue、终端日志或聊天。

| 配置 | 内容 |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | 当前项目的 publishable key，允许通过公开配置接口下发；不能替换为 secret key 或 service_role |
| `AUTH_ALLOWED_EMAILS` | 获准邮箱，逗号分隔；空值或任一格式错误均拒绝准入 |
| `AUTH_HOOK_SECRET` | Supabase HTTP Hook 生成的签名密钥，支持控制台给出的 `v1,` 前缀 |

4. 在 Auth Hooks 启用 `Before User Created`，地址为 `https://lifespace.onepeace.cc.cd/api/auth/hooks/before-user-created`；将签名密钥配置到 Worker。启用前，客户端可绕过注册页直接调用 Supabase，所以必须完成此项才能对外开放注册。
5. 在 Supabase → Authentication → Notifications → Email → SMTP Settings 启用自定义 SMTP，使用下表配置。Resend 域名须显示 `Verified`，API Key 直接填入 Supabase 控制台，不保存到本站前端、Worker 或 Git。

| SMTP 配置 | 值 |
|---|---|
| Sender email | `noreply@onepeace.bbroot.com` |
| Sender name | `LifeSpace` |
| Host | `smtp.resend.com` |
| Port | `465`，SSL/TLS |
| Username | `resend` |
| Password | Resend API Key |

参数依据 [Resend 官方 Supabase SMTP 接入说明](https://resend.com/docs/send-with-supabase-smtp)。发信域名只用于认证邮件，Site URL 与回跳地址使用上文的 LifeSpace 网站地址。

## 发布顺序

1. 发布前确认 Site URL、两个精确回跳地址、邮箱确认开关、SMTP、注册 Hook 和三个 Worker Secret。尚未部署的 Hook 端点会拒绝注册，不能将 404 视为接入成功。
2. 用户对 PR #38 明确确认合并后，按项目流程 squash merge，等待 Cloudflare 自动发布，核对部署 SHA 与 Secret 是否实际生效。
3. 使用用户指定的获准邮箱进行真实注册与恢复验收。真实账户密码由用户在页面输入，验证与恢复链接由用户在发起操作的浏览器打开。
4. 完成下列生产验收后关闭任务。模拟服务不用于真实密码或收信验收。

## 验收

- 名单内注册、邮箱验证、登录回跳到现有首页；名单外直接调用 Supabase 注册也被 Hook 拒绝。
- 无凭据、过期或已撤销凭据不能读取业务 API；配置缺失和 Auth 断网返回 503，不能默认放行。
- 多标签页并发续期、休眠与断网恢复后保持正确会话；多个浏览器独立登录，退出只撤销当前浏览器。
- 密码恢复完成后，所有旧浏览器的未过期 token 均被 Worker 拒绝；撤销失败明确显示待完成，并且重试不再更新密码。
- 移除白名单后，所有浏览器的后续业务访问被拒绝，已有业务界面清除；保留用户首页设置。
- 检查生产静态资源、公开配置与响应中不存在服务端密钥、Hook 密钥和完整白名单；确认部署 SHA，再关闭任务。

自动模拟检查使用 `npm run test:api`、`npm run test:browser`、`npm run test:security:portable` 与 `npm run build`。它们不调用真实 Supabase、不发送邮件，不能代替上述接入验收。
