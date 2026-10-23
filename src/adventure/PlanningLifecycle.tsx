import { useEffect, useRef, useState } from 'react'
import type { LifecyclePreview, PlanningCommand } from '../shared/adventure-planning'

export const lifecycleTitles: Record<LifecyclePreview['operation'], string> = {
  endGoal: '确认结束目标', endMainline: '确认结束主线', endTask: '确认结束任务', deleteTask: '确认删除误建任务',
}

export function PlanningLifecycle({ preview, version, blocked, action, repreview, saved, cancel }: {
  preview: LifecyclePreview; version: number; blocked: boolean;
  action: (command: PlanningCommand, expectedVersion?: number) => Promise<boolean>;
  repreview: () => Promise<LifecyclePreview | undefined>; saved: () => void; cancel: () => void
}) {
  const [current, setCurrent] = useState(preview)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const stale = current.version !== version
  return <form onSubmit={event => {
    event.preventDefault()
    void action({ type: current.operation, id: current.entityId }, current.version).then(ok => { if (ok && mounted.current) saved() })
  }}><fieldset disabled={blocked}>
    <h3>{current.title}</h3>
    <p>{current.message}</p>
    <h4>{current.operation === 'deleteTask' ? '删除范围' : '将停止的目标'}（{current.operation === 'deleteTask' ? 1 : current.stoppingGoals.length}）</h4>
    {current.operation === 'deleteTask' ? <p>仅移除这一项尚未开始的误建任务。</p>
      : current.stoppingGoals.length ? <ul>{current.stoppingGoals.map(goal => <li key={goal.id}>{goal.title}</li>)}</ul> : <p>没有待停止的目标。</p>}
    {current.operation !== 'deleteTask' && <>
      <h4>将停止的任务（{current.stoppingTasks.length}）</h4>
      {current.stoppingTasks.length ? <ul>{current.stoppingTasks.map(task => <li key={task.id}>{task.title} · {task.plannedOn}</li>)}</ul> : <p>没有待停止的任务。</p>}
    </>}
    {current.operation === 'deleteTask' && <p>执行日期：{current.plannedOn} · 已有安排／完成历史 {current.historicalArrangements ?? 0} 项</p>}
    <p>已有完成记录 {current.preservedCompletedTasks} 项、达成目标 {current.preservedAchievedGoals} 个，结束不会扣减经验或抹去历史。</p>
    {stale && <p role="status">数据已变化，请重新预览结束影响。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={cancel}>取消</button>
      <button type="button" onClick={() => { void repreview().then(value => { if (mounted.current && value) setCurrent(value) }) }}>重新预览</button>
      <button className="adventure-primary" type="submit" disabled={blocked || stale}>{lifecycleTitles[current.operation]}</button></div>
  </fieldset></form>
}
