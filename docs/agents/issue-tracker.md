# 任务跟踪

规格和开发任务记录在 `PancrasDuan/lifespace` 的 GitHub Issues，使用 `gh` CLI 操作。

- 创建：`gh issue create --title "<标题>" --body-file <文件>`
- 读取：`gh issue view <编号> --comments`
- 列表：`gh issue list --state open`
- 标签：`gh issue edit <编号> --add-label "<标签>"`
- 评论：`gh issue comment <编号> --body-file <文件>`
- 关闭：`gh issue close <编号>`

多行正文通过 UTF-8 文件传入。发布规格或任务时创建 Issue；读取任务时同时读取正文、标签和评论。

任务依赖优先使用原生依赖关系，不可用时在正文列出阻塞任务。

PRs as a request surface: no.
