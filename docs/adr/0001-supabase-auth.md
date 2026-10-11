# 前端 SDK 管理认证，Worker 验证准入

LifeSpace 复用 Supabase 项目 `personal_os`。前端固定使用 `@supabase/supabase-js` 管理邮箱密码注册、登录、验证、恢复及自动续期；Worker 不接收 refresh token、不转发续期、不保存会话。认证规格见 [#33](https://github.com/PancrasDuan/lifespace/issues/33)，页面采用已确认的 [B 原型](https://github.com/PancrasDuan/lifespace/tree/codex/33-auth-prototype/docs/poc/auth-prototype)。

## 准入与撤销

- 网页外壳公开，业务界面需通过 `/api/auth/me`。所有业务 API 每次在线调用 Auth `/auth/v1/user`，校验普通用户、已验证邮箱、有效 `session_id` 及当前白名单；准入结果不缓存。身份无效返回 401，非白名单返回 403，配置或认证服务故障返回 503，均拒绝业务访问。
- `Before User Created` HTTP Hook 校验 Standard Webhooks 签名、时间戳和原文，按同一白名单限制账户创建。Supabase 项目必须启用此 Hook，才能覆盖直接注册接口。
- 白名单按完整邮箱规范化匹配，保存在 Worker runtime secrets 或忽略的本地配置，不进入前端、Git 或公开配置接口。名单移除后，后续业务请求立即拒绝；不收回已返回的数据或回滚在途请求。
- 不设置固定登录期限。不同浏览器可同时登录，同源标签页共享 SDK 存储。SDK 负责续期及并发协调；业务读取仅在明确过期时续期并重试一次，撤销和拒绝准入不能通过刷新绕过。
- 当前浏览器退出使用用户 JWT 执行 `local` 撤销；密码恢复先更新密码，再执行 `global` 撤销。核对远端撤销成功后才清理 SDK 本地状态，避免普通 `signOut` 忽略部分错误。密码已更新而撤销失败时只重试撤销，刷新页面保留本标签页的待撤销标记。
- 收到准入失败后卸载业务界面、清空 React Query 数据，保留首页地区等已有浏览器设置。认证服务故障不删除 SDK 会话，允许恢复后重试。

## 接入边界

浏览器仅获得项目 URL 和 publishable key；现有业务服务端密钥与数据库读取仍在 Worker。生产静态资源设置 CSP，禁止外部脚本并仅允许连接当前 Auth 项目；更换项目需同步修改 `public/_headers`。

邮件由 Supabase 自定义 SMTP 接入 Resend，发信域名为 `onepeace.bbroot.com`，默认发件人为 `LifeSpace <noreply@onepeace.bbroot.com>`。Resend API Key 仅配置在 Supabase SMTP 密码字段。代码、外部 HTTP 模拟及页面用户验收已通过，生产注册邮件、邮箱确认与密码登录已通过；会话撤销及其余生产场景仍需验收，不新增付费服务或自建会话数据库。

在线会话检查依据 [Auth 服务端源码](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/internal/api/user.go)，SDK 行为依据固定安装版本及 [SDK 源码](https://github.com/supabase/supabase-js/tree/0ea16af3ebb488ae4ca62925cc24cfb92602b6f6)。实际接入验收仍须证明撤销后的未过期 token 被本站 Worker 拒绝。
