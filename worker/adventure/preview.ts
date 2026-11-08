import type { PlanningCommand } from '../../src/shared/adventure-planning'
import { reject, type Transaction } from '../database'
import { goalReward, impact } from './commands'
import { bounded, check, entity, growth, type Event, type Goal } from './model'

export async function preview(db: Transaction, owner: string, expectedVersion: number, command: PlanningCommand) {
  const row = (await db.rows('select revision from public.adventure_accounts where owner_id=$1 for share', [owner]))[0]
  const version = Number(row?.revision ?? 0)
  if (version !== expectedVersion) reject('VERSION_CONFLICT')
  const today = (await db.one("select (clock_timestamp() at time zone 'Asia/Shanghai')::date::text today")).today as string
  await check(db, owner, command, today)
  const base = { version, today, allowed: true }
  if (command.type === 'endGoal' || command.type === 'endMainline' || command.type === 'deleteTask') {
    const message =
      command.type === 'endGoal'
        ? '结束目标后不可恢复；已有完成记录和经验保持不变。'
        : command.type === 'endMainline'
          ? '结束主线后不可恢复，进行中目标将结束；已有达成结果、完成记录和经验保持不变。'
          : '删除后任务将从规划中移除，保留历史事实和请求回执，不扣除经验。'
    return bounded({ ...(await impact(db, owner, command)), ...base, requiresConfirmation: true, message })
  }
  if (command.type === 'achieveGoal') {
    const goal = await entity<Goal>(db, owner, 'goals', command.id),
      plan = await goalReward(db, owner, goal.id, 1),
      count = plan.reward.calculation.count
    return bounded(
      {
        ...base,
        requiresConfirmation: true,
        operation: 'achieveGoal',
        goalId: goal.id,
        title: goal.title,
        standards: goal.standards,
        message: '达成后不可撤销，已有成果与任务历史将只读保留。',
        rewards: [1, 2, 3].map((coefficient) => ({
          amount: count ? count * coefficient : 1,
          calculation: { ...plan.reward.calculation, coefficient },
        })),
        stoppingTasks: [],
      },
      1_000_000
    )
  }
  if (command.type === 'cancelTaskCompletion') {
    const done = await entity<Event>(db, owner, 'events', command.completionId)
    return {
      ...base,
      requiresConfirmation: true,
      message: `取消后移除这次行动和 ${done.amount} 点经验，等级及成就随有效记录更新`,
      reward: { amount: done.amount, calculation: done.calculation },
      growthBefore: await growth(db, owner),
      growthAfter: await growth(db, owner, -done.amount, -1),
      completionId: done.id,
    }
  }
  return {
    ...base,
    requiresConfirmation: false,
    message: command.type === 'completeTask' ? '可直接完成今天的行动，实时获得 1 点经验' : '保存后更新规划，不改变目标状态或经验',
  }
}
