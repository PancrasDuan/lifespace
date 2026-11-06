# Issue #130：Cloudflare Access + MCP 隔离 demo

这是一次性技术验证，不是生产实现。它不连接 Supabase，也不创建或保存真实流水。`preview_demo_entry` 只返回模拟回执；账户和身份是固定的演示数据。

本地检查（使用项目约定的 Node.js）：

```bash
/home/lighthouse/.nvm/versions/node/v24.22.1/bin/node docs/poc/130-access-mcp-demo/verify.mjs
```

## 云端验证记录

2026-11-06，在 LifeSpace 对应 Cloudflare 账户中临时创建独立的 `workers.dev` Worker、仅指向该 Worker 的 Access 应用、一个 Service Auth 策略及两枚一小时有效的 Service Token。Worker 通过签名、签发者、受众与有效期验证 Access 断言，再将已验证的服务凭据标识映射到模拟用户；演示不使用生产站点路由或业务资源。

- 两枚凭据分别通过 MCP `tools/call` 读取各自模拟账户，返回 HTTP 200；A 访问 B 的模拟账户被拒绝。
- 无凭据请求被 Cloudflare Access 拒绝（403）；错配的 Client ID / Client Secret 请求返回 401。
- 禁用 A 的 Service Token 后，在立即、约 5 秒、约 20 秒检查均返回 401；控制 API 返回 `enabled: false`。先前一次测试在禁用后的首次检查仍返回 200，因此不能据此断言禁用在所有地点都即时生效。
- 测试凭据、Access 策略、Access 应用和独立 Worker 均已删除。没有保留可访问的云端 demo 或测试凭据。

## 验证边界

云端使用脚本发送 MCP JSON-RPC 请求，验证了 `tools/call` 和身份映射；尚未用 Codex、WorkBuddy 或 Grok Bot 实际连接，也未证明完整 MCP 协议兼容性。未测试真实账单数据库、余额、生产部署或真实用户身份绑定。此 demo 为诊断而返回简化的校验失败原因，不作为正式服务的错误设计。

生产应用使用 Workers Static Assets，不应假设本 demo 的部署方式和生产路由完全相同。正式方案还需设计可信的凭据与用户绑定、准入白名单、独立凭据的管理和撤销，并按项目流程完成安全与业务评审。
