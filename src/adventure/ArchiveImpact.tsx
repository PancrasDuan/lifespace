import type { AdventureState } from '../shared/adventure'
import { queryTasks, cycleMonth } from '../shared/adventure'
import { addDays } from './ui'

export function ArchiveImpact({
  state,
  today,
  kind,
  id,
}: {
  state: AdventureState
  today: string
  kind: 'container' | 'goal'
  id: string
}) {
  const goals = state.goals.filter((goal) =>
    kind === 'container' ? goal.containerId === id : goal.id === id,
  )
  const goalIds = new Set(goals.map((goal) => goal.id))
  const cycles = state.cycles.filter((cycle) => goalIds.has(cycle.goalId))
  const pendingActions = state.tasks.filter(
    (task) => goalIds.has(task.goalId) && task.completedOn && !task.settled,
  )
  const pendingGoals = goals.filter(
    (goal) => goal.completion && !goal.completion.settled,
  )
  const futureOnce = state.tasks.filter(
    (task) =>
      goalIds.has(task.goalId) &&
      !task.cycleId &&
      task.date >= today &&
      !task.completedOn &&
      !task.stopped &&
      !task.rescheduledTo,
  )
  const future = queryTasks(state, today, addDays(today, 30)).filter(
    (task) =>
      goalIds.has(task.goalId) &&
      !!task.cycleId &&
      !task.completedOn &&
      !task.stopped &&
      !task.rescheduledTo,
  )
  let dueMonths = 0
  for (const cycle of cycles) {
    for (let index = cycle.monthsSettled; ; index++) {
      const month = cycleMonth(state, cycle.id, index, today)
      if (!month.complete || month.end > today) break
      dueMonths++
    }
  }
  return (
    <section aria-label="归档影响明细" className="adventure-preview">
      <h3>归档影响明细</h3>
      <p>
        关联 {goals.length} 个目标 · {cycles.length} 个周期任务
      </p>
      <ul>
        {goals.map((goal) => (
          <li key={goal.id}>
            {goal.title} ·{' '}
            {goal.archived
              ? '已归档'
              : goal.completion
                ? '已达成，奖励冻结'
                : goal.focused
                  ? '聚焦将取消'
                  : '停止推进'}
          </li>
        ))}
      </ul>
      <p>将停止 {futureOnce.length} 项一次性任务（覆盖全部未来日期）。</p>
      {futureOnce.length > 0 && (
        <details>
          <summary>查看全部一次性安排</summary>
          <ul>
            {futureOnce.map((task) => (
              <li key={task.id}>
                {task.title} · {task.date}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        周期任务的所有后续安排均停止；今天起 31 天内的周期示例共 {future.length}{' '}
        项，不代表完整未来总数。
      </p>
      {cycles.length > 0 && (
        <ul>
          {cycles.map((cycle) => (
            <li key={cycle.id}>
              {cycle.title} ·{' '}
              {cycle.status === 'ended'
                ? '已结束，历史保留'
                : '停止后续安排，保留任务月历史'}
            </li>
          ))}
        </ul>
      )}
      <p>
        保留待结算：{pendingActions.length} 次已完成行动、{pendingGoals.length}{' '}
        项已确认目标、{dueMonths} 个已到期完整任务月。
      </p>
      {pendingActions.length > 0 && (
        <ul>
          {pendingActions.map((task) => (
            <li key={task.id}>
              {task.title} · {task.completedOn} 已完成待结算
            </li>
          ))}
        </ul>
      )}
      <p>
        过去任务、已结算经验与成就均保留；归档不发目标奖励，未满任务月不发周期奖励。
      </p>
    </section>
  )
}
