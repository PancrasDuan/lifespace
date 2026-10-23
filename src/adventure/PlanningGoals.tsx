import { useRef, type ReactNode } from 'react'
import type { PlanningCommand, PlanningGoal } from '../shared/adventure-planning'
import { PlanningProgress } from './PlanningProgress'
import { PlanningRecord } from './PlanningRecord'

type Action = (command: PlanningCommand) => Promise<boolean>
export function PlanningGoals({ goals, blocked, action, detail, expandedId, children }: {
  goals: PlanningGoal[]; blocked: boolean; action: Action; detail: (goal: PlanningGoal) => void; expandedId?: string; children?: ReactNode
}) {
  const dragged = useRef<PlanningGoal | undefined>(undefined)
  const move = (goal: PlanningGoal, direction: 'up' | 'down', targetId?: string) => {
    if (goal.status !== 'active') return
    void action({ type: 'reorderGoals', mainlineId: goal.mainlineId, id: goal.id, direction, ...(targetId ? { targetId } : {}) })
  }
  return <div className="planning-goals">{goals.map(goal => <article className={`planning-goal${goal.focused ? ' is-focused' : ''}`} key={goal.id}
    aria-label={`目标卡：${goal.title}`} draggable={!blocked && goal.status === 'active' && goal.capabilities.reorder?.allowed}
    onDragStart={event => { if (blocked) { event.preventDefault(); return }; dragged.current = goal; event.dataTransfer.setData('text/plain', goal.id); event.dataTransfer.effectAllowed = 'move' }}
    onDragEnd={() => { dragged.current = undefined }}
    onDragOver={event => { const source = dragged.current; if (!blocked && source?.status === 'active' && goal.status === 'active' && source.id !== goal.id && source.mainlineId === goal.mainlineId && source.focused === goal.focused) event.preventDefault() }}
    onDrop={event => {
      event.preventDefault()
      const source = dragged.current
      dragged.current = undefined
      if (!blocked && source?.status === 'active' && goal.status === 'active' && source.id !== goal.id && source.mainlineId === goal.mainlineId && source.focused === goal.focused)
        move(source, source.sortOrder < goal.sortOrder ? 'down' : 'up', goal.id)
    }}>
    <PlanningRecord label={`目标：${goal.title}`} open={expandedId === goal.id} disabled={blocked} toggle={() => detail(goal)} summary={<>
      <span className="planning-record-mark">◎</span><span className="planning-record-copy"><small>{goal.independent ? '独立目标' : goal.mainlineName}{goal.focused ? ' · 聚焦中' : ''}</small>
      <strong>{goal.title}</strong><PlanningProgress compact value={goal.progress} label="目标任务进度" /></span>
      <span className="planning-record-meta">{goal.status === 'achieved' ? '已达成' : goal.status === 'ended' ? '已结束' : '进行中'}</span>
    </>}>
      {children}
    </PlanningRecord>
  </article>)}</div>
}
