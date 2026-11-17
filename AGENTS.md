## Agent skills

### 必读：踩坑与防范

每次开始任务时，先阅读 `docs/agents/lessons-learned.md`；拆分任务、交接、实现、评审和验收时按其中适用要求执行。

### 任务跟踪

规格和任务使用 GitHub Issues，见 `docs/agents/issue-tracker.md`。

### 任务标签

使用五个默认分类标签，见 `docs/agents/triage-labels.md`。

### 领域文档

使用根目录 `CONTEXT.md` 和 `docs/adr/`，见 `docs/agents/domain.md`。

### 开发与交付

开始开发、创建或切换分支、交接任务、并行开发、评审、提交、创建或合并 PR、部署验收及清理工作区前，先读 `docs/agents/git-workflow.md`。

### 方案设计与上线标准

- 方案设计、技术取舍、契约边界、数据迁移和 ADR 触发条件，见 `docs/agents/solution-design.md`。
- 合并、生产发布、数据库迁移、停机停流、回滚和生产验收，见 `docs/agents/release-standards.md`。
- 本项目是个人项目：能用停机、停流、回滚上一版或关闭入口解决的问题，不写过度防御代码；安全、隐私、账户隔离和不可逆数据保护不因此降级。
- 优先复用成熟模块，不重复实现通用能力；固定版本并核对许可证、维护状态、失败边界和替换方式。
