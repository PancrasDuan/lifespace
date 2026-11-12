import type { PlanningGoal } from '../shared/adventure-planning'

export function GoalConfirmationFacts({ title, goal }: { title: string; goal?: PlanningGoal }) {
  const progress = goal?.progress
  return <dl className="goal-confirmation-facts">
    <div><dt>当前目标</dt><dd>{title}</dd></div>
    <div><dt>任务进度</dt><dd>{progress ? progress.ratio === null ? '暂无可统计任务' : `${progress.completed} / ${progress.total}` : '—'}</dd></div>
    <div><dt>未完成任务</dt><dd>{progress ? `${progress.total - progress.completed} 项` : '—'}</dd></div>
  </dl>
}
