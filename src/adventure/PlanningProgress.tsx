import type { PlanningPage } from '../shared/adventure-planning'

export function PlanningProgress({ value, label, compact = false }: { compact?: boolean; value: PlanningPage['taskProgress']; label: string }) {
  return <span role="group" className="planning-progress" aria-label={label}>
    {value.ratio === null ? <small>暂无可统计任务</small> : <>
      <span><small>{label}</small><span>{value.completed} / {value.total}</span></span>
      {compact ? <span className="planning-progress-track" aria-hidden="true"><span style={{ width: `${value.ratio * 100}%` }} /></span> : <progress aria-label={label} max={1} value={value.ratio} />}
    </>}
  </span>
}
