import { useRef } from 'react'
import type { PlanningCommand, PlanningGoal } from '../shared/adventure-planning'
import { PlanningProgress } from './PlanningProgress'

type Action = (command: PlanningCommand) => Promise<boolean>
export function PlanningGoals({ goals, blocked, action, detail }: {
  goals: PlanningGoal[]; blocked: boolean; action: Action; detail: (goal: PlanningGoal) => void
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
    <div role="button" tabIndex={blocked ? -1 : 0} aria-disabled={blocked} aria-label={`目标：${goal.title}`} onClick={() => { if (!blocked) detail(goal) }}
      onKeyDown={event => { if (!blocked && (event.key === 'Enter' || event.key === ' ') && !event.nativeEvent.isComposing) { event.preventDefault(); detail(goal) } }}>
      <span className="planning-destination">{goal.independent ? '独立目标' : goal.mainlineName}</span>
      <h3>{goal.title}</h3><ul>{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul>
      <PlanningProgress value={goal.progress} label="目标任务进度" />
      <footer><span>{goal.status === 'achieved' ? '已达成' : goal.status === 'ended' ? '已结束' : goal.focused ? '聚焦中' : '进行中'}</span><span aria-hidden="true">查看详情 ›</span></footer>
    </div>
    <div className="planning-goal-actions">
      <button disabled={blocked || goal.status !== 'active' || !goal.capabilities.focus?.allowed} title={goal.capabilities.focus?.reason} aria-pressed={goal.focused}
        onClick={() => { void action({ type: 'focusGoal', id: goal.id, focused: !goal.focused }) }}>{goal.focused ? '取消聚焦' : '聚焦'}</button>
      <button aria-label={`上移目标 ${goal.title}`} disabled={blocked || goal.status !== 'active' || !goal.capabilities.moveUp?.allowed} onClick={() => move(goal, 'up')}>↑ 上移</button>
      <button aria-label={`下移目标 ${goal.title}`} disabled={blocked || goal.status !== 'active' || !goal.capabilities.moveDown?.allowed} onClick={() => move(goal, 'down')}>↓ 下移</button>
    </div>
  </article>)}</div>
}
