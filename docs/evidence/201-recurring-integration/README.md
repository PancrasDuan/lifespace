# #201 集成证据

完整结果、失败记录、R01–R54映射、真实链路和限制见 [集成验收](../../adventure/recurring-integration-validation.md)，发布门禁见 [阶段计划](../../adventure/recurring-release-plan.md)。本目录截图全部为合成验收数据，无生产数据；截图不是用户验收或CI证明。

## 26状态与外围

`fixture/` 是正式前端、冻结HTTP fixture的确定性截图，1440×1000 / 390×844。原型 [approved-v1/d2a0fa4](https://github.com/PancrasDuan/lifespace/blob/d2a0fa4ccb0b52edc44595fd2fc2dff27364df97/docs/evidence/56-recurring-approved-v1/README.md)，源码6db3bdc。逐状态尺寸/摘要/像素差见 [visual-comparison.json](visual-comparison.json)：25/26与已独立复审的前端132e1bf截图逐像素相同；手机create仅 `(108,837)..(109,839)` 两像素不同，平均通道差0.0000051/255。全部26均与approved-v1同视口比较，不能把低平均差当布局或业务必然正确。

本组合的 `src/adventure` 与固定前端132e1bf相同。前端既有逐26状态的独立人工评审和5项必要差异结论保留；本轮核对差异图、4/3四事实、真实父子/手机截图与作用范围。主体页头/导航/新建区/经验/周历/一次性行没有新增设计改动；同时重新通过68项现有浏览器回归。外围相对正式main的原始比较及实际区域差值在 [#200 perimeter](../200-recurring-frontend/perimeter-comparison.json)，当前26图25张完全相同，构成同一视觉的可追溯比较链；没有声称本轮另从main启动第二套原始截图。

必要差异仍为：子任务无plannedOn；去掉演示底留白/禁用；真实分页与权威全量汇总；跨天读取真实today并保持所选旧日；4/3保留4条事实及旧要求5快照。原型演示工具、固定日期、示例数组、目标背面临时禁用不进入产品；一次性相关列表保留，不新增目标混合父子列表。

| 状态 | 桌面 | 手机 |
| --- | --- | --- |
| 今日 | [today](fixture/today-desktop-1440.png) | [today](fixture/today-mobile-390.png) |
| 父详情 | [parent](fixture/parent-desktop-1440.png) | [parent](fixture/parent-mobile-390.png) |
| 子快照 | [child](fixture/child-desktop-1440.png) | [child](fixture/child-mobile-390.png) |
| 创建 | [create](fixture/create-desktop-1440.png) | [create](fixture/create-mobile-390.png) |
| 编辑 | [edit](fixture/edit-desktop-1440.png) | [edit](fixture/edit-mobile-390.png) |
| 结束确认 | [end](fixture/end-desktop-1440.png) | [end](fixture/end-mobile-390.png) |
| 未开始日期 | [date](fixture/unstarted-date-desktop-1440.png) | [date](fixture/unstarted-date-mobile-390.png) |
| 未开始详情/删除 | [detail](fixture/unstarted-detail-desktop-1440.png) / [delete](fixture/delete-desktop-1440.png) | 同一能力 |
| 结束日 | [date](fixture/ended-date-desktop-1440.png) | [date](fixture/ended-date-mobile-390.png) |
| 结束详情/原完成日 | [detail](fixture/ended-detail-desktop-1440.png) / [completed](fixture/completed-date-desktop-1440.png) | 同一日期规则 |
| 目标数/once进度 | [goals](fixture/goals-desktop-1440.png) | [goals](fixture/goals-mobile-390.png) |
| toast/撤销/4:3/跨天 | [toast](fixture/record-toast-desktop-1440.png) / [filtered](fixture/revoked-filtered-desktop-1440.png) / [4:3](fixture/lowered-requirement-desktop-1440.png) / [crossday](fixture/crossday-desktop-1440.png) | 共用组件 |

## 真实数据库截图

`real/` 来自9项真实Worker/HTTP RPC/新隔离PG浏览器场景，日期和时间由实际服务端决定，事实与fixture示例数值不同，不能据此硬编码时钟或重写数据。包括 [桌面](real/today-1440.png) / [手机](real/today-390.png)、[父](real/parent-1440.png) / [手机父](real/parent-390.png)、[4/3](real/lowered-1440.png) / [手机4/3](real/lowered-390.png)、[子](real/child-1440.png) / [手机子](real/child-390.png)、[撤销空态](real/revoked-empty-1440.png)、[真实分页撤销](real/children-after-revoke-1440.png)、[成长历史归属](real/growth-attribution-1440.png)、[回执恢复](real/receipt-recovered-1440.png)、[历史日期](real/history-date-1440.png) 和 [结束确认](real/end-confirm-1440.png)。

`SHA256SUMS` 固定26张fixture及17张真库截图；[test-summary.json](test-summary.json) 仅保存统计，不上传轨迹；[恢复报告](recurring-restore-report.json) 明确同cluster globals及合成迁移history限制；[SQL制品](sql-artifacts.json) 记录实际字节/摘要。报告里的本机路径仅供同一工作环境复查，不代表远端制品存在。

提交后复核另见 [最终统计](final-recheck.json)、[并行超时的原非零日志](final-parallel-failure.txt)、[原条件串行整个runner的成功日志](final-serial-result.txt) 和 [预览正常/异常退出清理](preview-cleanup-check.json)。这些增量须随新的最终SHA复审，失败没有从证据中移除。

输出文本归档仅去除行尾空白；完整原始日志仍保留在本工作区忽略的.cache中。
