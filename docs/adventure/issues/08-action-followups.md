# 08：重新安排漏做任务并记录周期额外完成

状态：2026-10-19 本地验收要求；新规范待实现，本次不启动开发，远端 Issue 正文尚未同步。旧测试不证明新规则通过。

## Parent

https://github.com/PancrasDuan/lifespace/issues/53

## What to build

从过去漏做任务建立关联新安排，或为周期记录当天另一次真实活动，经验准确反映实际行动且不刷计划分母。

## Acceptance criteria

- [ ] 重新安排保留过去原记录、新记录关联来源且清单重置，可选今天或未来；创建不计奖。
- [ ] 同一行动已有可执行后续安排或已完成则禁止重复安排；同一行动跨记录最多一次单次及目标计奖。
- [ ] 周期额外完成需确认真实另一次活动，独立行动ID，当天可撤销／恢复；不得跨天补记。
- [ ] 额外只增实际和单次XP，不增计划；非计划日也不增计划，完成率封顶且每月达标最多+1。
- [ ] 重新安排、额外完成与周期规则变更、结束和目标冻结组合符合边界；任务快照与来源链可查看。

## Blocked by

- https://github.com/PancrasDuan/lifespace/issues/58
- https://github.com/PancrasDuan/lifespace/issues/59
- https://github.com/PancrasDuan/lifespace/issues/60

状态：需求已更新，待实现；不恢复开发。

覆盖规格用户故事：14, 15。
