import { useRef, type ReactNode } from 'react'
import { ChevronDown, CircleCheck, Target } from 'lucide-react'
import type { PlanningCommand, PlanningGoal } from '../shared/adventure-planning'
import { MoreActions, Progress, Record } from './PrototypeRecord'

type Action = (command: PlanningCommand) => Promise<boolean>
export function PrototypeGoals({ goals, blocked, action, openGoal, toggleGoal, detail }: {
  goals: PlanningGoal[]; blocked: boolean; action: Action; openGoal?: string; toggleGoal: (id: string) => void
  detail: (goal: PlanningGoal) => ReactNode
}) {
  const dragged = useRef<PlanningGoal | undefined>(undefined)
  const move = (goal: PlanningGoal, direction: 'up' | 'down', targetId?: string) => {
    if (goal.status !== 'active') return
    void action({ type: 'reorderGoals', mainlineId: goal.mainlineId, id: goal.id, direction, ...(targetId ? { targetId } : {}) })
  }
  return <div className="record-list adventure-proto-goal-list">{goals.map(goal => {
    const open = openGoal === goal.id
    return <article className={`record adventure-proto-goal${open ? ' is-open' : ''}${goal.status === 'achieved' ? ' is-terminal' : ''}`} key={goal.id} aria-label={`目标卡：${goal.title}`}
      draggable={!blocked && goal.status === 'active' && goal.capabilities.reorder?.allowed}
      onDragStart={event => { if (blocked) { event.preventDefault(); return }; dragged.current = goal; event.dataTransfer.setData('text/plain', goal.id); event.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { dragged.current = undefined }}
      onDragOver={event => { const source = dragged.current; if (!blocked && source?.status === 'active' && goal.status === 'active' && source.id !== goal.id && source.mainlineId === goal.mainlineId && source.focused === goal.focused) event.preventDefault() }}
      onDrop={event => { event.preventDefault(); const source = dragged.current; dragged.current = undefined
        if (!blocked && source?.status === 'active' && goal.status === 'active' && source.id !== goal.id && source.mainlineId === goal.mainlineId && source.focused === goal.focused)
          move(source, source.sortOrder < goal.sortOrder ? 'down' : 'up', goal.id) }}>
      <button type="button" className="record-summary" aria-label={`目标：${goal.title}`} aria-expanded={open} aria-controls={`goal-${goal.id}-details`} aria-disabled={blocked} onClick={() => { if (!blocked) toggleGoal(goal.id) }}>
        <span className="record-mark"><Target size={17} /></span>
        <span className="record-copy"><span className="record-kicker">{goal.independent ? '独立目标' : goal.mainlineName}{goal.focused && <em>聚焦中</em>}</span><strong>{goal.title}</strong>
          <span className="goal-progress-line">{goal.progress.ratio === null ? <small>暂无可统计任务</small> : <><Progress value={goal.progress.ratio} label="目标任务进度" /><small>{goal.status === 'achieved' ? '已达成' : `${goal.progress.completed} / ${goal.progress.total}`}</small></>}</span></span>
        <span className="record-meta"><span>{goal.status === 'achieved' ? '已达成' : goal.status === 'ended' ? '已结束' : '进行中'}</span><ChevronDown size={16} className={open ? 'is-open' : ''} /></span>
      </button>
      {open && <div className="record-details" id={`goal-${goal.id}-details`}>{detail(goal)}</div>}
    </article>
  })}</div>
}
