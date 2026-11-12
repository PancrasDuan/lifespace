import { useRef, useState } from 'react'
import type { PlanningGoal, PlanningPage } from '../shared/adventure-planning'

export function PrototypeGoalDetail({ goal, detail, pageSize, blocked, changePage }: {
  goal: PlanningGoal; detail: PlanningPage['goalDetail']; pageSize: number; blocked: boolean
  changePage: (page: number) => void
}) {
  const [face, setFace] = useState<'goal' | 'tasks'>('goal')
  const taskButton = useRef<HTMLButtonElement>(null)
  return <div className="goal-relation">
    {face === 'goal' ? <>
      <p className="goal-relation-category">{goal.categoryLabel || '无分类'}</p>
      <h3>{goal.title}</h3>
      <p>{goal.status === 'active' ? '进行中' : goal.status === 'achieved' ? '已达成' : '已结束'} · {goal.progress.completed} / {goal.progress.total} 项任务完成</p>
      <section><h4>完成标准</h4><ul>{goal.standards.map((standard, index) => <li key={index}>{standard}</li>)}</ul></section>
      {goal.status === 'active' && !goal.capabilities.achieve?.allowed && <p className="adventure-hint">{goal.capabilities.achieve?.reason}</p>}
      {goal.status === 'active' && !goal.capabilities.end?.allowed && goal.capabilities.end?.reason && goal.capabilities.end.reason !== goal.capabilities.achieve?.reason && <p className="adventure-hint">{goal.capabilities.end.reason}</p>}
      {goal.status !== 'active' && <p className="muted">目标已进入终态，只读保留。</p>}
      <button ref={taskButton} type="button" className="adventure-primary" onClick={() => setFace('tasks')}>相关任务</button>
    </> : <>
      <h3>相关任务</h3>
      {!detail ? <p role="status">正在读取相关任务…</p> : <>
        <p className="muted">共 {detail.totalRelatedTasks} 项</p>
        {detail.relatedTasks.length ? <ul className="goal-relation-tasks">{detail.relatedTasks.map(task => <li key={task.id}>
          <strong>{task.title}</strong><span>计划时间：{task.plannedOn}</span><span>完成时间：{task.completedAt ? new Date(task.completedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未完成'}</span>
        </li>)}</ul> : <p>暂无相关任务。</p>}
        {detail.totalRelatedTasks > pageSize && <div className="planning-pagination"><small>第 {detail.taskPage} 页</small><div>
          <button type="button" disabled={blocked || detail.taskPage <= 1} onClick={() => changePage(detail.taskPage - 1)}>上一页</button>
          <button type="button" disabled={blocked || detail.taskPage * pageSize >= detail.totalRelatedTasks} onClick={() => changePage(detail.taskPage + 1)}>下一页</button>
        </div></div>}
      </>}
      <button type="button" autoFocus onClick={() => { setFace('goal'); requestAnimationFrame(() => taskButton.current?.focus()) }}>返回目标详情</button>
    </>}
  </div>
}
