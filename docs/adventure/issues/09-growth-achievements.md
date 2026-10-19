# 09：查看实时经验流水与成就证据

状态：2026-10-19 当前验收要求，待实现；既有检查不代表本版通过。

## Parent

https://github.com/PancrasDuan/lifespace/issues/53

## What to build

关联完成时的主线、目标、任务快照及历史事实；奖励记录处理、结算和成长反馈待后续独立梳理。

## Acceptance criteria

- [ ] 每次完成记录保存当时 mainlineId、goalId、taskId、日期及必要快照；独立任务 goalId 为空，当前迁移不重写历史。取消完成不追加冲正，奖励记录处理另议。
- [ ] 改名、迁移、结束不改完成时的归属及历史快照，缺失历史明确标注；取消完成涉及的奖励记录删除边界待后续确认，不保留原流水一律不可删除的要求。
- [ ] 行动 1／10／50／100、目标 1／3／10、单周期达标月 3／6／12 共 10 类成就，成长反馈细节另行梳理，不额外加分。
- [ ] 合法当天撤销导致等级回退或成就条件不满足时，等级与成就同步调整；保留原解锁和撤回证据。暂停或某月不达标不清空长期积累。
- [ ] 成就条件、进度、差额、日期和触发记录可追溯；长期按单周期判断，同类合并展示，不拼接不同任务达标月。
- [ ] XP、等级、有效行动数、达成目标数、周期达标月与流水完整核对，分页不截断统计。

## Blocked by

- https://github.com/PancrasDuan/lifespace/issues/59
- https://github.com/PancrasDuan/lifespace/issues/60
- https://github.com/PancrasDuan/lifespace/issues/61

状态：需求已更新，待实现；不恢复开发。远端 Issue 正文尚未同步。

覆盖规格用户故事：30, 31, 32。
