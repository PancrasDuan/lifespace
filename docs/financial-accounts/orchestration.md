# 账户系统开发协调

用户已确认需求、A 原型、技术方案和三项任务拆分；后续按 `implement-spec` 由独立 Orca 子 session 开发，主 session 仅协调、调度与汇报。

## 规格与任务图

- 规格：[#118](https://github.com/PancrasDuan/lifespace/issues/118)，本地镜像见 [规格](issue-spec-draft.md)、[技术方案](technical-design-draft.md)、[任务验收条件](tickets-draft.md)。
- [#119 账户管理](https://github.com/PancrasDuan/lifespace/issues/119) → 合并至集成分支 → [#120 普通流水接入](https://github.com/PancrasDuan/lifespace/issues/120) → 合并 → [#121 关联转账](https://github.com/PancrasDuan/lifespace/issues/121) → 合并 → 最终双轴评审及验证。
- 三项均为 #118 的原生子 Issue，GitHub 已设置 #120 受 #119 阻塞、#121 受 #120 阻塞。
- 集成分支：`codex/118-financial-accounts`；主工作区保持既有任务归属。开发子 worktree 显式基于集成分支，不基于旧 main，不修改集成工作区。
- GitHub Issue 保持开放直至部署验收；内部开发任务完成不代替发布完成。不使用 PR 自动关闭关键词。

## 子 session 通用约定

1. 先读项目约定、根目录 `CONTEXT.md`、相关 ADR、技术方案及所负责 Issue 的正文、标签、评论与依赖；等待工作区 setup 完成，核对分支、基线和干净状态。
2. 按 TDD 完成自己负责的纵向任务，测试接缝已经确认：正式页面 → 真实 Worker → 隔离 PostgreSQL / PostgREST，只控制身份和数据库地址；不重复询问已确认事项。
3. 使用用户级 Node.js。隔离 PostgreSQL/PostgREST 的既有本机工具入口为 `/tmp/lifespace-ledger90/tools/database-env.sh`，使用前核对可用性；该文件仅为本地测试运行路径，不包含业务凭据。不读取或输出 `.dev.vars` 的值。
4. 代码、SQL、测试在自己的 worktree 修改并提交，提交前扫描密钥。报告实际执行及通过的检查，不把未配置数据库导致的跳过当作通过。
5. 完成前合入集成分支最新提交；禁止用 reset 覆盖工作。向协调者报告分支、提交、变更、验证、运行端口及未解决项，由专门合并子 session 集成。
6. 不向 main 合并、不部署、不改生产数据库、不回填旧数据、不自行关闭 Issue。业务规则关键歧义通过 Orca `ask` 交协调者处理。

## 基线和原型

原功能基线为 `2cd7e5fe039dc50a09766844619417ab76f1e512`；实施前保存讨论成果的协调提交作为首个开发子 session 的起点。

A 布局截图在 [previews](previews/)；原型说明见 [README](../../src/ledger/accounts-prototype/README.md)。完整候选原型另保存在本地分支 `codex/118-financial-accounts-prototype`（`08a7d9e53df2ba91869b757fb6d361370990c8dc`），内存模拟代码不作为正式业务实现。

集成工作区保留本地原型源文件、配置和 5187 预览，用于设计核对；这些未跟踪文件不属于业务实现，不应被合并子 session 清理或提交。

## 交付边界

分级为需确认的变更：涉及持久化结构、余额业务规则和接口。实施和本地验证已获授权；具体生产数据库变更、合并发布及旧数据回填另行核对授权。最终按项目流程完成密钥扫描、真实数据库和浏览器验证、固定提交的双轴评审、用户界面验收、CI 与部署验收。
