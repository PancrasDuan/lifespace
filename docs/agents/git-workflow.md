# 开发与交付

## 分支与合并

- `main` 是生产分支。每个 Issue 从最新 `origin/main` 创建短期功能分支；AI 使用 `codex/<issue>-<name>`，人工可使用 `feature/<issue>-<name>`。
- 开发、测试和评审在功能分支完成，通过 PR 交付。PR 关联 Issue，但不使用自动关闭关键词，部署验收后再关闭 Issue。
- 合并要求 `validate` 全部通过、分支包含最新 main、讨论已解决。使用 squash merge，合并后删除功能分支。
- 单人加 AI 模式下，GitHub 必需审批数量为 0；**AI 须获得用户对具体 PR 的明确合并确认后才能合并**。同一账号的 AI 评审不充当人工确认。
- main 保护适用于管理员，禁止直接推送、强推、删除与绕过检查。变更保护规则需用户明确授权。

## 安全与验证

1. 新克隆先执行 `npm run setup:git`，启用仓库提交钩子。提交前先查看暂存范围并扫描密钥，真实凭据只放在忽略的本地配置或 Worker runtime secrets。
2. 提交钩子扫描暂存修改；`npm run check:secrets` 扫描全部本地可达历史及当前 Git 文件。固定版本的 Gitleaks 从官方发布下载，校验 SHA-256，输出脱敏。
3. PR CI 的 `validate` 先扫描密钥，再运行接口测试、安全回归、类型检查、构建和浏览器回归。CI 不注入业务密钥，不上传测试轨迹或构建产物。
4. 每次提交和评审重点检查密钥、敏感日志、前端资源和公开响应。扫描命中必须解决；仅允许为已核实的具体假值或误报添加窄范围规则，不可整体豁免文件或测试目录。
5. PR 合并前完成规范与需求双轴 code-review，记录验证结果，等待用户确认。

GitHub 已启用原生 secret scanning 与 push protection，作为已支持密钥格式的补充。

本地钩子可能未安装或被绕过；main 的必需 CI 是服务端门禁。扫描降低风险，不能证明没有任何敏感信息。

## 发布验收

main 合并后由 Cloudflare Workers Builds 自动发布；生产分支为 main，非生产分支预览关闭。GitHub CI 负责合并门禁，Cloudflare 构建负责部署。

确认 Cloudflare 部署成功且提交 SHA 对应本次合并，核验生产页面、相关只读接口与密钥隔离，再关闭 Issue。部署失败时保持 Issue 开放，通过新分支和 PR 修复；紧急生产回滚需用户明确授权。
