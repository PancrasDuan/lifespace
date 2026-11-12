import type { LifecyclePreview, PlanningGoal } from '../shared/adventure-planning'
import type { PlanningConfirmation } from './usePlanning'
import { GoalConfirmationFacts } from './GoalConfirmationFacts'

export const lifecycleTitles: Record<LifecyclePreview['operation'], string> = {
  endGoal: '确认结束目标', deleteTask: '删除任务',
}

export function PlanningLifecycle({ preview: current, goal, confirmation, saved, cancel }: {
  preview: LifecyclePreview; goal?: PlanningGoal; confirmation: PlanningConfirmation; saved: () => void; cancel: () => void
}) {
  const { blocked, stale } = confirmation
  if (current.operation === 'deleteTask') return <>
    <p className="task-delete-copy">确定删除“{current.title}”吗？删除后任务将从列表中移除。</p>
    {stale && <p role="status">数据已变化，请重新预览后确认删除。</p>}
    <div className="adventure-form-footer"><button type="button" disabled={blocked} onClick={cancel}>取消</button>
      {stale && <button type="button" disabled={blocked} onClick={() => { void confirmation.refresh() }}>重新预览</button>}
      <button type="button" className="adventure-primary" disabled={blocked || stale} onClick={() => { void confirmation.confirm({ type: 'deleteTask', id: current.entityId }, saved) }}>确认删除</button></div>
  </>
  return <form onSubmit={event => {
    event.preventDefault()
    void confirmation.confirm({ type: current.operation, id: current.entityId }, saved)
  }} className="goal-confirmation-form"><fieldset disabled={blocked}>
    <GoalConfirmationFacts title={current.title} goal={goal} />
    <p className="goal-confirmation-warning">结束后目标只读保留，不能恢复或再变更；已完成任务和已入账奖励不会被抹去。</p>
    {current.stoppingTasks.length > 0 && <p className="goal-confirmation-warning">{current.message}</p>}
    {(current.preservedCompletedTasks > 0 || current.preservedAchievedGoals > 0) && <p className="goal-confirmation-note">已有完成记录 {current.preservedCompletedTasks} 项、达成目标 {current.preservedAchievedGoals} 个，本次操作不会扣减经验或抹去历史。</p>}
    {stale && <p role="status">数据已变化，请重新预览操作影响。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={cancel}>取消</button>
      {stale && <button type="button" onClick={() => { void confirmation.refresh() }}>重新预览</button>}
      <button className="adventure-primary goal-end-confirm" type="submit" aria-label={lifecycleTitles[current.operation]} disabled={blocked || stale}>确认结束</button></div>
  </fieldset></form>
}
