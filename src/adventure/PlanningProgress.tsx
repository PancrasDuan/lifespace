import type { PlanningPage } from '../shared/adventure-planning'

export function PlanningProgress({ value, label }: { value: PlanningPage['taskProgress']; label: string }) {
  return <div role="group" className="planning-progress" aria-label={label}>
    {value.ratio === null ? <small>暂无可统计任务</small> : <>
      <div><small>{label}</small><span>{value.completed} / {value.total}</span></div>
      <progress aria-label={label} max={1} value={value.ratio} />
    </>}
  </div>
}
