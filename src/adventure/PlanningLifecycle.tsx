import type { LifecyclePreview } from '../shared/adventure-planning'
import type { PlanningConfirmation } from './usePlanning'

export const lifecycleTitles: Record<LifecyclePreview['operation'], string> = {
  endGoal: '确认结束目标', deleteTask: '删除任务',
}

export function PlanningLifecycle({ preview: current, confirmation, saved, cancel }: {
  preview: LifecyclePreview; confirmation: PlanningConfirmation; saved: () => void; cancel: () => void
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
  }}><fieldset disabled={blocked}>
    <h3>{current.title}</h3>
    <p>{current.message}</p>
    <h4>将停止的目标（{current.stoppingGoals.length}）</h4>
    {current.stoppingGoals.length ? <ul>{current.stoppingGoals.map(goal => <li key={goal.id}>{goal.title}</li>)}</ul> : <p>没有待停止的目标。</p>}
    <h4>将停止的任务（{current.stoppingTasks.length}）</h4>
    {current.stoppingTasks.length ? <ul>{current.stoppingTasks.map(task => <li key={task.id}>{task.title} · {task.plannedOn}</li>)}</ul> : <p>没有待停止的任务。</p>}
    <p>已有完成记录 {current.preservedCompletedTasks} 项、达成目标 {current.preservedAchievedGoals} 个，本次操作不会扣减经验或抹去历史。</p>
    {stale && <p role="status">数据已变化，请重新预览操作影响。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={cancel}>取消</button>
      <button type="button" onClick={() => { void confirmation.refresh() }}>重新预览</button>
      <button className="adventure-primary" type="submit" disabled={blocked || stale}>{lifecycleTitles[current.operation]}</button></div>
  </fieldset></form>
}
