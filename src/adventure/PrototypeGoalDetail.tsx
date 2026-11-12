import { useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react'
import type { PlanningGoal, PlanningPage } from '../shared/adventure-planning'
import { Progress } from './PrototypeRecord'

export function PrototypeGoalDetail({ goal, detail, pageSize, blocked, changePage }: {
  goal: PlanningGoal; detail: PlanningPage['goalDetail']; pageSize: number; blocked: boolean
  changePage: (page: number) => void
}) {
  const [face, setFace] = useState<'goal' | 'tasks'>('goal')
  const taskButton = useRef<HTMLButtonElement>(null)
  const status = goal.status === 'active' ? '进行中' : goal.status === 'achieved' ? '已达成' : '已结束'
  return <div className="goal-relation">
    {face === 'goal' ? <>
      <div className="goal-relation-content">
        <div className="goal-relation-identity"><div>
          {goal.categoryLabel && <span className="goal-console-category">{goal.categoryLabel}</span>}
          <h3>{goal.title}</h3>
          <p>{status} · {goal.progress.completed} / {goal.progress.total} 项任务完成</p>
        </div><span className={`goal-status goal-status-${goal.status}`}>{status}</span></div>
        {goal.progress.ratio === null ? <p className="goal-relation-no-progress">暂无可统计任务</p> : <div className="goal-relation-progress"><Progress value={goal.progress.ratio} label={`目标 ${goal.title} 任务进度`} /><span>{goal.progress.completed} / {goal.progress.total}</span></div>}
        <section className="goal-relation-standards"><h4>完成标准</h4><ul>{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul></section>
        {goal.status === 'active' && !goal.capabilities.achieve?.allowed && <p className="goal-relation-hint">{goal.capabilities.achieve?.reason}</p>}
        {goal.status === 'active' && !goal.capabilities.end?.allowed && goal.capabilities.end?.reason && goal.capabilities.end.reason !== goal.capabilities.achieve?.reason && <p className="goal-relation-hint">{goal.capabilities.end.reason}</p>}
        {goal.status !== 'active' && <p className="goal-relation-hint">目标已进入终态，只读保留。</p>}
      </div>
      <footer className="goal-relation-footer"><small>{status} · {goal.progress.total} 项任务</small><button ref={taskButton} type="button" onClick={() => setFace('tasks')}>相关任务 <ChevronRight size={14} aria-hidden="true" /></button></footer>
    </> : <>
      <div className="goal-relation-content">
        <div className="goal-relation-task-heading"><div><h3>相关任务</h3><p>只展示任务名称、计划时间和完成时间。</p></div>{detail && <span className="goal-count">{detail.totalRelatedTasks}</span>}</div>
        {!detail ? <p role="status">正在读取相关任务…</p> : <>
          {detail.relatedTasks.length ? <ul className="goal-relation-tasks">{detail.relatedTasks.map(task => <li key={task.id}>
            <span className="goal-relation-task-icon" aria-hidden="true">{task.completedAt ? <Check size={13} /> : <Circle size={7} />}</span>
            <span className="sr-only">{task.completedAt ? '已完成' : '待完成'}</span>
            <div className="goal-relation-task-main"><span className={task.completedAt ? 'is-completed' : undefined}>{task.title}</span><div className="goal-relation-task-times"><span>计划 {task.plannedOn}</span><span>完成 {task.completedAt ? new Date(task.completedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—'}</span></div></div>
          </li>)}</ul> : <p className="goal-relation-empty">暂无相关任务。</p>}
          {detail.totalRelatedTasks > pageSize && <div className="planning-pagination"><small>第 {detail.taskPage} 页</small><div>
            <button type="button" disabled={blocked || detail.taskPage <= 1} onClick={() => changePage(detail.taskPage - 1)}>上一页</button>
            <button type="button" disabled={blocked || detail.taskPage * pageSize >= detail.totalRelatedTasks} onClick={() => changePage(detail.taskPage + 1)}>下一页</button>
          </div></div>}
        </>}
      </div>
      <footer className="goal-relation-footer"><small>{detail ? `共 ${detail.totalRelatedTasks} 项` : '正在读取…'}</small><button type="button" autoFocus onClick={() => { setFace('goal'); requestAnimationFrame(() => taskButton.current?.focus()) }}><ChevronLeft size={14} aria-hidden="true" />返回目标详情</button></footer>
    </>}
  </div>
}
