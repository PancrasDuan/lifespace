import { useRef, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import type { PlanningCommand, PlanningGoal } from '../shared/adventure-planning'
import { Progress } from './PrototypeRecord'

type Action = (command: PlanningCommand) => Promise<boolean>
export function PrototypeGoals({ goals, blocked, action, openGoal, toggleGoal, detail, edit, achieve, end }: {
  goals: PlanningGoal[]; blocked: boolean; action: Action; openGoal?: string; toggleGoal: (id: string) => void
  detail: (goal: PlanningGoal) => ReactNode; edit: (goal: PlanningGoal) => void; achieve: (goal: PlanningGoal) => void; end: (goal: PlanningGoal) => void
}) {
  const dragged = useRef<PlanningGoal | undefined>(undefined)
  const move = (goal: PlanningGoal, direction: 'up' | 'down', targetId?: string) => {
    if (goal.status === 'active') void action({ type: 'reorderGoals', id: goal.id, direction, ...(targetId ? { targetId } : {}) })
  }
  return <div className="goal-console-table" role="table" aria-label="目标列表">
    <div role="row" className="goal-console-head"><span role="columnheader">目标</span><span role="columnheader">分类标签</span><span role="columnheader">任务进度</span><span role="columnheader">任务数</span><span role="columnheader">状态</span><span role="columnheader">操作</span></div>
    {goals.map(goal => <div role="rowgroup" key={goal.id}>
      <div role="row" className="goal-console-row" draggable={!blocked && goal.status === 'active' && !!goal.capabilities.reorder?.allowed}
        onDragStart={event => { dragged.current = goal; event.dataTransfer.setData('text/plain', goal.id); event.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={() => { dragged.current = undefined }}
        onDragOver={event => { if (!blocked && dragged.current?.status === 'active' && goal.status === 'active' && dragged.current.id !== goal.id) event.preventDefault() }}
        onDrop={event => { event.preventDefault(); const source = dragged.current; dragged.current = undefined; if (!blocked && source && source.id !== goal.id && source.status === 'active' && goal.status === 'active') move(source, source.sortOrder < goal.sortOrder ? 'down' : 'up', goal.id) }}>
        <strong role="cell" className="goal-console-title">{goal.status === 'active' && <GripVertical size={15} aria-hidden="true" />}{goal.title}</strong><span role="cell">{goal.categoryLabel || '—'}</span>
        <span role="cell" className="goal-console-progress">{goal.progress.ratio === null ? '暂无任务' : <Progress value={goal.progress.ratio} label={`目标 ${goal.title} 任务进度`} />}</span>
        <span role="cell">{goal.progress.total} 项</span><span role="cell">{goal.status === 'active' ? '进行中' : goal.status === 'achieved' ? '已达成' : '已结束'}</span>
        <div role="cell" className="goal-console-actions">
          <button type="button" disabled={blocked} aria-expanded={openGoal === goal.id} aria-controls={`goal-detail-${goal.id}`} onClick={() => toggleGoal(goal.id)}>关系卡片</button>
          {goal.status === 'active' && <><button type="button" disabled={blocked || !goal.capabilities.achieve?.allowed} title={goal.capabilities.achieve?.reason} onClick={() => achieve(goal)}>达成</button>
            <button type="button" aria-label={`变更目标 ${goal.title}`} disabled={blocked || !goal.capabilities.edit?.allowed} onClick={() => edit(goal)}>变更</button>
            <button type="button" disabled={blocked || !goal.capabilities.end?.allowed} title={goal.capabilities.end?.reason} onClick={() => end(goal)}>结束</button>
            {(['up', 'down'] as const).map(direction => <button key={direction} type="button" aria-label={`${direction === 'up' ? '上移' : '下移'}目标 ${goal.title}`} disabled={blocked || !goal.capabilities[direction === 'up' ? 'moveUp' : 'moveDown']?.allowed} onClick={() => move(goal, direction)}>{direction === 'up' ? '↑' : '↓'}</button>)}</>}
        </div>
      </div>
      <div role="row" hidden={openGoal !== goal.id}><div role="cell" aria-colspan={6} id={`goal-detail-${goal.id}`} className="record-details">{openGoal === goal.id && detail(goal)}</div></div>
    </div>)}
  </div>
}
